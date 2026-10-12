// Opt-in: synthetic content only, one existing ITEM-analysis request per input.
// No Supabase access/writes, collection, uploads, backfill or separate noise requests.
import nextEnv from '@next/env';
import assert from 'node:assert/strict';
import {loadAnalysisModule as load} from './analysis-loader.mjs';
if(!process.argv.includes('--gemini')){console.error('NOT RUN: --gemini opt-in required');process.exit(2);}
nextEnv.loadEnvConfig(process.cwd());
const validator=load('src/lib/gemini/validation.ts');
const client=load('src/lib/gemini/client.ts',{'@/lib/gemini/validation':validator});
const context={source:'manual',referenceDate:'2026-10-12',timezone:'Asia/Seoul',basis:'created_at'};
for(const text of ['10월 24일 코딩테스트','신제품 출시 50% 할인']){
 try{
  const output=await client.analyzeGmailText(text,[],context,"0.3");
  assert.equal(output.schemaVersion,'0.3');assert.ok(output.noiseAssessment);
  if(text.includes('코딩테스트')){assert.equal(output.actions.length,0);assert.ok(output.eventObservations.some(e=>e.date==='2026-10-24'));}
  else{assert.equal(output.noiseAssessment.verdict,'promotional');assert.ok(output.noiseAssessment.evidence.length);}
  console.log(`PASS: ${text}; schema=0.3; noise=${output.noiseAssessment.verdict}; actions=${output.actions.length}; events=${output.eventObservations.length}`);
 }catch(e){console.error(`FAIL: ${text}; code=${e.code??e.name}; rule=${e.rule??'none'}; http=${e.httpStatus??'none'}`);process.exitCode=1;break;}
}
