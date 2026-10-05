export type OCRProgress={page:number;progress:number};
// Generic result contract. Each deployed server separately validates its active allowlist.
export type OCRSubmission={page:number;text:string;confidence:number|null;provider:string;providerVersion:string;execution:'client'|'server';language:string|null};
export interface OCRProvider {
  initialize(signal:AbortSignal,onProgress:(progress:OCRProgress)=>void):Promise<void>;
  recognize(page:number,image:Blob,signal:AbortSignal):Promise<OCRSubmission>;
  dispose():void;
}
