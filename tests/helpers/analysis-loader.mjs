// Node harness replaces server-only marker/auth adapters; production modules stay unchanged.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
export function loadAnalysisModule(path, imports = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const exports = {};
  runInNewContext(source, { exports, Buffer, URL, Response, Request, AbortSignal, Date, structuredClone, process, fetch,
    ...globals, require(name) {
      if (name === "server-only") return {};
      if (name in imports) return imports[name];
      if (name === "@/lib/items/promotional-gate") return { promotionalReady: async () => false, missingPromotionalContract: error => ["42P01","42703","42883","PGRST202","PGRST204","PGRST205"].includes(error?.code) };
      if (name === "@/lib/items/analysis-policy") return loadAnalysisModule("src/lib/items/analysis-policy.ts");
      if (name === "@/lib/items/free-analysis-scope") return loadAnalysisModule("src/lib/items/free-analysis-scope.ts", imports, globals);
      if (["@/lib/items/analysis-failure", "@/lib/items/analysis-job-rpc"].includes(name)) return loadAnalysisModule(`src/${name.slice(2)}.ts`, imports, globals);
      if (name === "@/lib/gemini/date-context") return loadAnalysisModule("src/lib/gemini/date-context.ts");
      if (name.endsWith("AI_OUTPUT_SCHEMA.json")) return require("../../AI_OUTPUT_SCHEMA.json");
      if (name.startsWith("node:") || ["ajv", "ajv-formats", "@supabase/supabase-js"].includes(name)) return require(name);
      throw new Error("Unexpected analysis test dependency.");
    } });
  return exports;
}
