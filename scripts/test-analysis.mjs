import assert from "node:assert/strict";
import test from "node:test";
import { fixture, content, quote, none } from "./analysis-fixtures.mjs";
import { loadAnalysisModule as load } from "./analysis-loader.mjs";
const providerFixture = () => ({...fixture(),schemaVersion:'0.3',noiseAssessment:{verdict:'normal',confidence:null,evidence:[],reasons:['non_promotional'],protectionSignals:[]}});
const validator = load("src/lib/gemini/validation.ts");

test("v0.2 JSON Schema rejects obsolete versions, unknown fields, invalid calendar dates and missing event array", () => {
  for (const edit of [v => {v.schemaVersion="0.1";},v => {v.description="extra";},v => {delete v.eventObservations;},
    v => {v.actions[0].deadlineObservation.date="2026-02-30";},v => {v.actions[0].actionType="invented";}]) {
    const v=fixture();edit(v);assert.throws(()=>validator.validateAnalysis(v,content),validator.AnalysisValidationError);
  }
});
test("event date stays independent from deadline; server computes Unicode code-point evidence offsets", () => {
  const v=validator.validateAnalysis(fixture(),content);
  assert.equal(v.actions[0].deadlineObservation.date,"2026-10-15");
  assert.equal(v.eventObservations[0].date,"2026-10-20");
  const q=v.actions[0].evidence[0], chars=Array.from(content);
  assert.equal(chars.slice(q.locator.startChar,q.locator.endChar).join(""),q.text);
  assert.equal(fixture().actions[0].evidence[0].locator.kind,"unknown");
});
test("event-only/no-action and unclear deadline are valid without guessed absolute dates", () => {
  const eventOnly=fixture();eventOnly.actions=[];
  assert.equal(validator.validateAnalysis(eventOnly,content).actions.length,0);
  const unclear=fixture();unclear.actions[0].deadlineObservation={status:"needs_review",date:null,datetime:null,
    rawText:"추후 공지",evidence:quote("마감일은 추후 공지합니다.")};
  assert.equal(validator.validateAnalysis(unclear,content).actions[0].deadlineObservation.date,null);
});
test("hallucinated quotes/offsets/requirements, missing year and event-as-deadline are rejected", () => {
  const edits=[v=>{v.actions[0].evidence[0].text="invented private sentence";},
    v=>{v.actions[0].evidence[0].locator={kind:"text_span",page:null,section:null,startChar:0,endChar:3,field:"content_text"};},
    v=>{v.actions[0].requirements=["invented requirement"];},
    v=>{v.actions[0].deadlineObservation=structuredClone(v.eventObservations[0]);},
    v=>{v.actions[0].deadlineObservation.evidence.text="마감일은 추후 공지합니다.";v.actions[0].deadlineObservation.rawText="추후 공지";}];
  for (const edit of edits){const v=fixture();edit(v);assert.throws(()=>validator.validateAnalysis(v,content),validator.AnalysisValidationError);}
  const yearless=fixture();yearless.eventObservations[0].evidence=quote("10월 20일 설명회");yearless.eventObservations[0].rawText="10월 20일";
  assert.throws(()=>validator.validateAnalysis(yearless,"10월 20일 설명회"),validator.AnalysisValidationError);
});
test("dates/passive notices cannot supply action intent; none cannot retain confirmed fields", () => {
  const v=fixture();v.actions[0].evidence=[v.eventObservations[0].evidence];
  assert.throws(()=>validator.validateAnalysis(v,content),validator.AnalysisValidationError);
  const bad=fixture();bad.actions[0].deadlineObservation={...none(),date:"2026-10-20"};
  assert.throws(()=>validator.validateAnalysis(bad,content),validator.AnalysisValidationError);
});
test("Gemini HTTP contract is server-only and validates response before returning it; errors never echo payload", async () => {
  const client=load("src/lib/gemini/client.ts",{"@/lib/gemini/validation":validator},{
    process:{env:{GEMINI_API_KEY:"synthetic-key",GEMINI_MODEL:"gemini-synthetic"}},
    fetch:async(url,init)=>{assert.ok(!url.includes("synthetic-key"));assert.equal(init.headers["x-goog-api-key"],"synthetic-key");
      const payload=JSON.parse(init.body);assert.equal(payload.generationConfig.responseFormat.text.mimeType,"APPLICATION_JSON");
      const transport=payload.generationConfig.responseFormat.text.schema;
      assert.ok(transport.properties.actions.items.properties.title);
      assert.equal(transport.properties.actions.maxItems,undefined);
      return Response.json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(providerFixture())}]}}]});}
  });
  assert.equal((await client.analyzeGmailText(content,[],undefined,"0.3")).schemaVersion,"0.3");
  const failed=load("src/lib/gemini/client.ts",{"@/lib/gemini/validation":validator},{process:{env:{GEMINI_API_KEY:"synthetic-key",GEMINI_MODEL:"gemini-synthetic"}},fetch:async()=>Response.json({private:"secret-provider-body"},{status:400})});
  await assert.rejects(failed.analyzeGmailText(content,[]),e=>e.code==="GEMINI_UNAVAILABLE"&&!e.message.includes("private"));
  const tooMany=fixture();tooMany.classification.tags=Array(13).fill("synthetic");
  const invalid=load("src/lib/gemini/client.ts",{"@/lib/gemini/validation":validator},{process:{env:{GEMINI_API_KEY:"synthetic-key",GEMINI_MODEL:"gemini-synthetic"}},fetch:async()=>Response.json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(tooMany)}]}}]})});
  await assert.rejects(invalid.analyzeGmailText(content,[]),validator.AnalysisValidationError);
});
const dependencies = {"@/lib/gemini/validation":validator,"@/lib/gemini/client":{},
  "@/lib/items/filters":{},"@/lib/supabase/auth":{},"@/lib/supabase/server":{},"@/lib/supabase/admin":{}};
test("invalid outputs never call persistence RPC; transaction retry only permits 40P01/40001", async () => {
  const analysisModule=load("src/lib/items/analysis.ts",dependencies);
  const input={userId:"synthetic",itemId:"synthetic",contentText:content,contentHash:null,result:fixture(),model:"gemini-synthetic",fingerprint:"0".repeat(64)};
  let calls=0;const admin={async rpc(name,args){calls++;assert.equal(name,"persist_gmail_item_analysis");assert.equal(args.p_analysis.schemaVersion,"0.2");return calls<3?{error:{code:"40001"}}:{data:{created_count:1,reused_count:0,action_count:1,cached:false}};}};
  const invalid={...input,result:{...fixture(),schemaVersion:"0.1"}};
  await assert.rejects(analysisModule.persistValidatedAnalysis(admin,invalid),validator.AnalysisValidationError);assert.equal(calls,0);
  await analysisModule.persistValidatedAnalysis(admin,input);assert.equal(calls,3);
  calls=0;await assert.rejects(analysisModule.persistValidatedAnalysis({async rpc(){calls++;return {error:{code:"23514"}};}},input));assert.equal(calls,1);
});
test("Gemini retries are bounded to three attempts; cooldown and permanent errors stop immediately", async () => {
  const exercise=async (status,headers={})=>{
    let calls=0,waits=0;
    const client=load("src/lib/gemini/client.ts",{"@/lib/gemini/validation":validator,"node:timers/promises":{async setTimeout(){waits++;}}},
      {process:{env:{GEMINI_API_KEY:"synthetic-key",GEMINI_MODEL:"gemini-synthetic"}},fetch:async()=>{calls++;return Response.json({}, {status,headers});}});
    await assert.rejects(client.analyzeGmailText(content,[],undefined,"0.3"),e=>e.code==="GEMINI_UNAVAILABLE");
    return {calls,waits};
  };
  assert.deepEqual(await exercise(503),{calls:3,waits:2});
  assert.deepEqual(await exercise(429, {"retry-after":"60"}),{calls:1,waits:0});
  assert.deepEqual(await exercise(400),{calls:1,waits:0});
  let calls=0;
  const client=load("src/lib/gemini/client.ts",{"@/lib/gemini/validation":validator,"node:timers/promises":{async setTimeout(){}}},
    {process:{env:{GEMINI_API_KEY:"synthetic-key",GEMINI_MODEL:"gemini-synthetic"}},fetch:async()=>{calls++;return calls<3?Response.json({}, {status:503}):Response.json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(providerFixture())}]}}]});}});
  assert.equal((await client.analyzeGmailText(content,[],undefined,"0.3")).schemaVersion,"0.3");assert.equal(calls,3);
});
test("anonymous analysis and foreign/missing ITEM cannot reach Gemini or service client", async () => {
  const anonymous=load("src/lib/items/analysis.ts",{...dependencies,"@/lib/supabase/auth":{async requireUser(){throw new Error("auth-required");}}});
  await assert.rejects(anonymous.analyzeOwnedGmailItem("id"),/auth-required/);
  const chain={select(){return this;},eq(name,value){if(name==="user_id")assert.equal(value,"owner");return this;},async maybeSingle(){return {data:null};}};
  const foreign=load("src/lib/items/analysis.ts",{...dependencies,"@/lib/supabase/auth":{async requireUser(){return {id:"owner"};}},"@/lib/items/filters":{isItemId:()=>true},"@/lib/supabase/server":{async createClient(){return {from:()=>chain};}}});
  await assert.rejects(foreign.analyzeOwnedGmailItem("id"),e=>e.code==="ITEM_NOT_FOUND");
});
test("deadline evidence must contain deadline intent phrase, isolated date is rejected, event and deadline stay distinct", () => {
  const baseNotice = "신청 마감일: 2026-10-31\n행사 일시: 2026-11-05";
  const valid = fixture();
  valid.actions[0].evidence = [quote("신청 마감일: 2026-10-31")];
  valid.actions[0].deadlineObservation = {
    status: "confirmed",
    date: "2026-10-31",
    datetime: null,
    rawText: "2026-10-31",
    evidence: quote("신청 마감일: 2026-10-31")
  };
  valid.eventObservations = [{
    status: "confirmed",
    date: "2026-11-05",
    datetime: null,
    rawText: "2026-11-05",
    evidence: quote("행사 일시: 2026-11-05")
  }];

  // 1. Deadline normal with context -> validator PASS
  const res = validator.validateAnalysis(valid, baseNotice);
  assert.equal(res.actions[0].deadlineObservation.date, "2026-10-31");
  assert.equal(res.actions[0].deadlineObservation.evidence?.text, "신청 마감일: 2026-10-31");

  // 2. Event date only -> deadline cannot be created with event text
  const eventAsDeadline = structuredClone(valid);
  eventAsDeadline.actions[0].deadlineObservation.date = "2026-11-05";
  eventAsDeadline.actions[0].deadlineObservation.rawText = "2026-11-05";
  eventAsDeadline.actions[0].deadlineObservation.evidence = quote("행사 일시: 2026-11-05");
  assert.throws(() => validator.validateAnalysis(eventAsDeadline, baseNotice), e => e.rule === "DEADLINE_ROLE");

  // 3. Deadline + Event coexistence -> separate observations and dates
  assert.equal(res.actions[0].deadlineObservation.date, "2026-10-31");
  assert.equal(res.eventObservations[0].date, "2026-11-05");
  assert.notEqual(res.actions[0].deadlineObservation.evidence?.text, res.eventObservations[0].evidence?.text);

  // 4. Isolated date evidence -> DEADLINE_ROLE validator continues to reject
  const isolatedDate = structuredClone(valid);
  isolatedDate.actions[0].deadlineObservation.evidence = quote("2026-10-31");
  assert.throws(() => validator.validateAnalysis(isolatedDate, baseNotice), e => e.rule === "DEADLINE_ROLE");
});
