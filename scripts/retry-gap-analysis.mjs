// One explicit retry of the browser-created synthetic ITEM. No private source or raw response logs.
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {loadAnalysisModule as load} from './analysis-loader.mjs';
process.loadEnvFile('.env.local');assert.equal(process.env.GAP_E2E_PROJECT,'oclzdppdiljbojvqtkeu');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;assert.equal(new URL(url).hostname,'oclzdppdiljbojvqtkeu.supabase.co');
const admin=createClient(url,process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {data:item,error}=await admin.from('items').select('id,user_id,title,content_text').eq('id','5f78d244-06eb-403d-adc0-9789e072d366').single();
assert.ok(!error&&item.title==='synthetic-backend-gap.pdf'&&item.content_text.startsWith('SYNTHETIC BACKEND GAP TEST - NO PERSONAL DATA'));
const {data:identity,error:identityError}=await admin.auth.admin.getUserById(item.user_id);assert.ok(!identityError&&identity.user.id===item.user_id);
const validator=load('src/lib/gemini/validation.ts');let calls=0;
const gemini=load('src/lib/gemini/client.ts',{'@/lib/gemini/validation':validator},{fetch:async(...args)=>{
 calls++;const r=await fetch(...args);console.log(`Gemini attempt ${calls}: HTTP ${r.status}`);
 if(r.ok){const b=await r.clone().json();console.log('Safe response diagnostics: '+JSON.stringify({finishReason:b.candidates?.[0]?.finishReason,parts:b.candidates?.[0]?.content?.parts?.map(p=>({thought:p.thought===true,hasText:typeof p.text==='string'})),tokens:b.usageMetadata?.totalTokenCount}));}
 return r;
}});
const filters={isItemId:v=>/^[a-f0-9-]{36}$/.test(v)};
const analysis=load('src/lib/items/analysis.ts',{'@/lib/gemini/client':gemini,'@/lib/gemini/validation':validator,'@/lib/items/filters':filters,'@/lib/supabase/auth':{requireUser:async()=>identity.user},'@/lib/supabase/server':{createClient:async()=>admin},'@/lib/supabase/admin':{createAdminClient:()=>admin}});
try{const result=await analysis.analyzeOwnedItem(item.id);console.log(JSON.stringify({result:'PASS',calls,cached:result.cached,actions:result.action_count}));}
catch(error){console.error(JSON.stringify({result:'FAIL',calls,code:error.code??'ANALYSIS_FAILED',rule:error.rule??null,http:error.httpStatus??null}));process.exitCode=1;}
