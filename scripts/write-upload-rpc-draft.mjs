// Reproducible function-only follow-up; never rewrites the applied migration.
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const old=readFileSync('supabase/migrations/20261005070410_upload_storage_session_boundary.sql','utf8');
let sql=old.match(/create function public\.upload_session_rpc\([\s\S]*?\$\$;/)[0];
sql=sql.replace('create function','create or replace function');
sql=sql.replace("update private.upload_sessions set attempt=gen_random_uuid(),lease_until=clock_timestamp()+",`-- Reclaim only an expired running attempt; preserve snapshot CAS before preparing again.
    if s.state='running' then
      update public.items set processing_status='failed',processing_error='PROCESSING_TIMEOUT',
        metadata=jsonb_set(metadata,'{upload,extraction}',jsonb_build_object('version','upload-text-v1','status','failed','error','PROCESSING_TIMEOUT','pages','[]'::jsonb))
        where id=s.item_id and user_id=p_user_id and source='upload' and external_id=s.id::text and updated_at=s.item_snapshot and processing_status='extracting';
      if not found then raise exception 'STALE_ATTEMPT' using errcode='40001'; end if;
      update private.upload_sessions set state='failed' where id=s.id returning * into s;
    end if;
    update private.upload_sessions set attempt=gen_random_uuid(),lease_until=clock_timestamp()+`);
sql=sql.replace("if existing_id is not null then",`if existing_id is not null then
        if not exists(select 1 from public.items where id=existing_id and metadata#>>'{upload,extraction,status}'='complete') then
          raise exception 'UPLOAD_IN_PROGRESS' using errcode='55P03';
        end if;`);
sql=sql.replace("(select count(*) from jsonb_object_keys(p_payload))<>5",`(select count(*) from jsonb_object_keys(p_payload))<>11
        or not (p_payload ?& array['version','status','text','hash','pages','method','provider','providerVersion','execution','language','extractionVersion'])
        or p_payload->>'extractionVersion' is distinct from 'upload-text-v1'
        or text_value is distinct from normalize(text_value,NFC)
        or text_value ~ '[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]'`);
sql=sql.replace("(select count(*) from jsonb_object_keys(page))<>6","(select count(*) from jsonb_object_keys(page))<>10");
sql=sql.replace("array['page','start','end','method','provider','confidence']","array['page','start','end','method','provider','confidence','providerVersion','execution','language','extractionVersion']");
sql=sql.replace("or coalesce(page->>'method','') not in ('embedded','ocr') or page->>'provider' is distinct from (case when page->>'method'='ocr' then 'cloud-vision' else 'pdfjs' end)",`or coalesce(page->>'method','') not in ('embedded','ocr')
          or page->>'extractionVersion' is distinct from 'upload-text-v1'
          or (page->>'method'='embedded' and (page->>'provider' is distinct from 'pdfjs' or page->>'providerVersion' is distinct from '6.4.299' or page->>'execution' is distinct from 'server' or page->'language' is distinct from 'null'::jsonb or page->'confidence' is distinct from 'null'::jsonb))
          or (page->>'method'='ocr' and (page->>'provider' is distinct from 'tesseract.js' or page->>'providerVersion' is distinct from '7.0.0' or page->>'execution' is distinct from 'client' or page->>'language' is distinct from 'kor+eng'))`);
sql=sql.replace("if last_end<>count_chars then",`if p_payload->>'method' is distinct from (select case when count(distinct p->>'method')>1 then 'mixed' else min(p->>'method') end from jsonb_array_elements(p_payload->'pages') p)
        or p_payload->>'provider' is distinct from (select case when count(distinct p->>'provider')>1 then 'mixed' else min(p->>'provider') end from jsonb_array_elements(p_payload->'pages') p)
        or p_payload->>'execution' is distinct from (select case when count(distinct p->>'execution')>1 then 'mixed' else min(p->>'execution') end from jsonb_array_elements(p_payload->'pages') p)
        or p_payload->>'providerVersion' is distinct from (select case when count(distinct p->>'providerVersion')>1 then 'mixed' else min(p->>'providerVersion') end from jsonb_array_elements(p_payload->'pages') p)
        or p_payload->'language' is distinct from (case when exists(select 1 from jsonb_array_elements(p_payload->'pages') p where p->>'method'='ocr') then '"kor+eng"'::jsonb else 'null'::jsonb end)
        then raise exception 'UPLOAD_ORIGIN' using errcode='22023'; end if;
      if last_end<>count_chars then`);
assert.ok(!sql.includes('cloud-vision'));assert.ok(sql.includes('tesseract.js'));
sql=`-- Upload-3 DRAFT: user approval required before remote application.\n-- Only RPC validation changes; no table/column/index/Storage policy changes.\nbegin;\n${sql}\nrevoke all on function public.upload_session_rpc(text,uuid,uuid,uuid,jsonb,jsonb,uuid) from public,anon,authenticated;\ngrant execute on function public.upload_session_rpc(text,uuid,uuid,uuid,jsonb,jsonb,uuid) to service_role;\ncommit;\n`;
writeFileSync('supabase/migrations/20261005093526_upload_provider_neutral_rpc.sql',sql);
console.log('PASS: function-only draft generated; no database connection.');
