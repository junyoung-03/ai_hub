import { createHash } from "node:crypto";
import type { UploadRequest, UploadMime, UploadPage, UploadDetail, UploadExtraction, CompleteUploadInput, UploadPlan } from "@/types/uploads";
import { OCR_ORIGIN, PDF_ORIGIN, BROWSER_OCR } from "@/lib/uploads/ocr-contract";
export const UPLOAD_BUCKET = "upload-originals";
export const UPLOAD_LIMITS = Object.freeze({ bytes: 5_000_000, pages: 10, pixels: 20_000_000, side: 10_000,
  codePoints: 100_000, textBytes: 400_000, runMs: 120_000, ocrMs: 20_000 });
export const UPLOAD_CODES = ["VALIDATION_ERROR","FORBIDDEN","ITEM_NOT_FOUND","IDEMPOTENCY_CONFLICT","UPLOAD_EXPIRED","UPLOAD_IN_PROGRESS","STORAGE_UNAVAILABLE","UNSUPPORTED_FILE","FILE_LIMIT","INVALID_FILE","PDF_ENCRYPTED","PDF_UNSAFE","PDF_LAYOUT_NEEDS_REVIEW","TEXT_LIMIT","EMPTY_TEXT","OCR_UNAVAILABLE","OCR_FAILED","PROCESSING_TIMEOUT","STALE_ATTEMPT","WORKER_UNAVAILABLE"] as const;
export type UploadCode = typeof UPLOAD_CODES[number];
export class UploadError extends Error { constructor(public readonly code: UploadCode) { super(code); } }
export const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string,unknown> : {};
export const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export const sha256 = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
export function parseUploadRequest(value: unknown): UploadRequest {
  const r=record(value);
  if(Object.keys(r).sort().join(',')!=="fileName,mimeType,size" || typeof r.fileName!=="string" || !r.fileName.trim()
    || Array.from(r.fileName).length>200 || /[\u0000-\u001f\u007f\\/<>:"|?*]/.test(r.fileName)
    || !Number.isSafeInteger(r.size) || Number(r.size)<1 || Number(r.size)>UPLOAD_LIMITS.bytes) throw new UploadError("VALIDATION_ERROR");
  const fileName=r.fileName.normalize("NFC").trim(), ext=fileName.split('.').at(-1)?.toLowerCase();
  const mime=ext==='pdf'?'application/pdf':ext==='png'?'image/png':['jpg','jpeg'].includes(ext??'')?'image/jpeg':null;
  if(!mime || r.mimeType!==mime) throw new UploadError("UNSUPPORTED_FILE");
  return {fileName,mimeType:mime,size:Number(r.size)};
}
export const extension=(mime:UploadMime)=>mime==='application/pdf'?'pdf':mime==='image/png'?'png':'jpg';
export function uploadPath(user: string,id: string,mime: UploadMime) {
  if(!uuid(user)||!uuid(id)) throw new UploadError("VALIDATION_ERROR");
  return `${user}/${id}/original.${extension(mime)}`;
}
export function verifyBytes(bytes: Buffer, request: UploadRequest) {
  if(!bytes.length || bytes.length>UPLOAD_LIMITS.bytes || bytes.length!==request.size) throw new UploadError("FILE_LIMIT");
  const mime=bytes.subarray(0,5).toString()==='%PDF-'?'application/pdf':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':null;
  if(mime!==request.mimeType) throw new UploadError("UNSUPPORTED_FILE");
  return sha256(bytes);
}
export function normalizeText(v:string){
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/.test(v)||/[\ud800-\udfff]/u.test(v))throw new UploadError('VALIDATION_ERROR');
  return v.replace(/\r\n?/g,'\n').normalize('NFC').trim();
}
export function parseCompleteInput(value:unknown):CompleteUploadInput{
  const r=record(value);
  if(Object.keys(r).join(',')!=='pages'||!Array.isArray(r.pages)||r.pages.length>10)throw new UploadError('VALIDATION_ERROR');
  const seen=new Set<number>();let points=0,bytes=0;
  const pages=r.pages.map(input=>{
    const p=record(input);
    if(Object.keys(p).sort().join(',')!=='confidence,execution,language,page,provider,providerVersion,text'
      ||!Number.isSafeInteger(p.page)||Number(p.page)<1||Number(p.page)>10||seen.has(Number(p.page))
      ||typeof p.text!=='string'||p.provider!==BROWSER_OCR.provider||p.providerVersion!==BROWSER_OCR.providerVersion
      ||p.execution!==BROWSER_OCR.execution||p.language!==BROWSER_OCR.language
      ||!(p.confidence===null||(typeof p.confidence==='number'&&Number.isFinite(p.confidence)&&p.confidence>=0&&p.confidence<=1)))throw new UploadError('VALIDATION_ERROR');
    seen.add(Number(p.page));points+=Array.from(p.text).length;bytes+=Buffer.byteLength(p.text);
    if(points>UPLOAD_LIMITS.codePoints||bytes>UPLOAD_LIMITS.textBytes)throw new UploadError('TEXT_LIMIT');
    const text=normalizeText(p.text);if(!text)throw new UploadError('EMPTY_TEXT');
    return {page:Number(p.page),text,...BROWSER_OCR,confidence:p.confidence as number|null};
  });
  return {pages};
}
export function mergeClientPages(plan:UploadPlan,input:CompleteUploadInput){
  const expected=plan.pages.filter(p=>p.method==='ocr');
  if(expected.length!==input.pages.length||expected.some(p=>!input.pages.some(v=>v.page===p.page)))throw new UploadError('VALIDATION_ERROR');
  return plan.pages.map(p=>p.method==='embedded'?{text:p.text??'',method:p.method,confidence:null}:{text:input.pages.find(v=>v.page===p.page)!.text,method:p.method,confidence:input.pages.find(v=>v.page===p.page)!.confidence});
}
export function assemble(pages: {text:string;method:UploadPage['method'];confidence:number|null}[]): UploadExtraction {
  if(!pages.length||pages.length>UPLOAD_LIMITS.pages) throw new UploadError("FILE_LIMIT");
  const ranges:UploadPage[]=[]; let text='';
  for(const [index,p] of pages.entries()) {
    const value=normalizeText(p.text); if(p.method==='ocr'&&!value) throw new UploadError("EMPTY_TEXT");
    if(index) text+='\n\n'; const start=Array.from(text).length; text+=value;
    if(Array.from(text).length>UPLOAD_LIMITS.codePoints || Buffer.byteLength(text)>UPLOAD_LIMITS.textBytes) throw new UploadError("TEXT_LIMIT");
    ranges.push({page:index+1,start,end:Array.from(text).length,...(p.method==='ocr'?OCR_ORIGIN:PDF_ORIGIN),confidence:p.method==='ocr'?p.confidence:null});
  }
  if(!text.trim()) throw new UploadError("EMPTY_TEXT");
  const ocr=ranges.some(p=>p.method==='ocr'),embedded=ranges.some(p=>p.method==='embedded');
  const origin=ocr&&embedded?{method:'mixed' as const,provider:'mixed' as const,providerVersion:'mixed',execution:'mixed' as const,language:'kor+eng' as const,extractionVersion:'upload-text-v1' as const}:ocr?OCR_ORIGIN:PDF_ORIGIN;
  return {version:'upload-text-v1',status:'complete',text,hash:sha256(text),pages:ranges,...origin};
}
export function uploadDetail(metadata: unknown): UploadDetail | null {
  const r=record(record(metadata).upload),e=record(r.extraction);
  if(e.version!=='upload-text-v1'||!['pending','running','complete','failed'].includes(String(e.status))) return null;
  const pages:UploadPage[]=[];
  if(!Array.isArray(e.pages)||e.pages.length>10||(e.status==='complete'&&!e.pages.length)||(e.status!=='complete'&&e.pages.length))return null;
  if(Array.isArray(e.pages)&&e.pages.length<=10) for(const p of e.pages) {
    const v=record(p);
    if(!Number.isSafeInteger(v.page)||Number(v.page)<1||Number(v.page)>10||!Number.isSafeInteger(v.start)||!Number.isSafeInteger(v.end)||Number(v.start)<0||Number(v.end)<Number(v.start)||Number(v.end)>100000
      || !['embedded','ocr'].includes(String(v.method)) || !(v.method==='embedded'?v.provider==='pdfjs':['tesseract.js','cloud-vision'].includes(String(v.provider)))) return null;
    if(v.page!==pages.length+1||v.start!==(pages.length?pages.at(-1)!.end+2:0))return null;
    if(v.provider==='cloud-vision')return null; // Historical legacy data is not relabelled as client OCR.
    const origin=v.method==='ocr'?OCR_ORIGIN:PDF_ORIGIN;
    if(v.execution!==origin.execution||v.providerVersion!==origin.providerVersion||v.language!==origin.language||v.extractionVersion!==origin.extractionVersion)return null;
    pages.push({page:Number(v.page),start:Number(v.start),end:Number(v.end),...origin,confidence:typeof v.confidence==='number'&&v.confidence>=0&&v.confidence<=1?v.confidence:null});
  }
  return {version:'upload-text-v1',extractionStatus:e.status as UploadDetail['extractionStatus'],pages,error:UPLOAD_CODES.includes(e.error as UploadCode)?String(e.error):null};
}
