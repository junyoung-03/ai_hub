"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function AnalyzeControl({ itemId }: { itemId: string }) {
  const router = useRouter(); const [busy,setBusy]=useState(false); const [message,setMessage]=useState(""); const [error,setError]=useState(false);
  async function analyze() { setBusy(true); setMessage(""); setError(false); try {
    const response=await fetch(`/api/v1/items/${itemId}/analyze`,{method:"POST",cache:"no-store"});
    if(!response.ok)throw new Error(); setMessage("분석 결과가 저장되었습니다."); router.refresh();
  }catch{setError(true);setMessage("분석을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");}finally{setBusy(false);} }
  return <div className="space-y-3"><p className="text-sm text-muted-foreground">분석하면 이 메일의 본문이 Gemini로 전송됩니다. 원문에 근거한 분류와 할 일을 추출합니다.</p><button disabled={busy} className="btn-secondary" onClick={()=>void analyze()}>{busy?"AI 분석 중…":"AI 분석하기"}</button>{message&&<p role={error?"alert":"status"} className="text-sm">{message}</p>}</div>;
}

export function OriginalAccess({ itemId }: { itemId: string }) {
  const [url,setUrl]=useState(""); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  async function open() { setBusy(true); setError(""); setUrl(""); try {
    const response=await fetch(`/api/v1/items/${itemId}/original`,{cache:"no-store"});
    if(!response.ok) throw new Error(); const body=await response.json() as {downloadUrl?:string};
    if(!body.downloadUrl || new URL(body.downloadUrl).protocol!=="https:") throw new Error(); setUrl(body.downloadUrl);
  } catch {setError("원본을 열지 못했습니다. 다시 시도해 주세요.");} finally{setBusy(false);} }
  useEffect(()=>{if(!url)return;const timer=setTimeout(()=>setUrl(""),55000);return()=>clearTimeout(timer);},[url]);
  return <div className="space-y-2"><button className="btn-secondary" disabled={busy} onClick={()=>void open()}>{busy?"원본 준비 중…":"업로드 원본 준비"}</button>{url&&<a className="btn-primary ml-2" href={url} target="_blank" rel="noopener noreferrer">원본 열기 ↗</a>}{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}</div>;
}
type Similar = { status:string; results:{itemId:string;title:string;source:string}[] };
export function SimilarItems({itemId}:{itemId:string}) {
  const [data,setData]=useState<Similar>();const [error,setError]=useState(false);const [attempt,setAttempt]=useState(0);
  useEffect(()=>{const controller=new AbortController();void fetch(`/api/v1/items/${itemId}/similar`,{cache:"no-store",signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error();return r.json() as Promise<Similar>;}).then(v=>{if(!controller.signal.aborted){setData(v);setError(false);}}).catch(()=>{if(!controller.signal.aborted)setError(true);});return()=>controller.abort();},[itemId,attempt]);
  return <section className="panel mt-6"><h2>비슷한 자료</h2>{error?<div role="alert" className="mt-3"><p>비슷한 자료를 불러오지 못했습니다.</p><button className="btn-secondary mt-2" onClick={()=>setAttempt(v=>v+1)}>다시 시도</button></div>:!data?<p role="status" className="mt-3 text-muted-foreground">연관 자료를 확인하는 중…</p>:data.status==="not_indexed"?<p className="mt-3 text-muted-foreground">의미 색인이 완료된 자료에서 비슷한 자료를 확인할 수 있습니다.</p>:!data.results.length?<p className="mt-3 text-muted-foreground">연결할 비슷한 자료가 없습니다.</p>:<ul className="mt-3 divide-y">{data.results.map(r=><li key={r.itemId} className="py-3"><Link className="break-words text-primary" href={`/items/${r.itemId}`}>{r.title} →</Link></li>)}</ul>}</section>;
}
