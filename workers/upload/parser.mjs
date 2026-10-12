// Untrusted bytes only. Imported in a credential-free child; no Storage/DB/OCR clients.
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
const limits={bytes:5000000,pages:10,pixels:20000000,side:10000,expanded:64000000,text:100000};
export class ParserError extends Error { constructor(code){super(code);this.code=code;} }
const fail=code=>{throw new ParserError(code);};
const shape=(width,height)=>{if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>limits.side||height>limits.side||width*height>limits.pixels)fail('FILE_LIMIT');};
function parseImageHeader(bytes, mime) {
  if (mime === 'image/png') {
    if (bytes.length < 33) fail('INVALID_FILE');
    const ihdrLen = bytes.readUInt32BE(8);
    if (ihdrLen !== 13) fail('INVALID_FILE');
    if (bytes.subarray(12, 16).toString('ascii') !== 'IHDR') fail('INVALID_FILE');
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    const bitDepth = bytes[24];
    const colorType = bytes[25];
    const compression = bytes[26];
    const filter = bytes[27];
    const interlace = bytes[28];
    if (width < 1 || height < 1) fail('INVALID_FILE');
    if (compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) fail('INVALID_FILE');
    if (![1, 2, 4, 8, 16].includes(bitDepth)) fail('INVALID_FILE');
    if (![0, 2, 3, 4, 6].includes(colorType)) fail('INVALID_FILE');
    let offset = 8;
    let hasIEND = false;
    while (offset + 12 <= bytes.length) {
      const len = bytes.readUInt32BE(offset);
      if (len > 0x7FFFFFFF || offset + 12 + len > bytes.length) fail('INVALID_FILE');
      const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
      if (type === 'acTL') fail('UNSUPPORTED_FILE');
      offset += 12 + len;
      if (type === 'IEND') {
        hasIEND = true;
        break;
      }
    }
    if (!hasIEND) fail('INVALID_FILE');
    return { width, height };
  }
  if (mime === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) fail('INVALID_FILE');
    let offset = 2;
    let width = 0, height = 0, foundSOF = false;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xFF) fail('INVALID_FILE');
      while (offset < bytes.length && bytes[offset] === 0xFF) offset++;
      if (offset >= bytes.length) fail('INVALID_FILE');
      const marker = bytes[offset++];
      if (marker === 0xD9) break;
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue;
      if (offset + 2 > bytes.length) fail('INVALID_FILE');
      const len = bytes.readUInt16BE(offset);
      if (len < 2 || offset + len > bytes.length) fail('INVALID_FILE');
      if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)) {
        if (foundSOF) fail('UNSUPPORTED_FILE');
        if (len < 8) fail('INVALID_FILE');
        const h = bytes.readUInt16BE(offset + 3);
        const w = bytes.readUInt16BE(offset + 5);
        if (h < 1 || w < 1) fail('INVALID_FILE');
        height = h;
        width = w;
        foundSOF = true;
      }
      if (marker === 0xDA) break;
      offset += len;
    }
    if (!foundSOF) fail('INVALID_FILE');
    return { width, height };
  }
  fail('UNSUPPORTED_FILE');
}
function scanPdf(bytes){
  const raw=bytes.toString('latin1');
  if(!raw.startsWith('%PDF-')||!/%EOF\s*$/.test(raw))fail('INVALID_FILE');
  const tail=/startxref\s+(\d+)\s+%%EOF\s*$/.exec(raw);if(!tail)fail('INVALID_FILE');
  const offset=Number(tail[1]);if(!Number.isSafeInteger(offset)||offset<0||offset>=bytes.length)fail('INVALID_FILE');
  const xref=raw.slice(offset);
  if(!xref.startsWith('xref')) {
    if(!/^\d+\s+\d+\s+obj\b[\s\S]{0,300}?\/Type\s*\/XRef\b/.test(xref)) {
      fail('INVALID_FILE');
    }
  }
  if(xref.startsWith('xref')) {
    let entries=xref.slice(4).trimStart();
    while(!entries.startsWith('trailer')) {
      const header=/^(\d+)\s+(\d+)\s*[\r\n]+/.exec(entries);if(!header)fail('INVALID_FILE');
      const start=Number(header[1]),count=Number(header[2]);if(count>100000)fail('FILE_LIMIT');entries=entries.slice(header[0].length);
      for(let k=0;k<count;k++) {const row=/^(\d{10}) (\d{5}) ([fn])\s*[\r\n]+/.exec(entries);if(!row)fail('INVALID_FILE');
        if(row[3]==='n'&&!new RegExp(`^${start+k}\\s+${Number(row[2])}\\s+obj\\b`).test(raw.slice(Number(row[1]))))fail('INVALID_FILE');entries=entries.slice(row[0].length);}
    }
  }
  const decodedNames=s=>s.replace(/#([a-f0-9]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
  const reject=s=>{s=decodedNames(s);if(/\/Encrypt\b/.test(s))fail('PDF_ENCRYPTED');if(/\/(JavaScript|JS|Launch|EmbeddedFile|Filespec|OpenAction|AA|XFA|RichMedia|SubmitForm|GoToR|Prev)\b/.test(s))fail('PDF_UNSAFE');
    let checked=0;
    for(const match of s.matchAll(/<<[^<>]*\/Subtype\s*\/Image\b[^<>]*>>/g)) {
      checked++;
      const w=/\/Width\s+(\d+)\b/.exec(match[0]),h=/\/Height\s+(\d+)\b/.exec(match[0]);
      if(!w||!h)fail('PDF_LAYOUT_NEEDS_REVIEW');shape(Number(w[1]),Number(h[1]));
    }
    if(checked!==(s.match(/\/Subtype\s*\/Image\b/g)?.length??0))fail('PDF_LAYOUT_NEEDS_REVIEW');
  };
  reject(raw);let expanded=0;
  // Includes compressed object streams; never interpret scripts or attachment data.
  const re=/<<([\s\S]*?)>>\s*stream(?:\r\n|\r|\n)/g;let m;
  while((m=re.exec(raw))!==null){const end=raw.indexOf('endstream',re.lastIndex);if(end<0)fail('INVALID_FILE');
    const dict=decodedNames(m[1]),chunk=bytes.subarray(re.lastIndex,end);
    if(/\/ObjStm\b/.test(dict)&&!/\/Filter\s*\/FlateDecode\b/.test(dict))fail('PDF_LAYOUT_NEEDS_REVIEW');
    if(/\/FlateDecode\b/.test(dict)) {
      if(/\/Filter\s*\[/.test(dict))fail('PDF_LAYOUT_NEEDS_REVIEW');
      if(expanded>=limits.expanded)fail('FILE_LIMIT');
      let out;try{out=inflateSync(chunk,{maxOutputLength:limits.expanded-expanded});}catch(error){fail(error.code==='ERR_BUFFER_TOO_LARGE'?'FILE_LIMIT':'INVALID_FILE');}
      expanded+=out.length;if(expanded>limits.expanded)fail('FILE_LIMIT');reject(out.toString('latin1'));
    }
    re.lastIndex=end+9;
  }
}
export async function inspectBytes(bytes,mime){
  if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>limits.bytes)fail('FILE_LIMIT');
  const actual=bytes.subarray(0,5).toString()==='%PDF-'?'application/pdf':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':null;
  if(actual!==mime)fail('UNSUPPORTED_FILE');
  const rawHash=createHash('sha256').update(bytes).digest('hex');
  if(mime!=='application/pdf') {
    let dims;
    try {
      dims=parseImageHeader(bytes,mime);
      shape(dims.width,dims.height);
    }catch(error){if(error instanceof ParserError)throw error;fail('INVALID_FILE');}
    return {rawHash,mime,pages:[{page:1,method:'ocr'}]};
  }
  scanPdf(bytes);
  const {getDocument,OPS}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=getDocument({data:new Uint8Array(bytes),verbosity:0,stopAtErrors:true,isEvalSupported:false,enableXfa:false,
    useWorkerFetch:false,useSystemFonts:false,disableFontFace:true,disableAutoFetch:true,disableStream:true,
    maxImageSize:limits.pixels,canvasMaxAreaInBytes:80000000});
  let doc;
  try {
    doc=await task.promise;if(doc.numPages>limits.pages)fail('FILE_LIMIT');
    if(await doc.getJSActions()||await doc.getAttachments()||await doc.getOpenAction())fail('PDF_UNSAFE');
    const pages=[];let characters=0;
    for(let n=1;n<=doc.numPages;n++){
      const page=await doc.getPage(n);if(await page.getJSActions())fail('PDF_UNSAFE');
      const viewport=page.getViewport({scale:200/72});shape(Math.ceil(viewport.width),Math.ceil(viewport.height));
      const data=await page.getTextContent();let text='';
      for(const item of data.items) if('str' in item){text+=item.str+(item.hasEOL?'\n':' ');}
      text=text.replace(/\r\n?/g,'\n').replace(/\u0000/g,'').normalize('NFC').trim();characters+=Array.from(text).length;
      if(characters>limits.text||Buffer.byteLength(text)>400000)fail('TEXT_LIMIT');
      if(text.includes('\ufffd')||/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))fail('PDF_LAYOUT_NEEDS_REVIEW');
      const ops=await page.getOperatorList();const images=ops.fnArray.filter(op=>[OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageXObjectRepeat].includes(op)).length;
      if(text.trim()||!images)pages.push({page:n,method:'embedded',text});
      else pages.push({page:n,method:'ocr'});
      page.cleanup();
    }
    return {rawHash,mime,pages};
  }catch(error){if(error instanceof ParserError)throw error;fail(error?.name==='PasswordException'?'PDF_ENCRYPTED':'INVALID_FILE');}
  finally{await task.destroy();}
}
