// Local production HTTP/assets/tracing smoke. Anonymous calls only, no OCR/DB writes.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {spawn} from 'node:child_process';
const routes=['prepare','complete'];
for(const route of routes){
  const file=`.next/server/app/api/v1/uploads/[uploadId]/${route}/route.js.nft.json`;
  const paths=JSON.parse(readFileSync(file)).files.map(p=>resolve(dirname(file),p));
  for(const tail of ['workers/upload/child.mjs','workers/upload/parser.mjs','node_modules/pdfjs-dist/legacy/build/pdf.mjs'])assert.ok(paths.some(p=>p.replaceAll('\\','/').endsWith(tail)&&existsSync(p)),`Tracing missing ${tail}`);
  const bytes=paths.reduce((n,p)=>n+(existsSync(p)&&statSync(p).isFile()?statSync(p).size:0),0);assert.ok(bytes<250*1024*1024,'Function tracing exceeds standard Vercel size');
}
const port=3002,origin=`http://localhost:${port}`;
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--port',String(port)],{stdio:'ignore',env:process.env});
try{
  let ready=false;
  for(let n=0;n<40;n++){try{const response=await fetch(`${origin}/ocr/tesseract-7/worker.min.js`,{signal:AbortSignal.timeout(1000)});if(response.ok){await response.body.cancel();ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
  assert.ok(ready,'Local production server did not start');
  for(const file of ['tesseract-7/worker.min.js','tesseract-7/core/tesseract-core-simd-lstm.wasm','tesseract-7/lang/kor.traineddata.gz','tesseract-7/lang/eng.traineddata.gz','pdfjs-6.4.299/pdf.worker.min.mjs']){
    const response=await fetch(`${origin}/ocr/${file}`,{signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/wasm-unsafe-eval/);assert.match(response.headers.get('cache-control'),/immutable/);await response.body.cancel();
  }
  for(const route of routes){
    const response=await fetch(`${origin}/api/v1/uploads/11111111-1111-4111-8111-111111111111/${route}`,{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(route==='prepare'?{}:{pages:[]}),signal:AbortSignal.timeout(10000)});
    assert.equal(response.status,401);assert.match(response.headers.get('cache-control'),/no-store/);await response.body.cancel();
  }
  console.log('PASS: local production native dependency/file tracing <250MiB; same-origin Worker/WASM/kor+eng/PDF worker assets + CSP/cache HTTP; anonymous prepare/complete rejected. Actual Vercel/browser OCR not claimed.');
}finally{child.kill();}
