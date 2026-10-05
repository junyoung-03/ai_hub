import type {PreparedUpload} from '@/types/uploads';
const shape=(width:number,height:number)=>{if(width<1||height<1||width>10_000||height>10_000||width*height>20_000_000)throw new Error('FILE_LIMIT');};
const png=(canvas:HTMLCanvasElement)=>new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('INVALID_FILE')),'image/png'));
export async function* renderOCRPages(original:Blob,plan:PreparedUpload,signal:AbortSignal):AsyncGenerator<{page:number;image:Blob}>{
  if(plan.mime!=='application/pdf'){
    signal.throwIfAborted();const bitmap=await createImageBitmap(original,{imageOrientation:'from-image'});const canvas=document.createElement('canvas');
    try{shape(bitmap.width,bitmap.height);canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d')!.drawImage(bitmap,0,0);signal.throwIfAborted();yield {page:1,image:await png(canvas)};}
    finally{bitmap.close();canvas.width=0;canvas.height=0;}return;
  }
  const pdfjs=await import('pdfjs-dist/build/pdf.mjs');signal.throwIfAborted();
  pdfjs.GlobalWorkerOptions.workerSrc='/ocr/pdfjs-6.4.299/pdf.worker.min.mjs';
  const options={data:new Uint8Array(await original.arrayBuffer()),isEvalSupported:false,enableXfa:false,stopAtErrors:true,verbosity:0,maxImageSize:20_000_000,disableAutoFetch:true,disableStream:true,useWorkerFetch:false};
  const task=pdfjs.getDocument(options);
  const abort=()=>{void task.destroy();};signal.addEventListener('abort',abort,{once:true});
  try{
    const doc=await task.promise;if(doc.numPages!==plan.pages.length||doc.numPages>10)throw new Error('INVALID_FILE');
    for(const entry of plan.pages.filter(p=>p.method==='ocr')){
      signal.throwIfAborted();const page=await doc.getPage(entry.page),viewport=page.getViewport({scale:200/72});shape(Math.ceil(viewport.width),Math.ceil(viewport.height));
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      try{await page.render({canvas,canvasContext:canvas.getContext('2d')!,viewport,annotationMode:pdfjs.AnnotationMode.DISABLE}).promise;signal.throwIfAborted();yield {page:entry.page,image:await png(canvas)};}
      finally{page.cleanup();canvas.width=0;canvas.height=0;}
    }
  }finally{signal.removeEventListener('abort',abort);await task.destroy();}
}
