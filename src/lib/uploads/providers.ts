import 'server-only';
import {isolatedInspect} from '../../../workers/upload/isolate.mjs';
import {UploadError,UPLOAD_CODES,UPLOAD_LIMITS,record,type UploadCode} from '@/lib/uploads/contract';
import type {UploadMime,UploadPlan,UploadPlanPage} from '@/types/uploads';
// Local credential-free child. The browser adapter owns OCR.
export async function inspectFile(bytes:Buffer,mime:UploadMime,signal:AbortSignal):Promise<UploadPlan>{
  try{
    const r=record(await isolatedInspect(bytes,mime,{signal,timeout:UPLOAD_LIMITS.runMs,render:false}));
    if(typeof r.rawHash!=='string'||!/^[a-f0-9]{64}$/.test(r.rawHash)||r.mime!==mime||!Array.isArray(r.pages)||!r.pages.length||r.pages.length>10)throw new UploadError('INVALID_FILE');
    const pages:UploadPlanPage[]=r.pages.map((value,index)=>{
      const p=record(value);if(p.page!==index+1)throw new UploadError('INVALID_FILE');
      if(p.method==='embedded'&&mime==='application/pdf'&&typeof p.text==='string')return {page:index+1,method:'embedded',text:p.text};
      if(p.method==='ocr')return {page:index+1,method:'ocr'};
      throw new UploadError('INVALID_FILE');
    });
    if(mime!=='application/pdf'&&pages.length!==1)throw new UploadError('INVALID_FILE');
    return {rawHash:r.rawHash,mime,pages};
  }catch(error){
    if(error instanceof UploadError)throw error;
    const code=error instanceof Error&&UPLOAD_CODES.includes(error.message as UploadCode)?error.message as UploadCode:'WORKER_UNAVAILABLE';
    throw new UploadError(signal.aborted?'PROCESSING_TIMEOUT':code);
  }
}
