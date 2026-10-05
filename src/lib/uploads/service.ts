import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/auth";
import { inspectFile } from "@/lib/uploads/providers";
import { UPLOAD_BUCKET,UPLOAD_LIMITS,UploadError,uuid,record,parseUploadRequest,parseCompleteInput,mergeClientPages,uploadPath,verifyBytes,assemble,type UploadCode } from "@/lib/uploads/contract";
import type { Json } from "@/types/database";
import type { UploadRequest, PreparedUpload } from "@/types/uploads";
type Session={id:string;state:string;request:UploadRequest;path:string;itemId:string|null;attempt:string|null;rawHash:string|null;expiresAt:string};
async function sessionRpc(operation:string,userId:string,uploadId:string|null=null,options:{key?:string;request?:UploadRequest;payload?:Json;attempt?:string|null;signal?:AbortSignal}={}):Promise<Session>{
  const {data,error}=await createAdminClient(options.signal??AbortSignal.timeout(20000)).rpc('upload_session_rpc',{p_operation:operation,p_user_id:userId,p_upload_id:uploadId,p_key:options.key??null,p_request:options.request as unknown as Json??null,p_payload:options.payload??null,p_attempt:options.attempt??null});
  if(error)throw new UploadError(error.code==='23505'?'IDEMPOTENCY_CONFLICT':error.code==='55P03'?'UPLOAD_IN_PROGRESS':error.code==='40001'?'STALE_ATTEMPT':operation==='read'?'ITEM_NOT_FOUND':error.message?.includes('UPLOAD_EXPIRED')?'UPLOAD_EXPIRED':'STORAGE_UNAVAILABLE');
  const r=record(data);if(!uuid(r.id)||typeof r.state!=='string'||typeof r.path!=='string')throw new UploadError('STORAGE_UNAVAILABLE');
  const request=parseUploadRequest(r.request);if(r.path!==uploadPath(userId,r.id,request.mimeType))throw new UploadError('STORAGE_UNAVAILABLE');
  return {id:r.id,state:r.state,path:r.path,request,itemId:uuid(r.itemId)?r.itemId:null,attempt:uuid(r.attempt)?r.attempt:null,rawHash:typeof r.rawHash==='string'?r.rawHash:null,expiresAt:String(r.expiresAt)};
}
export async function createUpload(value:unknown,key:string|null){
  const user=await requireUser();if(!uuid(key))throw new UploadError('VALIDATION_ERROR');
  const request=parseUploadRequest(value),session=await sessionRpc('create',user.id,null,{key,request});
  if(session.itemId)return {uploadId:session.id,itemId:session.itemId,state:session.state};
  await sessionRpc('issue',user.id,session.id);
  const {data,error}=await createAdminClient(AbortSignal.timeout(20_000)).storage.from(UPLOAD_BUCKET).createSignedUploadUrl(session.path,{upsert:false});
  if(error||!data?.signedUrl)throw new UploadError('STORAGE_UNAVAILABLE');
  return {uploadId:session.id,storagePath:session.path,signedUploadUrl:data.signedUrl,expiresAt:new Date(Date.now()+2*3600000).toISOString(),completeBefore:session.expiresAt};
}
const active=new Set<string>();
async function completion(session:Session,userId:string,outcome:'created'|'reused',signal:AbortSignal){
  if(!session.itemId)throw new UploadError('ITEM_NOT_FOUND');
  const client=await createClient();
  const {data,error}=await client.from('items').select('id,source,format,processing_status').eq('user_id',userId).eq('source','upload').eq('id',session.itemId).abortSignal(signal).maybeSingle();
  if(error||!data)throw new UploadError('ITEM_NOT_FOUND');
  return {item:{id:data.id,source:data.source,format:data.format,processingStatus:data.processing_status},itemId:data.id,outcome,state:session.state};
}
export async function prepareUpload(id:string){return processUpload(id,'prepare');}
export async function completeUpload(id:string,input:unknown={pages:[]}){return processUpload(id,'complete',input);}
async function processUpload(id:string,operation:'prepare'|'complete',input:unknown={pages:[]}){
  const user=await requireUser();if(!uuid(id))throw new UploadError('VALIDATION_ERROR');
  if(active.has(user.id))throw new UploadError('UPLOAD_IN_PROGRESS');active.add(user.id);
  const deadline=Date.now()+UPLOAD_LIMITS.runMs,signal=AbortSignal.timeout(UPLOAD_LIMITS.runMs);let session:Session|null=null;
  try{
    session=await sessionRpc('read',user.id,id,{signal});
    if(session.itemId&&['complete','reused','cleaning','cleaned'].includes(session.state))return await completion(session,user.id,'reused',signal);
    if(!session.itemId&&Date.parse(session.expiresAt)<Date.now())throw new UploadError('UPLOAD_EXPIRED');
    session=await sessionRpc('reserve',user.id,id,{payload:{leaseMs:Math.max(1,deadline-Date.now())},signal});
    const storage=createAdminClient(signal).storage.from(UPLOAD_BUCKET);
    const {data:blob,error}=await storage.download(session.path);
    signal.throwIfAborted();if(error||!blob)throw new UploadError('STORAGE_UNAVAILABLE');
    if(blob.size!==session.request.size||blob.size>UPLOAD_LIMITS.bytes)throw new UploadError('FILE_LIMIT');
    const bytes=Buffer.from(await blob.arrayBuffer()),rawHash=verifyBytes(bytes,session.request);
    if(session.rawHash&&session.rawHash!==rawHash)throw new UploadError('INVALID_FILE');
    // Full parser/decoder preflight occurs before any pending ITEM is created.
    const plan=await inspectFile(bytes,session.request.mimeType,signal);if(plan.rawHash!==rawHash)throw new UploadError('INVALID_FILE');
    session=await sessionRpc('pending',user.id,id,{payload:{rawHash},attempt:session.attempt,signal});
    if(session.state==='reused'||session.state==='complete')return await completion(session,user.id,'reused',signal);
    if(operation==='prepare'&&plan.pages.some(p=>p.method==='ocr')){
      session=await sessionRpc('release',user.id,id,{attempt:session.attempt,signal});
      const original=await uploadOriginal(session.itemId!);
      return {uploadId:id,itemId:session.itemId!,state:'stored',pages:plan.pages.map(p=>({page:p.page,method:p.method})),mime:session.request.mimeType,downloadUrl:original.downloadUrl} satisfies PreparedUpload;
    }
    const pages=mergeClientPages(plan,parseCompleteInput(input));
    session=await sessionRpc('claim',user.id,id,{attempt:session.attempt,signal});
    if(session.state==='reused'||session.state==='complete')return await completion(session,user.id,'reused',signal);
    const result=assemble(pages);signal.throwIfAborted();
    session=await sessionRpc('finish',user.id,id,{payload:result as unknown as Json,attempt:session.attempt,signal});
    return await completion(session,user.id,'created',signal);
  }catch(error){
    const safe=error instanceof UploadError?error:new UploadError(signal.aborted?'PROCESSING_TIMEOUT':'STORAGE_UNAVAILABLE');
    if(session?.attempt&&session.state==='running'&&safe.code!=='STALE_ATTEMPT'){
      try{await sessionRpc('fail',user.id,id,{attempt:session.attempt,payload:{error:safe.code}});}catch{/* Stale writer never overwrites the current attempt. */}
    }else if(session&&!session.itemId&&['UNSUPPORTED_FILE','INVALID_FILE','PDF_ENCRYPTED','PDF_UNSAFE','PDF_LAYOUT_NEEDS_REVIEW','FILE_LIMIT'].includes(safe.code)){
      try{await sessionRpc('reject',user.id,id,{attempt:session.attempt});}catch{/* Orphan cleanup remains session-bound. */}
    }
    if(session?.attempt&&session.state!=='running'){try{await sessionRpc('release',user.id,id,{attempt:session.attempt});}catch{/* An expired/rejected lease is already recoverable. */}}
    throw safe;
  }finally{active.delete(user.id);}
}
export async function uploadOriginal(id:string){
  const user=await requireUser();if(!uuid(id))throw new UploadError('ITEM_NOT_FOUND');
  const cookie=await createClient();
  const {data:item,error}=await cookie.from('items').select('external_id,storage_path,mime_type,metadata').eq('id',id).eq('user_id',user.id).eq('source','upload').maybeSingle();
  if(error)throw new UploadError('STORAGE_UNAVAILABLE');if(!item||!uuid(item.external_id))throw new UploadError('ITEM_NOT_FOUND');
  const mime=item.mime_type;if(!['application/pdf','image/png','image/jpeg'].includes(mime??'')||item.storage_path!==uploadPath(user.id,item.external_id,mime as UploadRequest['mimeType'])||record(record(item.metadata).upload).validated!==true)throw new UploadError('ITEM_NOT_FOUND');
  const {data,error:signedError}=await cookie.storage.from(UPLOAD_BUCKET).createSignedUrl(item.storage_path,60,{download:true});
  if(signedError||!data?.signedUrl)throw new UploadError('STORAGE_UNAVAILABLE');
  return {downloadUrl:data.signedUrl,expiresAt:new Date(Date.now()+60000).toISOString()};
}
export const uploadErrorStatus=(code:UploadCode)=>code==='FORBIDDEN'?403:code==='ITEM_NOT_FOUND'?404:['IDEMPOTENCY_CONFLICT','UPLOAD_IN_PROGRESS','STALE_ATTEMPT'].includes(code)?409:code==='UPLOAD_EXPIRED'?410:['STORAGE_UNAVAILABLE','WORKER_UNAVAILABLE','OCR_UNAVAILABLE'].includes(code)?503:422;
