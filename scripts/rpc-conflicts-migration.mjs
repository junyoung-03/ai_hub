import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export const migrationPath='supabase/migrations/20261010021425_nonretryable_rpc_conflicts.sql';
export const migration=readFileSync(migrationPath,'utf8');
export const conflictNames=['search_runtime','search_index','persist_drive_item','persist_calendar_item','upgrade_google_connection_scopes','upgrade_google_calendar_scopes'];
export function conflictBlocks(names=conflictNames){
 return names.map(name=>{assert.ok(conflictNames.includes(name));const tag='$conflict_'+name+'$';const start=migration.indexOf('DO '+tag);assert.ok(start>=0);return migration.slice(start,migration.indexOf('end '+tag+';',start)+('end '+tag+';').length);}).join('\n');
}
export async function applyConflictMigration(db,names){
 const rows=async()=> (await db.query(`select p.oid,p.proname,p.prosrc,pg_get_function_identity_arguments(p.oid) args,pg_get_function_result(p.oid) result,p.prosecdef,p.proconfig,p.proacl::text acl,p.proowner,p.provolatile,p.proparallel,p.proisstrict from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=any($1::text[]) order by p.proname`,[names])).rows;
 const before=await rows();assert.equal(before.length,names.length);
 await db.exec(conflictBlocks(names));const after=await rows();
 for(let i=0;i<before.length;i++){const {prosrc:old,...a}=before[i],{prosrc:fixed,...b}=after[i];assert.deepEqual(a,b);assert.equal(fixed,old.replaceAll("errcode='40001'","errcode='PT409'"));}
 await db.exec(conflictBlocks(names));assert.deepEqual(await rows(),after);
 console.log('PASS: exact SQLSTATE-only body changes, signature/security/search_path/ACL/owner/result preserved and migration idempotent: '+names.join(', '));
}
