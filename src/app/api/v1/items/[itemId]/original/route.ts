import {uploadOriginal} from "@/lib/uploads/service";
import {uploadResponse,uploadFailure} from "@/lib/uploads/http";
export const runtime='nodejs';
export async function GET(_request:Request,{params}:{params:Promise<{itemId:string}>}){try{return uploadResponse(await uploadOriginal((await params).itemId));}catch(error){return uploadFailure(error);}}
