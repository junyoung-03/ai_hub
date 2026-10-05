// Private IAM-authenticated Cloud Run service. No DB/Storage/OCR secrets required here.
import { createServer } from 'node:http';
import { isolatedInspect } from './isolate.mjs';
let busy=false;
const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'||req.url!=='/inspect'){res.writeHead(404);res.end('{}');return;}
  if(busy){res.writeHead(429);res.end('{"error":"UPLOAD_IN_PROGRESS"}');return;}
  busy=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);
  req.once('aborted',()=>controller.abort());
  try{
    let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>6800000)throw new Error('FILE_LIMIT');chunks.push(chunk);}
    const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(Object.keys(input).sort().join(',')!=='bytes,mime'||typeof input.bytes!=='string'||!['application/pdf','image/png','image/jpeg'].includes(input.mime))throw new Error('INVALID_FILE');
    const result=await isolatedInspect(Buffer.from(input.bytes,'base64'),input.mime,{signal:controller.signal});res.end(JSON.stringify(result));
  }catch(error){const allowed=['FILE_LIMIT','UNSUPPORTED_FILE','INVALID_FILE','PDF_ENCRYPTED','PDF_UNSAFE','PDF_LAYOUT_NEEDS_REVIEW','TEXT_LIMIT','PROCESSING_TIMEOUT','WORKER_UNAVAILABLE'];res.writeHead(422);res.end(JSON.stringify({error:allowed.includes(error.message)?error.message:'INVALID_FILE'}));}
  finally{clearTimeout(timer);busy=false;}
});
server.requestTimeout=125000;server.headersTimeout=10000;server.listen(Number(process.env.PORT??8080),'0.0.0.0');
