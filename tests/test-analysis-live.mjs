// Opt-in: real Gemini and DB writes for at most five already stored Gmail ITEMs.
// CLI identity is explicitly selected and verified; this does not test Browser cookies.
import nextEnv from "@next/env";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadAnalysisModule as load } from "./helpers/analysis-loader.mjs";
nextEnv.loadEnvConfig(process.cwd());
let attempted=0, succeeded=0, actualCalls=0;
try {
  const email=process.env.ANALYSIS_TEST_EMAIL?.trim();
  if (!email || process.env.ANALYSIS_TEST_PROJECT!=="oclzdppdiljbojvqtkeu") throw new Error("Explicit development target required");
  const env=load("src/lib/supabase/env.ts");
  if(new URL(env.getSupabaseConfig().url).hostname!=="oclzdppdiljbojvqtkeu.supabase.co") throw new Error("Development target mismatch");
  const adminModule=load("src/lib/supabase/admin.ts",{"@/lib/supabase/env":env});
  const admin=adminModule.createAdminClient();
  const {data:connection,error:connectionError}=await admin.from("connections").select("id,user_id")
    .eq("provider","google").eq("status","connected").eq("account_email",email).single();
  if(connectionError || !connection) throw new Error("Test connection unavailable");
  const {data:identity,error:identityError}=await admin.auth.admin.getUserById(connection.user_id);
  if(identityError || identity.user?.email!==email) throw new Error("Test identity mismatch");
  const validator=load("src/lib/gemini/validation.ts");
  const gemini=load("src/lib/gemini/client.ts",{"@/lib/gemini/validation":validator},{async fetch(...args){actualCalls++;return fetch(...args);}});
  gemini.getGeminiConfig();
  const analysis=load("src/lib/items/analysis.ts",{
    "@/lib/gemini/validation":validator,"@/lib/gemini/client":gemini,
    "@/lib/items/filters":{isItemId:id=>/^[0-9a-f-]{36}$/i.test(id)},
    "@/lib/supabase/auth":{async requireUser(){return identity.user;}},
    "@/lib/supabase/server":{async createClient(){return admin;}},"@/lib/supabase/admin":adminModule,
  });
  const {data:items,error:itemError}=await admin.from("items").select("id,content_text,metadata,created_at")
    .eq("user_id",identity.user.id).eq("connection_id",connection.id).eq("source","gmail")
    .order("created_at").limit(100);
  if(itemError || !items?.length) throw new Error("Test ITEM unavailable");
  // Prefer prior artifacts on re-running this script: never expand the five-item target set.
  const eligible=items.filter(i=>i.content_text?.trim() && i.content_text.length<=200000);
  const selectionFile=path.resolve("supabase/.temp/phase6a-selection.json");
  let chosen=[];
  if(fs.existsSync(selectionFile)) {
    const selected=JSON.parse(fs.readFileSync(selectionFile,"utf8"));
    assert.equal(selected.userId,identity.user.id);assert.equal(selected.connectionId,connection.id);
    assert.ok(Array.isArray(selected.ids)&&selected.ids.length<=5);
    chosen=selected.ids.map(id=>eligible.find(i=>i.id===id));assert.ok(chosen.every(Boolean));
  } else {
    const categories=[/마감|deadline|납부|제출|must\b|due\b/i,/행사|설명회|event|conference/i,/추후|다음 주|예산 소진/i,/안내|알림|newsletter|update/i];
    for(const pattern of categories){const i=eligible.find(i=>!chosen.includes(i)&&pattern.test(i.content_text));if(i)chosen.push(i);}
    for(const i of eligible){if(chosen.length>=5)break;if(!chosen.includes(i))chosen.push(i);}
    fs.mkdirSync(path.dirname(selectionFile),{recursive:true});
    fs.writeFileSync(selectionFile,JSON.stringify({userId:identity.user.id,connectionId:connection.id,ids:chosen.map(i=>i.id)}));
  }
  let actionTotal=0,eventTotal=0,confirmedTotal=0,unclearTotal=0,noActionTotal=0;
  for(const item of chosen){
    attempted++;
    try {
      await analysis.analyzeOwnedGmailItem(item.id);
      const {data:saved,error:readError}=await admin.from("items").select("content_text,content_hash,metadata,processing_status")
        .eq("id",item.id).eq("user_id",identity.user.id).single();
      if(readError)throw new Error("Result read unavailable");
      assert.equal(saved.metadata.aiAnalysis.schemaVersion,"0.2");assert.equal(saved.processing_status,"indexing");
      const artifact=saved.metadata.aiAnalysis;
      const valid=validator.validateAnalysis(artifact.result,saved.content_text);
      const {data:classification,error:classError}=await admin.from("classifications").select("ai_primary_topic,ai_document_type,ai_tags,user_primary_topic,user_document_type,user_tags,user_edited_at")
        .eq("user_id",identity.user.id).eq("item_id",item.id).single();
      if(classError)throw new Error("Classification read unavailable");
      assert.equal(classification.ai_primary_topic,valid.classification.primaryTopic);
      const {data:before,error:sourceError}=await admin.from("action_sources").select("id,action_id,is_current,evidence_text,evidence_locator")
        .eq("user_id",identity.user.id).eq("item_id",item.id);
      if(sourceError)throw new Error("Evidence read unavailable");
      assert.equal(before.filter(s=>s.is_current).length,valid.actions.length);
      for(const source of before.filter(s=>s.is_current)){
        assert.ok(saved.content_text.includes(source.evidence_text));
        for(const e of source.evidence_locator.evidence){assert.equal(Array.from(saved.content_text).slice(e.locator.startChar,e.locator.endChar).join(""),e.text);}
      }
      const same = await analysis.persistValidatedAnalysis(admin,{userId:identity.user.id,itemId:item.id,contentText:saved.content_text,
        contentHash:saved.content_hash,result:valid,model:artifact.model,fingerprint:artifact.inputFingerprint});
      assert.equal(same.cached,true);assert.equal(same.created_count,0);
      const cached=await analysis.analyzeOwnedGmailItem(item.id);assert.equal(cached.cached,true);
      const {data:after}=await admin.from("action_sources").select("id,action_id,is_current,evidence_text,evidence_locator")
        .eq("user_id",identity.user.id).eq("item_id",item.id);
      assert.deepEqual(after,before);
      const {data:classAfter}=await admin.from("classifications").select("ai_primary_topic,ai_document_type,ai_tags,user_primary_topic,user_document_type,user_tags,user_edited_at")
        .eq("user_id",identity.user.id).eq("item_id",item.id).single();
      assert.deepEqual(classAfter,classification);
      succeeded++;actionTotal+=valid.actions.length;eventTotal+=valid.eventObservations.length;
      if(!valid.actions.length)noActionTotal++;
      confirmedTotal+=valid.actions.filter(a=>a.deadlineObservation.status==="confirmed").length;
      unclearTotal+=valid.actions.filter(a=>a.deadlineObservation.status==="needs_review").length;
      console.log(`ITEM test ${attempted}: PASS (schema, DB, cached reanalysis, idempotent RPC).`);
    } catch(error) {
      console.log(`ITEM test ${attempted}: FAIL; code=${error.code??"ASSERTION"}; rule=${error.rule??"none"}; http=${error.httpStatus??"none"}`);
      process.exitCode=1;
      if(error.code==="GEMINI_NOT_CONFIGURED" || error.code==="GEMINI_UNAVAILABLE")break;
    }
  }
  console.log(JSON.stringify({attempted,succeeded,gemini_calls:actualCalls,action_count:actionTotal,event_count:eventTotal,
    confirmed_deadline_count:confirmedTotal,unclear_deadline_count:unclearTotal,no_action_items:noActionTotal}));
} catch {
  console.error("FAIL: live analysis prerequisites/verification unavailable; credential and provider payloads suppressed.");process.exitCode=1;
}
