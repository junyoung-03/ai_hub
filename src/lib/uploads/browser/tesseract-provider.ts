import {BROWSER_OCR} from '@/lib/uploads/ocr-contract';
import type {OCRPageInput} from '@/types/uploads';
import type {OCRProvider,OCRProgress} from './ocr-provider';

// Version-pinned Tesseract.js 7 Worker protocol, isolated behind this adapter.
// Owning the Worker handle permits immediate termination even during language/WASM
// initialization (createWorker's promise exposes its handle only after initialization).
export class BrowserTesseractProvider implements OCRProvider {
  private worker:Worker|null=null;
  private pending:{id:string;resolve:(value:Record<string,unknown>)=>void;reject:(error:Error)=>void}|null=null;
  private sequence=0;
  private page=0;
  private progress:(value:OCRProgress)=>void=()=>{};
  constructor(private spawn:(path:string)=>Worker=path=>new Worker(path)){}
  async initialize(signal:AbortSignal,onProgress:(value:OCRProgress)=>void){
    if(this.worker)throw new Error('OCR_FAILED');signal.throwIfAborted();this.progress=onProgress;
    this.worker=this.spawn('/ocr/tesseract-7/worker.min.js');
    this.worker.onmessage=event=>{
      const m=event.data as {jobId:string;status:string;data:Record<string,unknown>};
      if(m.status==='progress'){if(typeof m.data?.progress==='number')this.progress({page:this.page,progress:Math.max(0,Math.min(1,m.data.progress))});return;}
      if(m.jobId!==this.pending?.id)return;
      const pending=this.pending;this.pending=null;
      if(m.status==='resolve')pending.resolve(m.data);else pending.reject(new Error('OCR_FAILED'));
    };
    this.worker.onerror=()=>this.dispose();
    try{
      await this.job('load',{options:{lstmOnly:true,corePath:new URL('/ocr/tesseract-7/core',location.origin).href,logging:false}},signal);
      await this.job('loadLanguage',{langs:'kor+eng',options:{langPath:new URL('/ocr/tesseract-7/lang',location.origin).href,cachePath:'ai-hub-tesseract-7-best-int',cacheMethod:'write',gzip:true,lstmOnly:true}},signal);
      await this.job('initialize',{langs:'kor+eng',oem:1,config:{}},signal);
    }catch{this.dispose();throw new Error(signal.aborted?'OCR_CANCELLED':'OCR_FAILED');}
  }
  private job(action:string,payload:Record<string,unknown>,signal:AbortSignal):Promise<Record<string,unknown>>{
    if(!this.worker||this.pending)return Promise.reject(new Error('OCR_FAILED'));
    signal.throwIfAborted();
    return new Promise((resolve,reject)=>{
      const stop=()=>{this.dispose();reject(new Error(signal.aborted?'OCR_CANCELLED':'OCR_TIMEOUT'));};
      const timer=setTimeout(stop,120_000);
      const clean=()=>{clearTimeout(timer);signal.removeEventListener('abort',stop);};
      signal.addEventListener('abort',stop,{once:true});
      const id=String(++this.sequence);
      this.pending={id,resolve:value=>{clean();resolve(value);},reject:error=>{clean();reject(error);}};
      try{this.worker!.postMessage({workerId:'ai-hub-ocr',jobId:id,action,payload});}catch{this.dispose();}
    });
  }
  async recognize(page:number,image:Blob,signal:AbortSignal):Promise<OCRPageInput>{
    this.page=page;signal.throwIfAborted();
    const bytes=new Uint8Array(await image.arrayBuffer());signal.throwIfAborted();
    const result=await this.job('recognize',{image:bytes,options:{},output:{text:true,blocks:false,hocr:false,tsv:false}},signal);
    if(typeof result.text!=='string'||!result.text.trim())throw new Error('EMPTY_TEXT');
    if(Array.from(result.text).length>100_000||new TextEncoder().encode(result.text).length>400_000)throw new Error('TEXT_LIMIT');
    const confidence=typeof result.confidence==='number'&&Number.isFinite(result.confidence)?Math.max(0,Math.min(1,result.confidence/100)):null;
    return {page,text:result.text,...BROWSER_OCR,confidence};
  }
  dispose(){const worker=this.worker;this.worker=null;worker?.terminate();const pending=this.pending;this.pending=null;pending?.reject(new Error('OCR_FAILED'));}
}
