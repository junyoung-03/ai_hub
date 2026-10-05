// Explicit dev-only Management API helper. Never prints query text, rows or provider errors.
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
export const project = "oclzdppdiljbojvqtkeu";
export function requireDev() {
  if (process.env.CALENDAR_DB_TEST_PROJECT !== project) throw new Error("Explicit development target required");
}
export function quote(value) { return "'" + String(value).replaceAll("'", "''") + "'"; }
export function query(sql) {
  requireDev(); mkdirSync("supabase/.temp", { recursive: true });
  const path = `supabase/.temp/calendar3-query-${process.pid}.sql`;
  writeFileSync(path, sql);
  try {
    const child = spawnSync("cmd.exe", ["/d", "/s", "/c", `npx --yes supabase db query --linked --project-ref ${project} --file ${path}`], { encoding:"utf8", timeout:60000 });
    const output = (child.stdout ?? "") + (child.stderr ?? "");
    if (child.status !== 0) {
      const code = output.match(/"code"\s*:\s*"([A-Za-z0-9_]+)"/);
      const label = output.match(/C3_[A-Z_]+/);
      throw new Error(`DB check failed (${code?.[1] ?? "query-error"}; ${label?.[0] ?? "details suppressed"})`);
    }
    const start=output.indexOf('{'), end=output.lastIndexOf('}');
    const parsed=JSON.parse(output.slice(start,end+1));
    if (!Array.isArray(parsed.rows)) throw new Error("Missing query result");
    return parsed.rows;
  } finally { unlinkSync(path); }
}
export const snapshotSql = `select
  (select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.connections t) connections,
  (select md5(coalesce(jsonb_agg(to_jsonb(t) order by connection_id)::text,'')) from private.google_connection_tokens t) tokens,
  (select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.items t) items,
  (select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.classifications t) classifications,
  (select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.actions t) actions,
  (select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.action_sources t) evidence,
  (select count(*) from auth.users) users,
  (select md5(coalesce(jsonb_agg(to_jsonb(t) order by table_schema,table_name,column_name)::text,'')) from information_schema.columns t where table_schema in ('public','private')) columns,
  (select md5(coalesce(jsonb_agg(to_jsonb(t) order by schemaname,indexname)::text,'')) from pg_indexes t where schemaname in ('public','private')) indexes,
  (select md5(coalesce(jsonb_agg(to_jsonb(t) order by schemaname,tablename,policyname)::text,'')) from pg_policies t where schemaname in ('public','private')) policies,
  (select md5(coalesce(jsonb_agg(jsonb_build_array(c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl) order by c.relname)::text,'')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p')) tables,
  (select md5(coalesce(jsonb_agg(pg_get_constraintdef(c.oid) order by c.oid)::text,'')) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ('public','private')) constraints,
  (select md5(coalesce(jsonb_agg(pg_get_triggerdef(t.oid) order by t.oid)::text,'')) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private')) triggers,
  (select md5(coalesce(jsonb_agg(jsonb_build_array(pg_get_functiondef(p.oid),p.proacl) order by p.oid)::text,'')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' and p.proname not in ('upsert_google_connection','upgrade_google_calendar_scopes','persist_calendar_item')) functions,
  (select md5(coalesce(jsonb_agg(to_jsonb(t) order by version)::text,'')) from supabase_migrations.schema_migrations t where version not in ('20261005055748','20261005055754')) history;`;
