import {createUpload} from "@/lib/uploads/service";
import {assertUploadOrigin,smallBody,uploadResponse,uploadFailure} from "@/lib/uploads/http";
import {UploadError} from "@/lib/uploads/contract";
export const runtime='nodejs';
export async function POST(request:Request){try{assertUploadOrigin(request);let body:unknown;try{body=JSON.parse(await smallBody(request));}catch{throw new UploadError('VALIDATION_ERROR');}return uploadResponse(await createUpload(body,request.headers.get('idempotency-key')),201);}catch(error){return uploadFailure(error);}}
