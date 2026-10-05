import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
export function load(path, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(code, { exports, Buffer, TextEncoder, TextDecoder, URL, URLSearchParams, Request, Response,
    Headers, AbortSignal, AbortController, Date, setTimeout, clearTimeout, ...globals,
    require(name) { if (name === "server-only") return {}; if (Object.hasOwn(imports, name)) return imports[name];
      if (name === "@/lib/uploads/ocr-contract") return load("src/lib/uploads/ocr-contract.ts");
      if (name.startsWith("node:") || name === "next/server") return require(name);
      throw new Error(`Missing isolated dependency: ${name}`); },
  });
  return exports;
}
