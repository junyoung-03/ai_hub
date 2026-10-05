// Read-only stored-source regression. Private titles/text stay in memory and never reach Gemini/logs.
import assert from 'node:assert/strict';import {existingGoogleTest} from './google-live-loader.mjs';import {loadSearch} from './search-loader.mjs';
import {load} from './calendar-loader.mjs';import {loadAnalysisModule} from './analysis-loader.mjs';
try{const context=await existingGoogleTest();process.env.SEARCH_SEMANTIC_ENABLED='false';
 const filters=load('src/lib/items/filters.ts',{'@/types/database':load('src/types/database.ts')});
 const imports={'@/lib/supabase/auth':context.auth,'@/lib/supabase/server':context.server,'@/lib/google/calendar-contract':load('src/lib/google/calendar-contract.ts'),'@/lib/uploads/contract':load('src/lib/uploads/contract.ts'),'@/lib/items/filters':filters,'@/lib/items/presentation':load('src/lib/items/presentation.ts'),'@/lib/gemini/validation':loadAnalysisModule('src/lib/gemini/validation.ts')};
 const queries=load('src/lib/items/queries.ts',imports),search=loadSearch('src/lib/search/service.ts',{'@/lib/supabase/auth':context.auth,'@/lib/supabase/admin':context.adminModule});
 const forbidden={identity:loadSearch('src/lib/search/contract.ts').ACTIVE_EMBEDDING,embedQuery:async()=>{throw new Error('private query external transmission forbidden');},embedDocument:async()=>{throw new Error('private text external transmission forbidden');}};
 for(const source of ['gmail','drive','calendar','upload']){const list=await queries.listItems(filters.parseItemQuery(new URLSearchParams({source,limit:'1'})));assert.equal(list.items.length,1);const d=await queries.getItemDetail(list.items[0].id);assert.ok(d&&d.item.source===source);if(source==='calendar')assert.ok(d.calendar);if(source==='upload')assert.ok(d.upload);if(['gmail','drive','calendar'].includes(source))assert.ok(d.original.url);
  const query=list.items[0].title;assert.ok(query.length>=2);let result;
  for(let attempt=0;attempt<2;attempt++){try{result=await search.search({query,filters:{source:[source]},semantic:false},forbidden);break;}catch(e){if(e.status!==429)throw e;await new Promise(r=>setTimeout(r,(e.retryAfter+1)*1000));}}
  assert.ok(result.results.some(v=>v.itemId===list.items[0].id));assert.equal(result.mode,'keyword_only');assert.equal(result.semantic.querySentToProvider,false);assert.ok(result.results.every(v=>v.source===source));console.log(`PASS: stored ${source} Library/Detail/keyword/locator contract; known-owner server adapter, no embedding or source collection.`);
 }
}catch{console.error('FAIL: existing stored source regression; all identity/query/text/error details suppressed.');process.exitCode=1;}
