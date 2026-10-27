// Explicit development-only E2E. One retained primary Event; no content/identity/credential output.
// CLI auth/cookie and selection adapters do not claim Browser HTTP/UI verification.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import * as parse5 from "parse5";
import { existingGoogleTest, load } from "../scripts/google-live-loader.mjs";
import { loadAnalysisModule } from "./helpers/analysis-loader.mjs";
import { query, quote } from "../scripts/calendar-dev-db.mjs";
const path="supabase/.temp/calendar3-before-consent.json", selectedPath="supabase/.temp/calendar3-selection.json";
let stage="preconditions";
try {
  if(process.env.CALENDAR_DB_TEST_PROJECT!=="oclzdppdiljbojvqtkeu") throw new Error();
  const context=await existingGoogleTest(), {connection,admin,connections,dataOAuth}=context;
  async function fingerprint() {
    const graph=await Promise.all(['items','classifications','actions','action_sources'].map(async name=>{
      let q=admin.from(name).select('*',{count:'exact'}).eq('user_id',connection.user_id).order('id').limit(1000);
      if(name==='items') q=q.neq('source','calendar');
      const {data,error,count}=await q; if(error||count!==data?.length) throw new Error(); return data;
    }));
    return createHash('sha256').update(JSON.stringify(graph)).digest('hex');
  }
  mkdirSync('supabase/.temp',{recursive:true});
  if(process.argv.includes('--before-consent')) {
    writeFileSync(path,JSON.stringify({connection,fingerprint:await fingerprint()}));
    console.log('PASS: pre-consent account/connection/scopes/checkpoints and existing Gmail/Drive/analysis snapshot retained internally. No credentials recorded.');
  } else {
    stage='consent'; const before=JSON.parse(readFileSync(path,'utf8'));
    for(const key of ['id','user_id','provider_account_id','sync_state','last_synced_at']) assert.deepEqual(connection[key],before.connection[key]);
    dataOAuth.validateGrantedScopes(connection.scopes.join(' '),'calendar_scope_upgrade',before.connection.scopes);
    assert.equal(await fingerprint(),before.fingerprint);
    const bundle=await connections.getGoogleConnectionTokens(connection.user_id,connection.id);
    assert.ok(bundle?.refreshToken && bundle.scopes.includes(dataOAuth.CALENDAR_SCOPE));
    console.log('PASS: actual stored Calendar plus Gmail/Drive/Docs grants, same account/connection, refresh bundle and full checkpoints/analysis preservation.');
    if(process.argv.includes('--collect-one')) {
      stage='event_read'; const contract=load('src/lib/google/calendar-contract.ts');
      const gm=load('src/lib/google/gmail-message.ts',{'parse5':parse5});
      const clientModule=load('src/lib/google/calendar-client.ts',{'@/lib/google/calendar-contract':contract,'@/lib/google/connections':connections,'@/lib/google/data-oauth':dataOAuth});
      const real=await clientModule.createCalendarClient(connection.user_id,connection.id),signal=AbortSignal.timeout(120000);
      let target;
      try { target=JSON.parse(readFileSync(selectedPath,'utf8')); } catch(error) { if(error.code!=='ENOENT') throw error; }
      // Never expand a retained selection on retries. Only the first production-policy list page is inspected.
      const page=await real.list(contract.collectionWindow(Date.now()),null,signal);
      let raw=target?page.items.find(e=>e.id===target.eventId):page.items.find(e=>{const parsed=contract.parseEvent(e,page.calendarTimezone,gm.htmlToText);return parsed && parsed.status!=='cancelled';});
      if(target && !raw) raw=await real.event(target.eventId,signal);
      if(!raw) { console.log('NOT VERIFIED: no eligible primary Event in the first bounded page; user test Event needed.'); process.exitCode=2; }
      else {
        const event=contract.parseEvent(raw,page.calendarTimezone,gm.htmlToText), canonical=contract.canonicalEvent(event);
        if(!target) { target={eventId:event.eventId,userId:connection.user_id,connectionId:connection.id}; writeFileSync(selectedPath,JSON.stringify(target)); }
        assert.equal(target.userId,connection.user_id); assert.equal(target.connectionId,connection.id);
        const selectedClient={async createCalendarClient(){return {...real,async list(){return {items:[raw],calendarTimezone:page.calendarTimezone,nextPageToken:null};}};}};
        const collector=load('src/lib/google/calendar-collection.ts',{'@/lib/google/calendar-contract':contract,'@/lib/google/calendar-client':selectedClient,'@/lib/google/gmail-message':gm,'@/lib/supabase/auth':context.auth,'@/lib/supabase/server':context.server,'@/lib/supabase/admin':context.adminModule});
        stage='event_persist'; const first=await collector.collectCalendar();
        assert.equal(first.complete,true); assert.equal(first.failed,0); assert.equal(first.created+first.updated+first.reused,1);
        const read=async()=>{const {data,error}=await admin.from('items').select('*').eq('user_id',connection.user_id).eq('connection_id',connection.id).eq('source','calendar').eq('external_container_id','primary').eq('external_id',event.eventId).single();if(error)throw new Error();return data;};
        const item=await read(); target.itemId=item.id; writeFileSync(selectedPath,JSON.stringify(target));
        assert.equal(item.format,'calendar_event'); assert.equal(item.storage_path,null); assert.equal(item.mime_type,null); assert.equal(item.processing_status,'queued');
        assert.equal(item.title,event.summary); assert.equal(item.original_url,event.htmlLink); assert.equal(item.content_text,canonical.text); assert.equal(item.content_hash,canonical.hash);
        assert.deepEqual(item.metadata.calendar,JSON.parse(JSON.stringify(event)));
        for(const [key,value] of [['source_created_at',event.created],['source_updated_at',event.updated]]) assert.equal(item[key]===null?null:Date.parse(item[key]),value===null?null:Date.parse(value));
        stage='idempotency';
        raw=await real.event(event.eventId,signal);
        assert.deepEqual(JSON.parse(JSON.stringify(contract.parseEvent(raw,page.calendarTimezone,gm.htmlToText))),JSON.parse(JSON.stringify(event)));
        const second=await collector.collectCalendar(); assert.equal(second.complete,true); assert.equal(second.reused,1); assert.deepEqual(await read(),item);
        const {count,error}=await admin.from('items').select('id',{count:'exact',head:true}).eq('user_id',connection.user_id).eq('connection_id',connection.id).eq('source','calendar').eq('external_container_id','primary').eq('external_id',event.eventId); assert.ok(!error&&count===1);
        stage='library_detail'; const filters=load('src/lib/items/filters.ts',{'@/types/database':load('src/types/database.ts')});
        const imports={'@/lib/uploads/contract':load('src/lib/uploads/contract.ts'),'@/lib/google/calendar-contract':contract,'@/lib/supabase/auth':context.auth,'@/lib/supabase/server':context.server,'@/lib/items/filters':filters,'@/lib/items/presentation':load('src/lib/items/presentation.ts'),'@/lib/gemini/validation':loadAnalysisModule('src/lib/gemini/validation.ts')};
        const queries=load('src/lib/items/queries.ts',imports),detail=await queries.getItemDetail(item.id),library=await queries.listItems(filters.parseItemQuery(new URLSearchParams({source:'calendar',limit:'100'})));
        assert.ok(library.items.some(i=>i.id===item.id)); assert.equal(detail.original.url,event.htmlLink); assert.deepEqual(detail.calendar,contract.calendarDetail(item.metadata));
        assert.equal(detail.aiClassification,null); assert.equal(detail.userClassification,null); assert.equal(detail.actions.length,0); assert.equal(detail.evidence.length,0); assert.equal(detail.eventObservations.length,0);
        const foreign=load('src/lib/items/queries.ts',{...imports,'@/lib/supabase/auth':{async requireUser(){return {id:randomUUID()};}}}); assert.equal(await foreign.getItemDetail(item.id),null);
        stage='real_item_rls'; const id=quote(item.id);
        assert.equal(query(`begin; do $check$ declare owner_id uuid; begin select user_id into owner_id from public.items where id=${id}::uuid and source='calendar'; if owner_id is null then raise exception 'C3_TARGET'; end if;
          perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true); execute 'set local role authenticated'; if exists(select 1 from public.items where id=${id}::uuid) then raise exception 'C3_FOREIGN_RLS'; end if; execute 'reset role';
          perform set_config('request.jwt.claim.sub',owner_id::text,true); execute 'set local role authenticated'; if not exists(select 1 from public.items where id=${id}::uuid) then raise exception 'C3_OWNER_RLS'; end if; execute 'reset role';
          perform set_config('request.jwt.claim.sub','',true); execute 'set local role anon'; begin if exists(select 1 from public.items where id=${id}::uuid) then raise exception 'C3_ANON_RLS'; end if; exception when insufficient_privilege then null; end; execute 'reset role'; end $check$; select true as calendar_item_rls_pass; rollback;`)[0].calendar_item_rls_pass,true);
        assert.equal(await fingerprint(),before.fingerprint);
        writeFileSync('supabase/.temp/calendar3-e2e-result.json',JSON.stringify({complete:true,firstCreated:first.created===1,selected:1,allDay:event.allDay,recurring:event.recurringEventId!==null,cancelled:event.status==='cancelled'}));
        console.log('PASS: one actual primary Event through production client/validation/collector/RPC, exact mapping, same ITEM reuse with no DB change/duplicate, Library/Detail/URL whitelist, owner/foreign/anon real DB RLS; existing Gmail/Drive/analysis preserved.');
        console.log('CLI session and one-Event selection adapters used. Browser collect HTTP/UI not verified. No Google original changes or Gemini calls.');
      }
    }
  }
} catch { console.error(`NOT VERIFIED: Calendar live stage=${stage}; sensitive details suppressed.`); process.exitCode=1; }
