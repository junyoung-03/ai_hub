'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {runUpload,type UploadCheckpoint,type UploadPhase} from '@/lib/uploads/browser/flow';

// Functional controls only. Layout/design remains with the frontend team.
export function UploadControls({userId}:{userId:string}){
  const router=useRouter();const fileInput=useRef<HTMLInputElement|null>(null);
  const [file,setFile]=useState<File>();const [checkpoint,setCheckpoint]=useState<UploadCheckpoint>();
  const [phase,setPhase]=useState<UploadPhase>();const [progress,setProgress]=useState('');const [error,setError]=useState(false);const [itemId,setItemId]=useState<string>();
  const [busy,setBusy]=useState(false);
  const controller=useRef<AbortController|null>(null);const running=useRef(false);
  const storageKey=`ai-hub-upload:${userId}`;
  useEffect(()=>{let mounted=true;void Promise.resolve().then(()=>{try{const v=JSON.parse(localStorage.getItem(storageKey)??'null');if(mounted&&v&&/^[a-f0-9-]{36}$/.test(v.uploadId)&&/^[a-f0-9-]{36}$/.test(v.idempotencyKey))setCheckpoint(v);}catch{}});return()=>{mounted=false;controller.current?.abort();};},[storageKey]);
  async function start(){
    if(running.current)return;running.current=true;setBusy(true);const abort=new AbortController();controller.current=abort;setError(false);
    const current=checkpoint??{uploadId:'',idempotencyKey:crypto.randomUUID()};setCheckpoint(current);
    try{const result=await runUpload({file,checkpoint:current,signal:abort.signal,onCheckpoint:value=>{setCheckpoint(value);localStorage.setItem(storageKey,JSON.stringify(value));},onPhase:setPhase,onProgress:value=>setProgress(`${value.page>0?`페이지 ${value.page}`:"OCR 엔진 준비"}: ${Math.round(value.progress*100)}%`)});setItemId(result.itemId);setCheckpoint(undefined);localStorage.removeItem(storageKey);router.refresh();}
    catch{setError(true);}finally{controller.current=null;running.current=false;setBusy(false);}
  }
  return <section id="upload" className="panel mb-6 space-y-4 scroll-mt-6" aria-labelledby="upload-title" aria-busy={busy}>
    <div><h2 id="upload-title">자료 추가</h2><p className="mt-1 text-sm text-muted-foreground">PDF · PNG · JPG/JPEG, 최대 5MB / PDF 10페이지. 이미지와 스캔 문서는 이 기기에서 문자 인식합니다.</p></div>
    <label className="block text-sm">파일 선택<input ref={fileInput} className="field mt-2 file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1 file:text-primary" aria-label="PDF 또는 이미지 파일" type="file" accept="application/pdf,image/png,image/jpeg" disabled={busy||!!checkpoint?.uploadId} onChange={event=>{setFile(event.target.files?.[0]);setCheckpoint(undefined);setItemId(undefined);setPhase(undefined);setError(false);}} /></label>
    <div className="flex flex-wrap gap-3"><button className="btn-primary" type="button" disabled={busy||(!file&&!checkpoint?.uploadId)} onClick={()=>void start()}>{error||checkpoint?.uploadId?'재시도':'업로드'}</button>
    {busy&&<button className="btn-secondary" type="button" onClick={()=>controller.current?.abort()}>취소</button>}
    <button className="btn-secondary" type="button" disabled={busy} onClick={()=>{setCheckpoint(undefined);localStorage.removeItem(storageKey);setPhase(undefined);setError(false);setFile(undefined);setItemId(undefined);setProgress('');if(fileInput.current)fileInput.current.value='';}}>새 파일</button></div>
    <p role="status" className="text-sm text-muted-foreground">{phase==='ocr'?`문자 인식 중 ${progress}`:phase==='complete'?'추출 및 저장 완료':phase==='preparing'?'파일 검증 · 콘텐츠 추출 중':phase==='saving'?'저장 중':phase==='uploading'?'업로드 중':checkpoint?.uploadId?'이전 업로드를 재시도할 수 있습니다.':file?'파일 선택됨 · 업로드할 준비가 되었습니다.':'파일을 선택해 주세요.'}</p>
    {error&&<p role="alert">처리를 완료하지 못했습니다. 재시도하거나 새 파일을 선택해 주세요.</p>}
    {itemId&&<Link className="btn-secondary" href={`/items/${itemId}`}>자료 확인 →</Link>}
  </section>;
}
