import {completeUpload} from "@/lib/uploads/service";
import {assertUploadOrigin,smallBody,uploadResponse,uploadFailure} from "@/lib/uploads/http";
import {UploadError} from "@/lib/uploads/contract";
import {parseCompleteInput} from "@/lib/uploads/contract";
import {OCR_JSON_BYTES} from "@/lib/uploads/ocr-contract";
export const runtime='nodejs';export const maxDuration=150;
export async function POST(request:Request,{params}:{params:Promise<{uploadId:string}>}){try{assertUploadOrigin(request);const body=await smallBody(request,OCR_JSON_BYTES);let input;try{input=JSON.parse(body);}catch{throw new UploadError('VALIDATION_ERROR');}const parsed=parseCompleteInput(input);return uploadResponse(await completeUpload((await params).uploadId,parsed),202);}catch(error){return uploadFailure(error);}}
