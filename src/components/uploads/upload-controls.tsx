'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {runUpload,type UploadCheckpoint,type UploadPhase} from '@/lib/uploads/browser/flow';
import {runBoundedAnalysis} from '@/lib/items/browser-analysis';
import {uploadErrorMessage} from '@/lib/uploads/browser/error-message';

// Preserve the existing upload checkpoint and on-device OCR workflow.
export function UploadControls({userId}:{userId:string}){
  const router=useRouter();const fileInput=useRef<HTMLInputElement|null>(null);const uploadPanel=useRef<HTMLDetailsElement|null>(null);
  const [file,setFile]=useState<File>();const [checkpoint,setCheckpoint]=useState<UploadCheckpoint>();
  const [phase,setPhase]=useState<UploadPhase>();const [progress,setProgress]=useState('');const [error,setError]=useState('');const [itemId,setItemId]=useState<string>();
  const [busy,setBusy]=useState(false);
  const [analysisMessage,setAnalysisMessage]=useState('');
  const controller=useRef<AbortController|null>(null);const running=useRef(false);
  const storageKey=`ai-hub-upload:${userId}`;
  useEffect(()=>{const expand=()=>{if(window.location.hash==='#upload'&&uploadPanel.current)uploadPanel.current.open=true;};expand();window.addEventListener('hashchange',expand);return()=>window.removeEventListener('hashchange',expand);},[]);
  useEffect(()=>{let mounted=true;void Promise.resolve().then(()=>{try{const v=JSON.parse(localStorage.getItem(storageKey)??'null');if(mounted&&v&&/^[a-f0-9-]{36}$/.test(v.uploadId)&&/^[a-f0-9-]{36}$/.test(v.idempotencyKey))setCheckpoint(v);}catch{}});return()=>{mounted=false;controller.current?.abort();};},[storageKey]);
  async function start(){
    if(running.current)return;running.current=true;setBusy(true);const abort=new AbortController();controller.current=abort;setError('');
    const current=checkpoint??{uploadId:'',idempotencyKey:crypto.randomUUID()};setCheckpoint(current);
    try{const result=await runUpload({file,checkpoint:current,signal:abort.signal,onCheckpoint:value=>{setCheckpoint(value);localStorage.setItem(storageKey,JSON.stringify(value));},onPhase:setPhase,onProgress:value=>setProgress(`${value.page>0?`페이지 ${value.page}`:"OCR 엔진 준비"}: ${Math.round(value.progress*100)}%`)});setItemId(result.itemId);setCheckpoint(undefined);localStorage.removeItem(storageKey);router.refresh();await runBoundedAnalysis([result.itemId],setAnalysisMessage,abort.signal);router.refresh();}
    catch(failure){setError(uploadErrorMessage(abort.signal.aborted?'UPLOAD_CANCELLED':failure instanceof Error?failure.message:undefined));}finally{controller.current=null;running.current=false;setBusy(false);}
  }
  return <details ref={uploadPanel} id="upload" className="panel mb-7 scroll-mt-20" aria-labelledby="upload-title" aria-busy={busy}>
    <summary className="cursor-pointer text-base font-medium" id="upload-title">자료 추가 <span className="ml-2 text-sm font-normal text-muted-foreground">PDF · 이미지</span></summary><div className="mt-5 space-y-4"><div><p className="mt-1 text-sm text-muted-foreground">PDF · PNG · JPG/JPEG, 최대 5MB / PDF 10페이지. 이미지와 스캔 문서는 이 기기에서 문자 인식합니다. 저장 후 본문을 Gemini로 보내 AI 분석합니다. 민감한 자료는 올리지 마세요.</p></div>
    <input ref={fileInput} className="hidden" aria-label="PDF 또는 이미지 파일" type="file" accept="application/pdf,image/png,image/jpeg" disabled={busy||!!checkpoint?.uploadId} onChange={event=>{const selected=event.target.files?.[0];if(!selected)return;setFile(selected);setCheckpoint(undefined);setItemId(undefined);setPhase(undefined);setError('');setAnalysisMessage('');}} />
    <button className="flex min-h-48 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-line bg-canvas p-6 text-center text-sm hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50" type="button" aria-label="PDF 또는 이미지 파일 선택" disabled={busy||!!checkpoint?.uploadId} onClick={()=>fileInput.current?.click()}><span className="mb-2 text-base font-medium">이 영역을 눌러 파일을 선택하세요</span><span className="text-muted-foreground">PDF · PNG · JPG/JPEG</span>{file&&<span className="mt-3 max-w-full break-all font-medium">선택한 파일: {file.name}</span>}{checkpoint?.uploadId&&<span className="mt-3 text-muted-foreground">다른 파일을 선택하려면 초기화를 눌러 주세요.</span>}</button>
    <div className="flex flex-wrap gap-3"><button className="btn-primary" type="button" disabled={busy||(!file&&!checkpoint?.uploadId)} onClick={()=>void start()}>{error||checkpoint?.uploadId?'재시도':'업로드'}</button>
    {busy&&<button className="btn-secondary" type="button" onClick={()=>controller.current?.abort()}>취소</button>}
    <button className="btn-secondary" type="button" disabled={busy} onClick={()=>{setCheckpoint(undefined);localStorage.removeItem(storageKey);setPhase(undefined);setError('');setFile(undefined);setItemId(undefined);setProgress('');setAnalysisMessage('');if(fileInput.current)fileInput.current.value='';}}>초기화</button></div>
    <p role="status" className="text-sm text-muted-foreground">{error?'업로드 처리 중단':phase==='ocr'?`문자 인식 중 ${progress}`:phase==='complete'?'추출 및 저장 완료':phase==='preparing'?'파일 검증 · 콘텐츠 추출 중':phase==='saving'?'저장 중':phase==='uploading'?'업로드 중':checkpoint?.uploadId?'이전 업로드를 재시도할 수 있습니다.':file?'파일 선택됨 · 업로드할 준비가 되었습니다.':'파일을 선택해 주세요.'}</p>
    {error&&<p role="alert">{error}</p>}
    {analysisMessage&&<p role="status" className="text-sm">{analysisMessage}</p>}
    {itemId&&<Link className="btn-secondary" href={`/items/${itemId}`}>자료 확인 →</Link>}
  </div></details>;
}
