// Isolated SSR smoke: real UI modules and styles; only browser/Auth/network boundaries are injected.
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
export function uiLoader(injections = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    file = resolve(file);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    runInNewContext(code, { exports, URL, URLSearchParams, Buffer, Date, Intl, Response, Request, Headers, structuredClone, process, ...globals, require(name) {
      if (name in injections) return injections[name];
      if (name === "@/lib/items/promotional-gate") return { promotionalReady: async () => false, missingPromotionalContract: error => ["42P01","42703","42883","PGRST202","PGRST204","PGRST205"].includes(error?.code) };
      if (name === "server-only") return {};
      if (name === "next/link") return { __esModule: true, default: ({ children, href, ...props }) => require("react").createElement("a", { href, ...props }, children) };
      if (name === "next/navigation") return { useRouter: () => ({ refresh() {} }), usePathname: () => "/library" };
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? resolve("src", name.slice(2)) : resolve(dirname(file), name);
        if (base.endsWith(".json")) return require(base);
        return load(base + (existsSync(base + ".tsx") ? ".tsx" : ".ts"));
      }
      return require(name);
    } });
    return exports;
  }
  return load;
}
