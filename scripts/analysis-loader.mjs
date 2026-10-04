// Node harness replaces server-only marker/auth adapters; production modules stay unchanged.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
export function loadAnalysisModule(path, imports = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const exports = {};
  runInNewContext(source, { exports, Buffer, URL, Response, Request, AbortSignal, Date, structuredClone, process, fetch,
    ...globals, require(name) {
      if (name === "server-only") return {};
      if (name in imports) return imports[name];
      if (name.endsWith("AI_OUTPUT_SCHEMA.json")) return require("../AI_OUTPUT_SCHEMA.json");
      if (name.startsWith("node:") || ["ajv", "ajv-formats", "@supabase/supabase-js"].includes(name)) return require(name);
      throw new Error("Unexpected analysis test dependency.");
    } });
  return exports;
}
