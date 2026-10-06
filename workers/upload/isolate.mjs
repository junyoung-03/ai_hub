import { fork } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { inspectBytes } from './parser.mjs';

function resolveChildPath() {
  const candidates = [];
  try {
    candidates.push(fileURLToPath(new URL('./child.mjs', import.meta.url)));
  } catch {}
  candidates.push(
    resolvePath(process.cwd(), 'workers/upload/child.mjs'),
    resolvePath(process.cwd(), '.next/server/workers/upload/child.mjs'),
    resolvePath(process.cwd(), 'app/workers/upload/child.mjs')
  );
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** @param {Buffer} bytes @param {string} mime @param {{timeout?:number,signal?:AbortSignal,render?:boolean}} options */
export function isolatedInspect(bytes,mime,{timeout=120000,signal,render=true}={}){
  const childPath = resolveChildPath();
  if (childPath && existsSync(childPath)) {
    return new Promise((resolve,reject)=>{
      if(signal?.aborted){reject(new Error('PROCESSING_TIMEOUT'));return;}
      // Runtime path is explicitly traced by Next config, not rewritten into a bundle URL.
      const child=Reflect.apply(fork,undefined,[childPath,[],{execArgv:['--max-old-space-size=192'],stdio:['ignore','ignore','ignore','ipc']}]);
      let settled=false;
      const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);child.kill();if(error)reject(new Error(error));else resolve(result);};
      const abort=()=>finish('PROCESSING_TIMEOUT'),timer=setTimeout(abort,timeout);
      signal?.addEventListener('abort',abort,{once:true});
      child.on('error',()=>finish('WORKER_UNAVAILABLE'));child.on('exit',()=>finish('WORKER_UNAVAILABLE'));
      child.on('message',message=>message?.error?finish(message.error):finish(null,message?.result));
      child.send({bytes:bytes.toString('base64'),mime,render});
    });
  }
  return inspectBytes(bytes, mime, { render }).catch(error => {
    throw new Error(typeof error?.code === 'string' ? error.code : 'INVALID_FILE');
  });
}
