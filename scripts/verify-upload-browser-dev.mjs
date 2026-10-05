import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {query,quote} from './calendar-dev-db.mjs';
const {pdf,png}=JSON.parse(readFileSync('supabase/.temp/upload3-browser-item-ids.json','utf8'));
assert.ok([pdf,png].every(id=>/^[a-f0-9-]{36}$/.test(id)));
let stage='items';
try {
 const items=query(`select id,user_id,source,format,content_text,content_hash,external_id,original_url,storage_path,metadata from public.items where id in (${quote(pdf)},${quote(png)})`);assert.equal(items.length,2);
 const p=items.find(i=>i.id===pdf),o=items.find(i=>i.id===png);assert.equal(p.user_id,o.user_id);
 for(const i of items){assert.equal(i.source,'upload');assert.equal(i.original_url,null);assert.ok(i.storage_path.startsWith(i.user_id+'/'));const e=i.metadata.upload.extraction;assert.equal(e.status,'complete');assert.equal(e.pages.length,1);assert.equal(e.pages[0].start,0);assert.equal(e.pages[0].end,Array.from(i.content_text).length);assert.equal(createHash('sha256').update(i.content_text).digest('hex'),i.content_hash);}
 assert.equal(p.content_text,'Synthetic fixture text');assert.equal(p.format,'pdf');assert.equal(p.metadata.upload.extraction.provider,'pdfjs');assert.equal(p.metadata.upload.extraction.execution,'server');assert.equal(p.metadata.upload.extraction.method,'embedded');
 assert.equal(o.format,'image');assert.ok(o.content_text.includes('한글'));assert.ok(o.content_text.includes('테스트'));assert.ok(o.content_text.includes('ENGLISH DOCUMENT TEST 12345'));
 assert.equal(o.metadata.upload.extraction.provider,'tesseract.js');assert.equal(o.metadata.upload.extraction.execution,'client');assert.equal(o.metadata.upload.extraction.language,'kor+eng');assert.equal(o.metadata.upload.extraction.providerVersion,'7.0.0');
 console.log('PASS: actual PDF embedded/pdfjs/server and image OCR/tesseract.js/client/kor+eng text, hash, ranges, canonical identity and metadata.');
 stage='dedupe';
 const sessions=query(`select state,item_id,idempotency_key,raw_hash from private.upload_sessions where user_id=${quote(p.user_id)} and item_id in (${quote(pdf)},${quote(png)})`);
 assert.equal(sessions.filter(s=>s.item_id===pdf&&s.state==='complete').length,1);assert.equal(sessions.filter(s=>s.item_id===png&&s.state==='complete').length,1);assert.equal(sessions.filter(s=>s.item_id===png&&s.state==='reused').length,1);assert.equal(new Set(sessions.map(s=>s.idempotency_key)).size,3);
 for(const i of items){const hash=sessions.find(s=>s.item_id===i.id).raw_hash;assert.equal(query(`select count(*)::integer n from public.items where user_id=${quote(i.user_id)} and metadata->'upload'->>'rawHash'=${quote(hash)}`)[0].n,1);}
 console.log('PASS: new idempotency keys, identical original bytes reused existing image ITEM; one ITEM per raw hash.');
 stage='regression';
 const before=JSON.parse(readFileSync('supabase/.temp/upload3-provider-before.json','utf8'));const expected=new Map(before.map(r=>[r.k,r.v]));
 const sql=`select 'data.connections' k,md5(coalesce(jsonb_agg(to_jsonb(t)order by id)::text,'')) v from public.connections t union all select 'data.tokens',md5(coalesce(jsonb_agg(to_jsonb(t)order by connection_id)::text,''))from private.google_connection_tokens t union all select 'data.items',md5(coalesce(jsonb_agg(to_jsonb(t)order by id)::text,''))from public.items t where id not in (${quote(pdf)},${quote(png)}) union all select 'data.classifications',md5(coalesce(jsonb_agg(to_jsonb(t)order by id)::text,''))from public.classifications t union all select 'data.actions',md5(coalesce(jsonb_agg(to_jsonb(t)order by id)::text,''))from public.actions t union all select 'data.evidence',md5(coalesce(jsonb_agg(to_jsonb(t)order by id)::text,''))from public.action_sources t union all select 'data.users',count(*)::text from auth.users`;
 for(const row of query(sql))assert.equal(row.v,expected.get(row.k),'Existing stored data changed');
 const counts=query(`select source,count(*)::integer n from public.items where source in ('gmail','drive','calendar') group by source`);for(const source of ['gmail','drive','calendar'])assert.ok(counts.some(r=>r.source===source&&r.n>0));
 console.log('PASS: existing Gmail/Drive/Calendar stored ITEMs, connections/tokens, classifications, Actions/Evidence and user count unchanged; safe reads only.');
 writeFileSync('supabase/.temp/upload3-browser-result.json',JSON.stringify({pdf,png,metadata:true,dedupe:true,regression:true,counts}));
} catch {console.error(`FAIL: actual browser result verification at ${stage}; text/data/credentials suppressed.`);process.exitCode=1;}


