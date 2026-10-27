// Explicit trusted local runner. Never auto-run from builds/tests or print owner/item identifiers.
import {createClient} from '@supabase/supabase-js';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadSearch} from '../tests/helpers/search-loader.mjs';
const args=process.argv.slice(2),user=args[args.indexOf('--user')+1],semantic=args.includes('--semantic-non-sensitive');
if(!args.includes('--user')||!/^\w{8}-(?:\w{4}-){3}\w{12}$/.test(user??''))throw new Error('Explicit --user UUID required; one bounded cycle only.');
if(semantic&&process.env.SEARCH_SEMANTIC_ENABLED!=='true')throw new Error('Semantic processing disabled.');
// A global lexical run must never accidentally transmit a deployment-allowlisted ITEM.
if(!semantic)process.env.SEARCH_SEMANTIC_ENABLED='false';
const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {data,error}=await client.auth.admin.getUserById(user);if(error||!data.user)throw new Error('Owner verification failed.');
const runner=loadSearch('src/lib/search/backfill.ts',{'@/lib/supabase/auth':{requireUser:async()=>data.user},'@/lib/supabase/admin':{createAdminClient:()=>client}});
const path=`supabase/.temp/search-backfill-${createHash('sha256').update(user).digest('hex')}.json`;
let progress={startedAt:new Date().toISOString(),after:null,pending:[],failed:[],done:false};
if(args.includes('--resume'))progress=JSON.parse(readFileSync(path,'utf8'));
try{const result=await runner.backfillCycle(progress,!semantic);mkdirSync('supabase/.temp',{recursive:true});writeFileSync(path,JSON.stringify(result.progress),{mode:0o600});
 console.log(JSON.stringify({completed:result.completed,skipped:result.skipped,pending:result.pendingCount,failed:result.failedCount,done:result.progress.done,retryAfter:result.retryAfter}));
}catch{console.error('Backfill cycle failed; provider/owner/source details suppressed.');process.exitCode=1;}
