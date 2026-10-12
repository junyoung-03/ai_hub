import type {PreparedUpload,CompletedUpload} from '@/types/uploads';
import type {OCRProvider,OCRProgress,OCRSubmission} from './ocr-provider';
export type UploadPhase='uploading'|'preparing'|'ocr'|'saving'|'complete';
export type UploadCheckpoint={uploadId:string;idempotencyKey:string};
async function api(path:string,body:unknown,signal:AbortSignal,key?:string){
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},credentials:'same-origin',cache:'no-store',signal,body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw new Error(result?.error?.code??'UPLOAD_FAILED');return result;
}
export async function runUpload({file,checkpoint,signal,onCheckpoint,onPhase,onProgress,providerFactory}:{file?:File;checkpoint:UploadCheckpoint;signal:AbortSignal;onCheckpoint:(value:UploadCheckpoint)=>void;onPhase:(phase:UploadPhase)=>void;onProgress:(value:OCRProgress)=>void;providerFactory?:()=>Promise<OCRProvider>}):Promise<CompletedUpload>{
  let uploadId=checkpoint.uploadId;
  if(!uploadId){
    const isPdf = file?.name?.toLowerCase().endsWith('.pdf') || file?.type === 'application/pdf';
    const mimeType = isPdf ? 'application/pdf' : (file?.type ?? '');
    if(!file||file.size<1||file.size>5_000_000||!['application/pdf','image/png','image/jpeg'].includes(mimeType))throw new Error('UNSUPPORTED_FILE');
    onPhase('uploading');
    const created=await api('/api/v1/uploads',{fileName:file.name,mimeType,size:file.size},signal,checkpoint.idempotencyKey);
    uploadId=created.uploadId;
    if(!created.itemId){
      const {createClient}=await import('@/lib/supabase/client');
      const parsed=new URL(created.signedUploadUrl),token=parsed.searchParams.get('token');if(!token)throw new Error('UPLOAD_FAILED');
      const {error}=await createClient().storage.from('upload-originals').uploadToSignedUrl(created.storagePath,token,file,{contentType:mimeType,upsert:false});
      if(error)throw new Error('STORAGE_UNAVAILABLE');
    }
    // Only checkpoint after Storage succeeds; key is retained for safe create replay.
    onCheckpoint({uploadId,idempotencyKey:checkpoint.idempotencyKey});
  }
  signal.throwIfAborted();onPhase('preparing');
  const prepared=await api(`/api/v1/uploads/${uploadId}/prepare`,{},signal) as PreparedUpload|CompletedUpload;
  if(prepared.state!=='stored'){onPhase('complete');return prepared as CompletedUpload;}
  const plan=prepared as PreparedUpload;
  const response=await fetch(plan.downloadUrl,{signal,cache:'no-store',credentials:'omit',redirect:'error'});if(!response.ok)throw new Error('STORAGE_UNAVAILABLE');
  const original=await response.blob();if(original.size>5_000_000)throw new Error('FILE_LIMIT');
  const provider=await (providerFactory?providerFactory():import('./tesseract-provider').then(m=>new m.BrowserTesseractProvider()));
  const pages:OCRSubmission[]=[];
  try{
    onPhase('ocr');await provider.initialize(signal,onProgress);
    const {renderOCRPages}=await import('./render');
    for await(const page of renderOCRPages(original,plan,signal)){pages.push(await provider.recognize(page.page,page.image,signal));if(pages.reduce((n,p)=>n+new TextEncoder().encode(p.text).length,0)>400_000)throw new Error('TEXT_LIMIT');}
  }finally{provider.dispose();}
  signal.throwIfAborted();onPhase('saving');
  const completed=await api(`/api/v1/uploads/${uploadId}/complete`,{pages},signal);onPhase('complete');return completed;
}
