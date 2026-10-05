// Actual local HTTP entrypoint smoke; synthetic PDF only and no OCR/network provider.
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {pdfFixture} from './upload-fixtures.mjs';
const child=spawn(process.execPath,['workers/upload/server.mjs'],{env:{PORT:'48761'},stdio:'ignore'});
let exited=false;child.on('exit',()=>{exited=true;});
try{
 let ready=false;
 for(let attempt=0;attempt<40;attempt++){
   if(exited)throw new Error();
   try{const r=await fetch('http://localhost:48761/',{signal:AbortSignal.timeout(300)});assert.equal(r.status,404);ready=true;break;}
   catch{await new Promise(resolve=>setTimeout(resolve,100));}
 }
 assert.ok(ready);
 const r=await fetch('http://localhost:48761/inspect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mime:'application/pdf',bytes:pdfFixture().toString('base64')}),signal:AbortSignal.timeout(10000)});
 assert.equal(r.status,200);const plan=await r.json();assert.equal(plan.pages[0].method,'embedded');assert.equal(plan.pages[0].text,'Synthetic fixture text');assert.match(r.headers.get('cache-control'),/no-store/);
 console.log('PASS: actual server.mjs HTTP /inspect → isolated child → PDF.js embedded result, no provider calls. Local smoke only; Linux container/Cloud Run unverified.');
}catch{console.error('FAIL: local worker entrypoint smoke; payload/error suppressed.');process.exitCode=1;}
finally{child.kill();}
