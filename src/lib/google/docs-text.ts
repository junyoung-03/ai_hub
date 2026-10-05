import "server-only";
import type { DocsText } from "@/types/drive";
import { DriveError, DRIVE_LIMITS, object } from "@/lib/google/drive-contract";

/** Only extracted text establishes offsets; Google UTF-16 indexes are deliberately unused. */
export function extractDocsText(raw: unknown): DocsText {
  const doc = object(raw), parts: string[] = [], tabs: DocsText["metadata"]["tabs"] = [];
  const exclusions: DocsText["metadata"]["exclusions"] = {
    header: false, footer: false, footnote: false, image: false, suggestion: false,
    comment: "not_collected", ocr: "not_collected", unsupportedStructure: false,
  };
  let codePoints = 0, bytes = 0;
  const array = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
  function append(text: string) {
    // Count without allocating a 100k-element character array.
    let count = 0; for (const _ of text) { void _; count++; }
    const size = Buffer.byteLength(text, "utf8");
    if (codePoints + count > DRIVE_LIMITS.codePoints || bytes + size > DRIVE_LIMITS.bytes) throw new DriveError("DOCUMENT_LIMIT");
    codePoints += count; bytes += size; parts.push(text);
  }
  function structures(content: unknown, depth = 0) {
    if (depth > 100 || !Array.isArray(content)) throw new DriveError("GOOGLE_UNAVAILABLE");
    for (const rawElement of array(content)) {
      const element = object(rawElement);
      if (array(element.suggestedInsertionIds).length) { exclusions.suggestion = true; continue; }
      if (Object.keys(element).some(key => key.startsWith("suggested"))) exclusions.suggestion = true;
      if (element.paragraph) {
        if (!Array.isArray(object(element.paragraph).elements)) throw new DriveError("GOOGLE_UNAVAILABLE");
        if (Object.keys(object(element.paragraph)).some(key => key.startsWith("suggested"))) exclusions.suggestion = true;
        for (const rawRun of array(object(element.paragraph).elements)) {
          const run = object(rawRun), textRun = object(run.textRun);
          if (array(run.suggestedInsertionIds).length || array(run.suggestedDeletionIds).length
            || Object.keys(object(run.suggestedTextStyleChanges)).length
            || Object.keys(textRun).some(key => key.startsWith("suggested"))) exclusions.suggestion = true;
          if (array(run.suggestedInsertionIds).length) continue;
          if (typeof textRun.content === "string") append(textRun.content);
          else if (run.inlineObjectElement) exclusions.image = true;
          else if (run.footnoteReference) exclusions.footnote = true;
          else exclusions.unsupportedStructure = true;
        }
      } else if (element.table) {
        for (const row of array(object(element.table).tableRows)) {
          if (array(object(row).suggestedInsertionIds).length) { exclusions.suggestion = true; continue; }
          for (const cell of array(object(row).tableCells)) {
            if (array(object(cell).suggestedInsertionIds).length) { exclusions.suggestion = true; continue; }
            structures(object(cell).content, depth + 1);
          }
        }
      } else if (element.tableOfContents) structures(object(element.tableOfContents).content, depth + 1);
      else if (!element.sectionBreak) exclusions.unsupportedStructure = true;
    }
  }
  function visit(rawTab: unknown, parentId: string | null, depth = 0) {
    if (depth > 100) throw new DriveError("GOOGLE_UNAVAILABLE");
    const tab = object(rawTab), properties = object(tab.tabProperties), body = object(tab.documentTab);
    if (typeof properties.tabId !== "string" || typeof properties.title !== "string" || !body.body)
      throw new DriveError("GOOGLE_UNAVAILABLE");
    exclusions.header ||= Object.keys(object(body.headers)).length > 0;
    exclusions.footer ||= Object.keys(object(body.footers)).length > 0;
    exclusions.footnote ||= Object.keys(object(body.footnotes)).length > 0;
    exclusions.image ||= Object.keys(object(body.inlineObjects)).length > 0 || Object.keys(object(body.positionedObjects)).length > 0;
    exclusions.suggestion ||= Object.keys(body).some(key => key.startsWith("suggested") && Object.keys(object(body[key])).length > 0);
    const start = codePoints;
    structures(object(body.body).content);
    tabs.push({ id: properties.tabId, title: properties.title, parentId, start, end: codePoints });
    for (const child of array(tab.childTabs)) visit(child, properties.tabId, depth + 1);
  }
  if (!Array.isArray(doc.tabs) || doc.tabs.length === 0) throw new DriveError("GOOGLE_UNAVAILABLE");
  for (const tab of doc.tabs) visit(tab, null);
  return { text: parts.join(""), codePoints, bytes, metadata: { extractionVersion: "docs-text-v1", offsetUnit: "unicode_code_point", tabs, exclusions } };
}
