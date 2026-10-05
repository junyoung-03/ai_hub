// Read-only comparison of approved local function bodies and registered migration text.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { query, quote } from "./calendar-dev-db.mjs";
try {
  const files=['20261005055748_google_calendar_scope_boundary.sql','20261005055754_persist_calendar_item.sql'];
  const predicates=[];
  for(const file of files) {
    const sql=readFileSync(`supabase/migrations/${file}`,'utf8');
    predicates.push(`exists(select 1 from supabase_migrations.schema_migrations where version=${quote(file.slice(0,14))} and name=${quote(file.slice(15,-4))} and statements=array[${quote(sql)}])`);
    const functions=[...sql.matchAll(/create (?:or replace )?function public\.([a-z_]+)\([\s\S]*?as \$\$([\s\S]*?)\$\$/gi)];
    assert.ok(functions.length);
    for(const [,name,body] of functions) predicates.push(`exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=${quote(name)} and p.prosrc=${quote(body)} and p.prosecdef and 'search_path=""'=any(p.proconfig) and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute') and has_function_privilege('service_role',p.oid,'execute'))`);
  }
  assert.equal(query(`select ${predicates.join(' and ')} as exact_match`)[0].exact_match,true);
  console.log('PASS: exact remote function bodies/security/privileges and both registered Migration versions/names/statements match approved local files.');
} catch { console.error('FAIL: Calendar remote/local match; details suppressed.'); process.exitCode=1; }
