// Explicit owner-scoped historic backlog only. Default dry run; no provider calls.
import {createClient} from '@supabase/supabase-js';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {analysisCurrent}=require('../.analysis-worker/src/lib/items/analysis-policy.cjs');
const user=process.argv.find(a=>a.startsWith('--user='))?.slice(7);
const after=process.argv.find(a=>a.startsWith('--after='))?.slice(8);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const allowed=(process.env.GMAIL_ANALYSIS_ALLOWED_USERS??'').split(',').map(v=>v.trim());
if(!uuid(user)||!allowed.includes(user)||(after&&!uuid(after)))throw new Error('EXPLICIT_APPROVED_OWNER_REQUIRED');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
const model=process.env.GEMINI_MODEL;
if(!url||!key||!model)throw new Error('SERVER_CONFIGURATION_REQUIRED');
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(15000)})}});
let query=admin.from('items').select('id,source,format,content_text,metadata').eq('user_id',user).eq('source','gmail')
  .in('processing_status',['queued','failed']).order('id').limit(100);
if(after)query=query.gt('id',after);
const {data,error}=await query;
if(error||!data)throw new Error('BACKLOG_READ_FAILED');
const ids=data.filter(item=>item.content_text?.trim()&&item.content_text.length<=200000&&!analysisCurrent(item,model)).map(item=>item.id);
let enqueued=0;
if(process.argv.includes('--apply')&&ids.length){
  const result=await admin.rpc('enqueue_gmail_analysis',{p_user_id:user,p_item_ids:ids});
  if(result.error)throw new Error('BACKLOG_ENQUEUE_FAILED');enqueued=result.data;
}
console.log(JSON.stringify({dryRun:!process.argv.includes('--apply'),scanned:data.length,candidates:ids.length,enqueued,
  nextAfter:data.length===100?data.at(-1).id:null}));
