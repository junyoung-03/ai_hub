// Search-3 closeout. Only public non-credential projections; no Google token operation or derivation.
import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {createClient} from '@supabase/supabase-js';import nextEnv from '@next/env';import ts from 'typescript';
nextEnv.loadEnvConfig(process.cwd());const url=process.env.NEXT_PUBLIC_SUPABASE_URL;assert.equal(new URL(url).hostname,'oclzdppdiljbojvqtkeu.supabase.co');assert.equal(process.env.SEARCH_CLOSEOUT_PROJECT,'oclzdppdiljbojvqtkeu');
const admin=createClient(url,process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const get=async(p)=>{const r=await p;assert.ok(!r.error,'read-only projection failed');return r.data;};
let stage='connection';const results={credentialValuesRead:false,credentialDerivativesRead:false,refreshAttempted:false};
try{
 // Producer for this old checkpoint writes the connection object only, never credentials/derivatives.
 const old=JSON.parse(readFileSync('supabase/.temp/drive3-before-consent.json','utf8'));
 const connections=await get(admin.from('connections').select('id,user_id,provider,status,scopes,sync_state,connected_at,disconnected_at'));
 assert.equal(connections.length,1);const co=connections[0];assert.equal(co.id,old.id);assert.equal(co.user_id,old.user_id);assert.equal(co.provider,'google');assert.equal(co.status,'connected');assert.equal(co.disconnected_at,null);
 for(const scope of ['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/drive.metadata.readonly','https://www.googleapis.com/auth/documents.readonly','https://www.googleapis.com/auth/calendar.events.owned.readonly'])assert.ok(co.scopes.includes(scope));
 for(const scope of old.scopes)assert.ok(co.scopes.includes(scope));
 // Gmail checkpoint is untouched by the later Drive/Calendar scope additions.
 for(const [key,value] of Object.entries(old.sync_state??{}))if(/gmail|history/i.test(key))assert.deepEqual(co.sync_state[key],value);
 results.connection={present:true,provider:true,active:true,scopes:true,disconnectUnchanged:true,gmailCheckpoint:true};
 stage='items';const rows=await get(admin.from('items').select('id,user_id,connection_id,source,format,external_id,external_container_id,original_url,storage_path,metadata,content_text,content_hash,created_at,updated_at'));
 assert.equal(rows.length,50);assert.ok(rows.every(i=>i.user_id===co.user_id));
 const counts={};for(const i of rows)counts[`${i.source}:${i.format}`]=(counts[`${i.source}:${i.format}`]??0)+1;
 assert.deepEqual(counts,{'gmail:email':46,'drive:document':1,'calendar:calendar_event':1,'upload:pdf':1,'upload:image':1});
 const selected=JSON.parse(readFileSync('supabase/.temp/phase6a-selection.json','utf8'));assert.ok(selected.ids.every(id=>rows.some(i=>i.id===id&&i.source==='gmail')));
 const drive=JSON.parse(readFileSync('supabase/.temp/drive3-e2e-result.json','utf8'));assert.equal(drive.complete,true);assert.equal(drive.reused,true);const d=rows.find(i=>i.id===drive.itemId);assert.ok(d&&d.external_id===drive.fileId&&d.connection_id===drive.connectionId);assert.ok(d.original_url.startsWith('https://docs.google.com/'));assert.ok(d.metadata.drive.tabs.length);assert.equal(rows.filter(i=>i.source==='drive'&&i.external_id===d.external_id&&i.connection_id===d.connection_id).length,1);
 const cal=JSON.parse(readFileSync('supabase/.temp/calendar3-selection.json','utf8'));const event=rows.find(i=>i.id===cal.itemId);assert.ok(event&&event.source==='calendar'&&event.external_id===cal.eventId&&event.external_container_id==='primary');assert.ok(event.metadata.calendar.start);assert.ok(event.metadata.calendar.end);assert.equal(rows.filter(i=>i.source==='calendar'&&i.external_id===event.external_id&&i.connection_id===event.connection_id).length,1);
 const upload=JSON.parse(readFileSync('supabase/.temp/upload3-browser-item-ids.json','utf8'));for(const [label,id] of Object.entries(upload)){const i=rows.find(i=>i.id===id);assert.ok(i&&i.source==='upload'&&i.storage_path.startsWith(`${i.user_id}/`)&&i.connection_id===null);const ex=i.metadata.upload.extraction;assert.equal(ex.status,'complete');assert.equal(ex.pages.length,1);assert.equal(ex.pages[0].start,0);assert.equal(ex.pages[0].end,Array.from(i.content_text).length);if(label==='pdf'){assert.equal(i.format,'pdf');assert.equal(ex.provider,'pdfjs');assert.equal(i.content_text,'Synthetic fixture text');}else{assert.equal(i.format,'image');assert.equal(ex.provider,'tesseract.js');assert.equal(ex.language,'kor+eng');assert.ok(i.content_text.includes('ENGLISH DOCUMENT TEST 12345'));}
  // Existence/ownership metadata only; original bytes are not downloaded or modified.
  const parts=i.storage_path.split('/');const listed=await admin.storage.from('upload-originals').list(parts.slice(0,-1).join('/'),{limit:10,search:parts.at(-1)});assert.ok(!listed.error&&listed.data.some(v=>v.name===parts.at(-1)));
 }
 results.items={counts,ownership:true,stableIdentities:true,driveLocatorAndDedupe:true,calendarDates:true,uploadOriginalOwnership:true,ocrMetadata:true};
 stage='analysis';const classifications=await get(admin.from('classifications').select('id,item_id,user_id,ai_primary_topic,ai_document_type,ai_tags,user_primary_topic,user_document_type,user_tags'));
 const actions=await get(admin.from('actions').select('id,user_id,title,deadline_status,deadline_date,deadline_source_id,status'));
 const evidence=await get(admin.from('action_sources').select('id,item_id,action_id,user_id,is_current,evidence_text,evidence_locator'));
 assert.equal(classifications.length,2);assert.equal(actions.length,1);assert.equal(evidence.length,1);assert.ok(classifications.every(x=>selected.ids.includes(x.item_id)&&x.user_id===co.user_id));assert.equal(rows.filter(x=>x.metadata.aiAnalysis).length,2);
 for(const e of evidence){const raw=rows.find(i=>i.id===e.item_id);assert.ok(raw&&raw.user_id===e.user_id&&actions.some(a=>a.id===e.action_id&&a.user_id===e.user_id));assert.ok(raw.content_text.includes(e.evidence_text));assert.equal(raw.source,'gmail');}
 assert.ok(evidence.every(e=>e.item_id!==event.id));assert.equal(event.metadata.aiAnalysis,undefined);
 results.analysis={classificationCount:2,aiMetadataCount:2,actionCount:1,evidenceCount:1,evidenceOwnership:true,noCalendarDeadline:true};
 results.scope='read-only stored state and historical non-sensitive identity/checkpoint + acknowledged production query regression; no fresh provider recollection/refresh';
 writeFileSync('supabase/.temp/search3-closeout.json',JSON.stringify(results,null,2));
 console.log('PASS: original Google connection/provider/active/scopes/disconnect and Gmail checkpoint; no credential values/derivatives accessed.');
 console.log('PASS: Gmail46/Drive1/Calendar1/PDF1/Image1, historical identities, owner relationships, locators/event dates, original Storage existence and OCR extraction.');
 console.log('PASS: two classifications/two AI metadata/one Action/one Evidence retained; Calendar generated no Action deadline.');
}catch{console.error(`FAIL: read-only closeout at ${stage}; identity/content/credential details suppressed.`);process.exitCode=1;}
// Export expected public column names only for a catalog comparison; no record data.
const source=ts.createSourceFile('database.ts',readFileSync('src/types/database.ts','utf8'),ts.ScriptTarget.Latest,true),name=n=>n.name?.getText(source).replaceAll('"',''),member=(n,k)=>n.members.find(v=>name(v)===k).type;
const db=source.statements.find(n=>ts.isTypeAliasDeclaration(n)&&name(n)==='Database').type;const tables=member(member(db,'public'),'Tables');const columns={};for(const table of tables.members)columns[name(table)]=member(table.type,'Row').members.map(name).sort();writeFileSync('supabase/.temp/search3-public-columns.json',JSON.stringify(columns));

