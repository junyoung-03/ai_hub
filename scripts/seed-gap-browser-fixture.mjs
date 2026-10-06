// Clearly labelled synthetic AI-result fixture for browser write E2E while Gemini returns 503.
// This is NOT a successful model analysis. Only the single browser-created synthetic PDF is touched.
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {loadAnalysisModule as load} from './analysis-loader.mjs';
process.loadEnvFile('.env.local');assert.equal(process.env.GAP_E2E_PROJECT,'oclzdppdiljbojvqtkeu');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;assert.equal(new URL(url).hostname,'oclzdppdiljbojvqtkeu.supabase.co');
const admin=createClient(url,process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {data:item,error}=await admin.from('items').select('id,user_id,title,content_text,content_hash').eq('id','5f78d244-06eb-403d-adc0-9789e072d366').single();
assert.ok(!error&&item.title==='synthetic-backend-gap.pdf'&&item.content_text.startsWith('SYNTHETIC BACKEND GAP TEST - NO PERSONAL DATA'));
const quote=text=>({text,locator:{kind:'unknown',page:null,section:null,startChar:null,endChar:null,field:null}}),none=()=>({status:'none',date:null,datetime:null,rawText:null,evidence:null});
const deadline='You must submit the sample application form by October 15, 2026.';
const event='The information session is on October 20, 2026. This is not a submission deadline.';
const v=load('src/lib/gemini/validation.ts').validateAnalysis({schemaVersion:'0.2',classification:{primaryTopic:'합성 결과 fixture · 신청',documentType:'application',tags:['합성','fixture']},actions:[{title:'합성 테스트 신청서 제출',actionType:'required',requirements:['Required document: sample application form.'],conditions:['This request applies to participants of the synthetic test only.'],evidence:[quote(deadline)],startObservation:none(),deadlineObservation:{status:'confirmed',date:'2026-10-15',datetime:null,rawText:'October 15, 2026',evidence:quote(deadline)}}],eventObservations:[{status:'confirmed',date:'2026-10-20',datetime:null,rawText:'October 20, 2026',evidence:quote(event)}]},item.content_text);
const {error:saveError}=await admin.rpc('persist_eligible_item_analysis',{p_user_id:item.user_id,p_item_id:item.id,p_content_text:item.content_text,p_content_hash:item.content_hash,p_analysis:v,p_model:'gemini-synthetic-fixture',p_input_fingerprint:load('src/lib/items/analysis-policy.ts').analysisFingerprint(item.content_text,'gemini-synthetic-fixture')});
assert.ok(!saveError,'Synthetic fixture persistence');console.log('PASS: labelled synthetic AI-result fixture persisted to single synthetic PDF; Gemini calls=0. NOT model-analysis success.');
