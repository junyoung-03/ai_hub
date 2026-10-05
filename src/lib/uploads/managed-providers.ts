import "server-only";
import { GoogleAuth } from "google-auth-library";
import { UploadError, UPLOAD_LIMITS, UPLOAD_CODES, record, type UploadCode } from "@/lib/uploads/contract";
import type { UploadMime, UploadPlan, UploadPlanPage } from "@/types/uploads";
const auth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']});
async function within<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(new UploadError('PROCESSING_TIMEOUT'));
    signal.addEventListener('abort',abort,{once:true});
    work.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
async function boundedJson(response:Response,signal:AbortSignal,max:number):Promise<unknown>{
  const reader=response.body?.getReader();if(!reader)throw new UploadError('WORKER_UNAVAILABLE');
  let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new UploadError('FILE_LIMIT');}chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  finally{reader.releaseLock();}
}
export async function inspectFile(bytes:Buffer,mime:UploadMime,signal:AbortSignal):Promise<UploadPlan>{
  const configured=process.env.UPLOAD_WORKER_URL?.trim();if(!configured)throw new UploadError('WORKER_UNAVAILABLE');
  let url:URL;try{url=new URL(configured);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!url.hostname.endsWith('.run.app'))throw new Error();}catch{throw new UploadError('WORKER_UNAVAILABLE');}
  try{
    // ADC lives only in the orchestrator; no credentials are passed to the parser child.
    const client=await within(auth.getIdTokenClient(url.origin),signal),headers=await within(client.getRequestHeaders(),signal);signal.throwIfAborted();
    const response=await fetch(new URL('/inspect',url),{method:'POST',headers:{Authorization:headers.get('authorization')??'', 'Content-Type':'application/json'},body:JSON.stringify({bytes:bytes.toString('base64'),mime}),signal,redirect:'error',cache:'no-store'});
    const r=record(await boundedJson(response,signal,7_500_000));
    if(!response.ok)throw new UploadError(UPLOAD_CODES.includes(r.error as UploadCode)?r.error as UploadCode:'WORKER_UNAVAILABLE');
    if(typeof r.rawHash!=='string'||!/^[a-f0-9]{64}$/.test(r.rawHash)||r.mime!==mime||!Array.isArray(r.pages)||!r.pages.length||r.pages.length>10)throw new UploadError('INVALID_FILE');
    const pages:UploadPlanPage[]=[];
    for(const [index,value] of r.pages.entries()){
      const p=record(value);if(p.page!==index+1)throw new UploadError('INVALID_FILE');
      if(p.method==='embedded'&&typeof p.text==='string'&&mime==='application/pdf')pages.push({page:index+1,method:'embedded',text:p.text});
      else if(p.method==='ocr'&&typeof p.image==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(p.image)&&p.image.length<=6_666_668&&['image/png','image/jpeg'].includes(String(p.mime)))pages.push({page:index+1,method:'ocr',image:p.image,mime:p.mime as 'image/png'|'image/jpeg'});
      else throw new UploadError('INVALID_FILE');
    }
    if(mime!=='application/pdf'&&pages.length!==1)throw new UploadError('INVALID_FILE');
    return {rawHash:r.rawHash,mime,pages};
  }catch(error){if(error instanceof UploadError)throw error;throw new UploadError(signal.aborted?'PROCESSING_TIMEOUT':'WORKER_UNAVAILABLE');}
}
export async function ocrImage(image:string,signal:AbortSignal):Promise<{text:string;confidence:number|null}>{
  // Upload-2 is fixture-only. A separate explicit switch is required for live Upload-3.
  if(process.env.UPLOAD_OCR_ENABLED!=='true')throw new UploadError('OCR_UNAVAILABLE');
  const project=process.env.GOOGLE_CLOUD_PROJECT?.trim();if(!project)throw new UploadError('OCR_UNAVAILABLE');
  const callSignal=AbortSignal.any([signal,AbortSignal.timeout(UPLOAD_LIMITS.ocrMs)]);
  try{
    const credentials=await within(auth.getClient(),callSignal);const headers=await within(credentials.getRequestHeaders(),callSignal);signal.throwIfAborted();
    const response=await fetch('https://vision.googleapis.com/v1/images:annotate',{method:'POST',headers:{Authorization:headers.get('authorization')??'','x-goog-user-project':project,'Content-Type':'application/json'},body:JSON.stringify({requests:[{image:{content:image},features:[{type:'DOCUMENT_TEXT_DETECTION'}]}]}),signal:callSignal,redirect:'error',cache:'no-store'});
    if(!response.ok){await response.body?.cancel();throw new UploadError('OCR_FAILED');}
    const raw=record(await boundedJson(response,callSignal,4_000_000));
    if(!Array.isArray(raw.responses)||raw.responses.length!==1)throw new UploadError('OCR_FAILED');
    const result=record(raw.responses[0]);if(result.error)throw new UploadError('OCR_FAILED');
    const annotation=record(result.fullTextAnnotation);if(typeof annotation.text!=='string')throw new UploadError('EMPTY_TEXT');
    const confidences=Array.isArray(annotation.pages)?annotation.pages.map(p=>record(p).confidence).filter((v):v is number=>typeof v==='number'&&v>=0&&v<=1):[];
    return {text:annotation.text,confidence:confidences.length?confidences.reduce((a,b)=>a+b,0)/confidences.length:null};
  }catch(error){if(error instanceof UploadError)throw error;throw new UploadError(signal.aborted?'PROCESSING_TIMEOUT':'OCR_FAILED');}
}
