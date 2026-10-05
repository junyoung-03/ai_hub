// Build-time only: fixed language versions, hash checks; no documents/OCR/credentials.
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='public/ocr/tesseract-7',manifestPath='workers/upload/browser-assets.json';
mkdirSync(`${root}/core`,{recursive:true});mkdirSync(`${root}/lang`,{recursive:true});mkdirSync('public/ocr/pdfjs-6.4.299',{recursive:true});
const manifest=existsSync(manifestPath)?JSON.parse(readFileSync(manifestPath,'utf8')):{};
const record=process.argv.includes('--record-hashes');
if(JSON.parse(readFileSync('node_modules/tesseract.js/package.json')).version!=='7.0.0'||JSON.parse(readFileSync('node_modules/tesseract.js-core/package.json')).version!=='7.0.0')throw new Error('OCR_ASSET_VERSION');
copyFileSync('node_modules/tesseract.js/dist/worker.min.js',`${root}/worker.min.js`);
for(const f of readdirSync('node_modules/tesseract.js-core').filter(f=>/^tesseract-core.*\.wasm(?:\.js)?$/.test(f)))copyFileSync(`node_modules/tesseract.js-core/${f}`,`${root}/core/${f}`);
copyFileSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs','public/ocr/pdfjs-6.4.299/pdf.worker.min.mjs');
for(const lang of ['kor','eng']){
  const filename=`${root}/lang/${lang}.traineddata.gz`;
  const url=`https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}@1.0.0/4.0.0_best_int/${lang}.traineddata.gz`;
  let bytes=existsSync(filename)?readFileSync(filename):null;
  const hash=data=>createHash('sha256').update(data).digest('hex');
  if(!bytes||(!record&&hash(bytes)!==manifest[lang]?.sha256)){
    const response=await fetch(url,{signal:AbortSignal.timeout(60000),redirect:'error'});if(!response.ok)throw new Error('LANGUAGE_ASSET_UNAVAILABLE');
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>20_000_000){await reader.cancel();throw new Error('LANGUAGE_ASSET_LIMIT');}chunks.push(value);}}finally{reader.releaseLock();}
    bytes=Buffer.concat(chunks);
  }
  if(bytes[0]!==31||bytes[1]!==139)throw new Error('LANGUAGE_ASSET_FORMAT');
  if(record)manifest[lang]={url,sha256:hash(bytes),bytes:bytes.length};
  if(url!==manifest[lang]?.url||hash(bytes)!==manifest[lang]?.sha256)throw new Error('LANGUAGE_ASSET_HASH');
  writeFileSync(filename,bytes);
}
if(record)writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log('PASS: pinned same-origin Worker/WASM/PDF worker/kor+eng language assets prepared; language hashes verified; no OCR.');
