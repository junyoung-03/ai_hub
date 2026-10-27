// Explicit staged-rollout HTTP smoke. No email is sent; admin generates one temporary session.
// Normal Google collect APIs run only for the retained connected account/Drive target.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import nextEnv from '@next/env';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
nextEnv.loadEnvConfig(process.cwd());
const phase=process.env.RPC_PRODUCTION_SMOKE_PHASE;assert.ok(['before','after'].includes(phase));
const origin='https://ai-hub-one-ebon.vercel.app',project='oclzdppdiljbojvqtkeu';
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,project+'.supabase.co');
const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const selected=JSON.parse(readFileSync('supabase/.temp/rpc-conflict-smoke-selection.json','utf8'));
const jar=new Map(),client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:cookies=>{for(const c of cookies)jar.set(c.name,c.value);}}});
const result={phase,origin,startedAt:new Date().toISOString(),google:false,search:false,driveRead:false,driveSync:false,calendarRead:false,calendarSync:false,sessionRevoked:false,requests:[]};let stage='session';
async function api(path,body){const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,'Content-Type':'application/json',Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(180000)});const data=await r.json();result.requests.push({path,status:r.status,requestId:r.headers.get('x-vercel-id')});if(r.status!==200){result.failureCode=data.error?.code??'HTTP_ERROR';throw new Error('HTTP smoke failed');}return data;}
try{
 const owned=await admin.from('connections').select('id,status').eq('id',selected.connectionId).eq('user_id',selected.userId).single();assert.ok(!owned.error&&owned.data.status==='connected');
 const user=await admin.auth.admin.getUserById(selected.userId);assert.ok(!user.error&&user.data.user.email);
 const generated=await admin.auth.admin.generateLink({type:'magiclink',email:user.data.user.email});assert.ok(!generated.error&&generated.data.properties.hashed_token);
 assert.ok(!(await client.auth.verifyOtp({type:'email',token_hash:generated.data.properties.hashed_token})).error);assert.ok(jar.size);
 stage='google';const connection=await api('/api/v1/connections');assert.equal(connection.google.status,'connected');result.google=true;
 stage='search';const found=await api('/api/v1/search',{query:'자료',semantic:false,limit:5});assert.ok(['results','no_results'].includes(found.status));result.search=true;
 stage='drive-read';await api('/api/v1/items/'+selected.driveItemId);result.driveRead=true;
 stage='drive-sync';const drive=await api('/api/v1/connections/google/drive/collect',{mode:'files',fileIds:[selected.driveFileId]});result.driveCounts={created:drive.created,updated:drive.updated,reused:drive.reused,failed:drive.failed};if(drive.failed)result.failureCode=drive.results?.[0]?.code;assert.equal(drive.failed,0);assert.equal(drive.complete,true);result.driveSync=true;
 stage='calendar-read';await api('/api/v1/items/'+selected.calendarItemId);result.calendarRead=true;
 stage='calendar-sync';const calendar=await api('/api/v1/connections/google/calendar/collect',{});result.calendarCounts={created:calendar.created,updated:calendar.updated,reused:calendar.reused,failed:calendar.failed};assert.equal(calendar.failed,0);assert.equal(calendar.complete,true);result.calendarSync=true;
 await api('/api/v1/connections');
 console.log('PASS: '+phase+' migration deployed Production HTTP Search, Google connection, retained Drive read/sync and Calendar read/sync; no 503/storage fallback.');
}catch{result.failedStage=stage;console.error('FAIL: '+phase+' Production smoke at '+stage+'; identities/tokens/content suppressed.');process.exitCode=1;}
finally{if(jar.size){result.sessionRevoked=!(await client.auth.signOut({scope:'local'})).error;if(!result.sessionRevoked)process.exitCode=1;}result.finishedAt=new Date().toISOString();writeFileSync('supabase/.temp/rpc-conflict-production-'+phase+'.json',JSON.stringify(result));}
