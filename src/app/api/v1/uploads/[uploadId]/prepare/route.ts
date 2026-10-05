import {prepareUpload} from '@/lib/uploads/service';
import {assertUploadOrigin,smallBody,uploadResponse,uploadFailure} from '@/lib/uploads/http';
import {UploadError} from '@/lib/uploads/contract';
export const runtime='nodejs';
export const maxDuration=150;
export async function POST(request:Request,{params}:{params:Promise<{uploadId:string}>}){
  try{assertUploadOrigin(request);const body=await smallBody(request,64);if(body&&body!=='{}')throw new UploadError('VALIDATION_ERROR');return uploadResponse(await prepareUpload((await params).uploadId),202);}
  catch(error){return uploadFailure(error);}
}
