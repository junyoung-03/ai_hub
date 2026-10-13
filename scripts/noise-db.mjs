// Isolated real PostgreSQL/WASM + pgvector, using only synthetic owners/content.
// Never reads environment secrets or connects to the production-linked Supabase project.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
export const migrationPath='supabase/migrations/20261012110525_promotional_noise_contract.sql';
export const gmailOnlyMigrationPath='supabase/migrations/20261013104126_gmail_only_noise_and_topic_normalization.sql';
export async function noiseDb({migrated=true}={}){
 const {PGlite}=await import('@electric-sql/pglite');
 const {vector}=await import('@electric-sql/pglite/vector');
 const db=new PGlite({extensions:{vector}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,service_role;`);
 await db.exec(readFileSync('supabase/baseline/0001_initial_schema.sql','utf8'));
 for(const name of ['20261004115419_persist_gmail_item_analysis','20261005162738_persist_eligible_item_analysis',
  '20261006000216_restrict_eligible_analysis_to_drive_upload','20261007070000_allow_manual_text_eligible_analysis',
  '20261005113838_search_contract_and_rpcs','20261005121340_search_rank_ties','20261005115533_search_coverage'])
  await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));
 const before=(await db.query("select proname,prosrc from pg_proc where pronamespace='public'::regnamespace and proname in ('search_candidates','search_index','persist_gmail_item_analysis','persist_eligible_item_analysis')")).rows;
 if(!migrated)return db;
 await db.exec(readFileSync(migrationPath,'utf8'));
 const sources=(await db.query("select n.nspname,p.proname,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')")).rows;
 for(const row of before){
  if(row.proname.startsWith('persist_'))assert.equal(sources.find(r=>r.nspname==='private'&&r.proname===row.proname+'_v02').prosrc,row.prosrc);
  if(row.proname==='search_index')assert.equal(sources.find(r=>r.nspname==='public'&&r.proname===row.proname).prosrc,row.prosrc);
  if(row.proname==='search_candidates'){
   assert.equal(sources.find(r=>r.nspname==='public'&&r.proname===row.proname).prosrc,row.prosrc);
   assert.equal(sources.find(r=>r.nspname==='public'&&r.proname===row.proname+'_promotional').prosrc.replace("\n and (p_intent->>'kind'='actions' or coalesce((p_filters->>'includePromotional')::boolean,false) or public.item_is_visible(i))",''),row.prosrc);
  }
 }
 return db;
}
