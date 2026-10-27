import assert from 'node:assert/strict';
import {existingGoogleTest} from './google-live-loader.mjs';
import {load} from '../tests/helpers/calendar-loader.mjs';
import {loadAnalysisModule} from '../tests/helpers/analysis-loader.mjs';
try {
 const context=await existingGoogleTest();
 const filters=load('src/lib/items/filters.ts',{'@/types/database':load('src/types/database.ts')});
 const queries=load('src/lib/items/queries.ts',{'@/lib/supabase/auth':context.auth,'@/lib/supabase/server':context.server,'@/lib/google/calendar-contract':load('src/lib/google/calendar-contract.ts'),'@/lib/uploads/contract':load('src/lib/uploads/contract.ts'),'@/lib/items/filters':filters,'@/lib/items/presentation':load('src/lib/items/presentation.ts'),'@/lib/gemini/validation':loadAnalysisModule('src/lib/gemini/validation.ts')});
 for(const source of ['gmail','drive','calendar']) {
  const result=await queries.listItems(filters.parseItemQuery(new URLSearchParams({source,limit:'1'})));assert.equal(result.items.length,1);assert.equal(result.items[0].source,source);
  const detail=await queries.getItemDetail(result.items[0].id);assert.ok(detail);assert.equal(detail.item.source,source);assert.ok(detail.original.url);if(source==='calendar')assert.ok(detail.calendar);
 }
 console.log('PASS: production Library/Detail query code reads stored Gmail/Drive/Calendar metadata/source/original safely; known owner service-client adapter, no Google collection/refresh or AI call.');
} catch {console.error('FAIL: stored Google query regression; source content/identity/errors suppressed.');process.exitCode=1;}

