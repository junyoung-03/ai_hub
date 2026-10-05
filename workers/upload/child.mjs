import { inspectBytes } from './parser.mjs';
// No request-controlled URLs, network requests or provider credentials in the parser process.
globalThis.fetch=async()=>{throw new Error('NETWORK_DISABLED');};
console.log=()=>{};console.warn=()=>{};console.error=()=>{};
let used=false;
process.on('message',async input=>{
  if(used)return;used=true;
  try{const result=await inspectBytes(Buffer.from(input.bytes,'base64'),input.mime,{render:input.render!==false});process.send?.({result});}
  catch(error){process.send?.({error:typeof error.code==='string'?error.code:'INVALID_FILE'});}
  finally{process.disconnect();}
});
