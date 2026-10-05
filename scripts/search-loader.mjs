import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
export function loadSearch(path,overrides={},globals={}) {
 const cache=new Map();
 function load(filename){
  const absolute=resolve(filename);if(cache.has(absolute))return cache.get(absolute);
  const exports={};cache.set(absolute,exports);
  const source=ts.transpileModule(readFileSync(absolute,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  runInNewContext(source,{exports,Buffer,URL,URLSearchParams,Request,Response,Headers,AbortSignal,Date,process,fetch,setTimeout,clearTimeout,...globals,require(name){
   if(name==='server-only')return {};
   if(name in overrides)return overrides[name];
   if(name.startsWith('node:'))return require(name);
   if(name.startsWith('.'))return load(resolve(dirname(absolute),`${name}.ts`));
   if(name.startsWith('@/lib/search/'))return load(`src/lib/search/${name.split('/').at(-1)}.ts`);
   throw new Error(`Unexpected search test dependency: ${name}`);
  }});
  return exports;
 }
 return load(path);
}
