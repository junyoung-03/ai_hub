// Read-only provider model metadata. Does not generate content or print credentials/raw responses.
process.loadEnvFile('.env.local');
const model=process.env.GEMINI_MODEL; if(!/^gemini-[a-z0-9.-]+$/.test(model??''))throw new Error('Model configuration invalid');
try{const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}`,{headers:{'x-goog-api-key':process.env.GEMINI_API_KEY},signal:AbortSignal.timeout(20000)});const b=await r.json();console.log(JSON.stringify({http:r.status,model:r.ok?b.name:model,generationSupported:r.ok?b.supportedGenerationMethods?.includes('generateContent'):null}));}
catch{console.log('Model metadata unavailable; no generation attempted.');process.exitCode=1;}
