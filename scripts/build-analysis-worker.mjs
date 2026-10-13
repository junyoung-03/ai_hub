import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import ts from 'typescript';
// Exact build allowlist: no source documents, credentials, .env or browser code.
const files = ['workers/analysis/server.ts','workers/analysis/runner.ts','src/lib/gemini/client.ts',
  'src/lib/gemini/validation.ts','src/lib/gemini/date-context.ts','src/lib/items/analysis-policy.ts',
  'src/lib/items/analysis-failure.ts','src/lib/items/analysis-job-rpc.ts'];
for (const file of files) {
  const target = resolve('.analysis-worker',file.replace(/\.ts$/,'.cjs'));
  let output = ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  output = output.replace(/require\("(@\/[^"\n]+|\.\/[^"]+)"\)/g,(match,name)=>{
    const source = name.startsWith('@/') ? `src/${name.slice(2)}.ts` : `${dirname(file)}/${name.slice(2)}.ts`;
    if (!files.includes(source)) throw new Error(`Unexpected runtime import: ${source}`);
    let path = relative(dirname(target),resolve('.analysis-worker',source.replace(/\.ts$/,'.cjs'))).replaceAll('\\','/');
    if (!path.startsWith('.')) path = `./${path}`;
    return `require(${JSON.stringify(path)})`;
  });
  mkdirSync(dirname(target),{recursive:true}); writeFileSync(target,output);
}
copyFileSync('AI_OUTPUT_SCHEMA.json','.analysis-worker/AI_OUTPUT_SCHEMA.json');
console.log(`PASS: ${files.length} shared runtime modules compiled; schema unchanged; no secrets copied.`);
