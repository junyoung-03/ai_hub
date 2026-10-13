// Read only the four previously approved TEST-account samples. All writes are isolated local SQL.
import {createClient} from '@supabase/supabase-js';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {noiseDb,gmailOnlyMigrationPath} from './noise-db.mjs';
process.loadEnvFile('.env.local');
const owner='c05fdc30-bf78-4922-b2bb-af576b3af270';
const ids=['03922097-ea12-4c29-a54d-91d035495c71','35573892-a223-4b19-aba2-6cf1861cf872','66a42f6d-f9e9-4300-9222-7d0360d875ef','5f470cbd-20ac-4caa-9455-7d1b5f04e93c'];
const url=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
if(new URL(url).hostname!=='oclzdppdiljbojvqtkeu.supabase.co')throw new Error('Unexpected project');
const remote=createClient(url,process.env.SUPABASE_SECRET_KEY?.trim()||process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),{auth:{persistSession:false,autoRefreshToken:false}});
const fields='ai_primary_topic,user_primary_topic,ai_document_type,user_document_type,ai_tags,user_tags';
const {data:items,error}=await remote.from('items').select(`id,source,format,title,content_text,metadata,processing_status,classification:classifications!classifications_item_user_fk(${fields})`).eq('user_id',owner).in('id',ids);
if(error||items?.length!==4)throw new Error('Approved sample read failed');
const {data:assessments,error:noiseError}=await remote.from('item_noise_assessments').select('*').eq('user_id',owner).in('item_id',ids);
if(noiseError)throw new Error('Assessment read failed');
const db=await noiseDb();
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
try{
 await db.exec(`create function auth.role() returns text language sql stable as $$select current_user$$;`);
 await db.query('insert into auth.users(id) values($1)',[owner]);await db.query('insert into public.connections(id,user_id) values($1,$1)',[owner]);
 for(const item of items){
  await db.query('insert into public.items(id,user_id,source,format,title,content_text,metadata,processing_status,connection_id,external_id,storage_path) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)',[item.id,owner,item.source,item.format,item.title,item.content_text,JSON.stringify(item.metadata),item.processing_status,item.source==='gmail'?owner:null,item.source==='gmail'?item.id:null,item.source==='upload'?'synthetic-local-copy':null]);
  const c=Array.isArray(item.classification)?item.classification[0]:item.classification;
  if(c)await db.query(`insert into public.classifications(item_id,user_id,${fields}) values($1,$2,$3,$4,$5,$6,$7,$8)`,[item.id,owner,...fields.split(',').map(key=>c[key])]);
 }
 // Existing sample assessments are absent. Do not invent verdicts for legacy mail.
 if(assessments.length)throw new Error('Sample assumptions changed: review existing assessments');
 const before=hash((await db.query('select id,source,metadata,content_text from public.items order by id')).rows);
 await db.exec(readFileSync('supabase/migrations/20261013030716_gmail_analysis_worker_queue.sql','utf8'));
 await db.exec(readFileSync(gmailOnlyMigrationPath,'utf8'));
 const after=hash((await db.query('select id,source,metadata,content_text from public.items order by id')).rows);
 const rows=[];
 for(const item of items){
  const c=Array.isArray(item.classification)?item.classification[0]:item.classification;
  const normalized=(await db.query('select * from public.classifications where item_id=$1',[item.id])).rows[0];
  const state=await scalar('select public.item_noise_state(i) from public.items i where id=$1',[item.id]);
  const keyword=item.id===ids[2]?'기말':item.source==='upload'?'Briefing':'보안';
  const results=await scalar(`select public.search_candidates_promotional($1,'unused',$2,null,'{"source":[],"format":[]}','{"kind":"documents"}')`,[owner,keyword]);
  rows.push({itemId:item.id,source:item.source,format:item.format,title:item.title,classificationBefore:c.user_primary_topic??c.ai_primary_topic,classificationAfter:normalized.user_primary_topic??normalized.ai_primary_topic,userOverride:c.user_primary_topic!==null||c.user_document_type!==null||c.user_tags!==null,promotionalVerdict:state.aiVerdict??'assessment 없음',visibility:state.effectiveVisibility,localSqlSearch:results.some(r=>r.itemId===item.id)?'PASS':'FAIL',evidencePreserved:before===after});
 }
 const result={scope:'Four approved existing samples read from connected DB; migration and searches run in isolated PostgreSQL only. No remote writes, no provider calls, not a browser toggle verification.',samples:rows,additionalGeminiCalls:0,remoteWrites:0};
 mkdirSync('supabase/.temp',{recursive:true});writeFileSync('supabase/.temp/classification-sample-results.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
 if(rows.some(r=>r.localSqlSearch!=='PASS'||!r.evidencePreserved||r.visibility!=='SHOW'))process.exitCode=1;
}finally{await db.close();}
