import { AuthenticationRequiredError } from "@/lib/supabase/auth";
import { UploadError } from "@/lib/uploads/contract";
import { uploadErrorStatus } from "@/lib/uploads/service";
export const uploadResponse=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Pragma:'no-cache'}});
export function uploadFailure(error:unknown){
  const code=error instanceof AuthenticationRequiredError?'UNAUTHORIZED':error instanceof UploadError?error.code:'INTERNAL_ERROR';
  return uploadResponse({error:{code,message:'업로드 요청을 완료하지 못했습니다.',details:{}}},code==='UNAUTHORIZED'?401:error instanceof UploadError?uploadErrorStatus(error.code):500);
}
export function assertUploadOrigin(request:Request){if(request.headers.get('origin')!==new URL(request.url).origin)throw new UploadError('FORBIDDEN');}
export async function smallBody(request:Request,max=1024){
  const length=request.headers.get('content-length');if(length&&Number(length)>max)throw new UploadError('VALIDATION_ERROR');
  const reader=request.body?.getReader();if(!reader)return '';
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new UploadError('VALIDATION_ERROR');}chunks.push(value);}return Buffer.concat(chunks).toString('utf8');}finally{reader.releaseLock();}
}
