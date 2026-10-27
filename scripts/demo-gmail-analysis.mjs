// Operator-only real demo. Existing analysis/storage, explicit single owner + 1-3 IDs.
// Never impersonates browser cookies; this verifies the server/DB flow only.
import nextEnv from '@next/env';
import {loadAnalysisModule as load} from '../tests/helpers/analysis-loader.mjs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
nextEnv.loadEnvConfig(process.cwd());
const arg=name=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3);
const userId=arg('user'), ids=[...new Set((arg('items')??'').split(',').filter(Boolean))];
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
if(!uuid(userId)||!ids.length||ids.length>3||ids.some(v=>!uuid(v)))throw new Error('EXPLICIT_DEMO_SCOPE_REQUIRED');
if(process.env.GEMINI_FREE_TIER_CONFIRMED!=='true')throw new Error('VERIFY_KEY_PROJECT_FREE_TIER_FIRST');
const env=load('src/lib/supabase/env.ts');
const adminModule=load('src/lib/supabase/admin.ts',{'@/lib/supabase/env':env});
const admin=adminModule.createAdminClient();
const identity=await admin.auth.admin.getUserById(userId);
if(identity.error||!identity.data.user)throw new Error('DEMO_OWNER_UNAVAILABLE');
const validator=load('src/lib/gemini/validation.ts');
const ajv=new Ajv({allowUnionTypes:true});addFormats(ajv);const structural=ajv.compile(validator.legacySchema);
const diagnosticValidator={...validator,validateAnalysis(value,...args){
  try{return validator.validateAnalysis(value,...args);}catch(error){
    if(error.rule==='SCHEMA'&&!structural(value))console.log(JSON.stringify({validationErrors:structural.errors.map(e=>({keyword:e.keyword,path:e.instancePath,missingProperty:e.params.missingProperty}))}));
    throw error;
  }
}};
const provider=load('src/lib/gemini/client.ts',{'@/lib/gemini/validation':diagnosticValidator});
let providerCalls=0;
const gemini={...provider,analyzeGmailText:(text,topics,context,version)=>{providerCalls++;return provider.analyzeGmailText(text,topics,context,version,{maxAttempts:1});}};
const failure=load('src/lib/items/analysis-failure.ts',{'@/lib/gemini/client':gemini,'@/lib/gemini/validation':validator});
const analysis=load('src/lib/items/analysis.ts',{
  '@/lib/gemini/client':gemini,'@/lib/gemini/validation':validator,'@/lib/items/analysis-failure':failure,
  '@/lib/items/filters':{isItemId:uuid},'@/lib/supabase/admin':adminModule,
  '@/lib/supabase/auth':{requireUser:async()=>identity.data.user},
  '@/lib/supabase/server':{createClient:async()=>admin},
},{process:{env:{...process.env,GMAIL_ANALYSIS_WORKER_ENABLED:'false',PROMOTIONAL_NOISE_ENABLED:'false'}}});
for(const [index,id] of ids.entries()) {
  // Space requests even when the provider immediately rejects; no parallel calls.
  if(index)await new Promise(resolve=>setTimeout(resolve,60_000));
  const item=await admin.from('items').select('source,format').eq('id',id).eq('user_id',userId).single();
  if(item.error||item.data?.source!=='gmail'||item.data.format!=='email')throw new Error('DEMO_ITEM_OWNER_OR_SOURCE_MISMATCH');
  if(!process.argv.includes('--apply')){console.log(JSON.stringify({id,dryRun:true}));continue;}
  try {
    const beforeCalls=providerCalls;
    await analysis.analyzeOwnedItem(id);
    const saved=await admin.from('items').select('metadata,processing_status').eq('id',id).eq('user_id',userId).single();
    const classification=await admin.from('classifications').select('ai_primary_topic,ai_document_type').eq('item_id',id).eq('user_id',userId).single();
    if(saved.error||classification.error||!saved.data?.metadata?.aiAnalysis)throw new Error('DEMO_PERSISTENCE_NOT_CONFIRMED');
    const result=saved.data.metadata.aiAnalysis.result;
    console.log(JSON.stringify({id,result:'PERSISTED',providerCalls:providerCalls-beforeCalls,status:saved.data.processing_status,classification:classification.data,actions:result.actions.length,events:result.eventObservations.length}));
  } catch(error) {
    console.log(JSON.stringify({id,result:'FAILED',...failure.analysisFailure(error),...(error instanceof validator.AnalysisValidationError ? {validationRule:error.rule} : {})}));
    // A provider/config failure affects all mails. Preserve remaining quota and stop.
    if(error instanceof provider.GeminiAnalysisError)break;
  }
}
