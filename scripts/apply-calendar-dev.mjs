// Applies only the two explicitly approved Calendar functions to ai-hub-dev.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { query, quote, snapshotSql, requireDev } from "./calendar-dev-db.mjs";
const versions=["20261005055748","20261005055754"];
try {
  requireDev();
  const history=query("select version from supabase_migrations.schema_migrations order by version");
  const local=readdirSync("supabase/migrations").filter(n=>n.endsWith('.sql'));
  assert.ok(local.every(n=>versions.includes(n.slice(0,14)) || history.some(h=>h.version===n.slice(0,14))));
  assert.deepEqual(history.filter(h=>!local.some(n=>n.startsWith(h.version))).map(h=>h.version),["20261003103041","20261003104321"]);
  assert.ok(versions.every(v=>!history.some(h=>h.version===v)),"Migration already present; inspect rather than reapply");
  const migrations=versions.map(v=>{
    const name=local.find(n=>n.startsWith(v)); const sql=readFileSync(`supabase/migrations/${name}`,"utf8");
    assert.equal(sql,readFileSync(`docs/drafts/calendar/${name.slice(15)}`,"utf8"));
    assert.ok(!/\b(?:create|alter|drop)\s+(?:table|index|policy)\b/i.test(sql));
    return {v,name:name.slice(15,-4),sql,body:sql.replace(/^begin;\s*$/m,"").replace(/^commit;\s*$/m,"")};
  });
  const before=query(snapshotSql)[0];
  writeFileSync("supabase/.temp/calendar3-before-migration.json",JSON.stringify(before));
  if (!process.argv.includes('--apply')) { console.log("PASS: local/remote versions and two approved function-only Migration files; initial two remote-only versions retained."); process.exit(0); }
  const sql="begin;\n"+migrations.map(m=>m.body+`\ninsert into supabase_migrations.schema_migrations(version,name,statements) values(${quote(m.v)},${quote(m.name)},array[${quote(m.sql)}]);`).join('\n')+"\nselect true as applied;\ncommit;";
  assert.equal(query(sql)[0].applied,true);
  const after=query(snapshotSql)[0]; assert.deepEqual(after,before);
  const registered=query("select version,name from supabase_migrations.schema_migrations order by version");
  assert.equal(registered.length,history.length+2);
  assert.ok(versions.every(v=>registered.some(h=>h.version===v)));
  // Exact remote/local bodies and migration text are checked by verify-calendar-dev.mjs.
  const checks=query(`select count(*)=2 and bool_and(p.prosecdef and 'search_path=""'=any(p.proconfig) and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute') and has_function_privilege('service_role',p.oid,'execute')) as secure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('persist_calendar_item','upgrade_google_calendar_scopes')`);
  assert.equal(checks[0].secure,true);
  writeFileSync("supabase/.temp/calendar3-migration-result.json",JSON.stringify({applied:true,preservation:true,versions}));
  console.log("PASS: exactly two Calendar migrations applied/registered atomically; existing data, tokens, tables/columns/indexes/RLS/constraints/triggers/other functions/history unchanged. Service-only RPC privileges verified.");
} catch(error) { console.error(`FAIL: Calendar migration (${error.message ?? "details suppressed"}).`); process.exitCode=1; }
