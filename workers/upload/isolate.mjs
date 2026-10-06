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

function directInspect(bytes, mime, { timeout, signal, render }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('PROCESSING_TIMEOUT')); return; }
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(new Error(error));
      else resolve(result);
    };
    const abort = () => finish('PROCESSING_TIMEOUT'), timer = setTimeout(abort, timeout);
    signal?.addEventListener('abort', abort, { once: true });
    inspectBytes(bytes, mime, { render }).then(
      result => finish(null, result),
      error => finish(typeof error?.code === 'string' ? error.code : 'INVALID_FILE')
    );
  });
}

/** @param {Buffer} bytes @param {string} mime @param {{timeout?:number,signal?:AbortSignal,render?:boolean,_fork?:typeof fork}} options */
export function isolatedInspect(bytes, mime, { timeout = 120000, signal, render = true, _fork = fork } = {}) {
  const isVercelRuntime = Boolean(process.env.VERCEL) && (mime === 'image/png' || mime === 'image/jpeg' || mime === 'application/pdf');
  if (isVercelRuntime) {
    return directInspect(bytes, mime, { timeout, signal, render });
  }

  const childPath = resolveChildPath();
  if (childPath && existsSync(/*turbopackIgnore: true*/ childPath)) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('PROCESSING_TIMEOUT')); return; }
      // Runtime path is explicitly traced by Next config, not rewritten into a bundle URL.
      const child = Reflect.apply(_fork, undefined, [childPath, [], { execArgv: ['--max-old-space-size=192'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }]);
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        child.kill();
        if (error) reject(new Error(error));
        else resolve(result);
      };
      const abort = () => finish('PROCESSING_TIMEOUT'), timer = setTimeout(abort, timeout);
      signal?.addEventListener('abort', abort, { once: true });
      child.on('error', () => finish('WORKER_UNAVAILABLE'));
      child.on('exit', () => finish('WORKER_UNAVAILABLE'));
      child.on('message', message => message?.error ? finish(message.error) : finish(null, message?.result));
      child.send({ bytes: bytes.toString('base64'), mime, render });
    });
  }
  return directInspect(bytes, mime, { timeout, signal, render });
}
