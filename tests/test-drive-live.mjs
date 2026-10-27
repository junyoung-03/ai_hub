// Opt-in ai-hub-dev. Never prints credentials, identity, file IDs, titles or document content.
import { writeFileSync, readFileSync, mkdirSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { existingGoogleTest } from "../scripts/google-live-loader.mjs";
import { load } from "../scripts/google-live-loader.mjs";
import { loadAnalysisModule } from "./helpers/analysis-loader.mjs";
import { createHash, randomUUID } from "node:crypto";
const file = "supabase/.temp/drive3-before-consent.json";
let stage = "consent";
try {
  if (process.env.DRIVE_LIVE_TEST_PROJECT !== "oclzdppdiljbojvqtkeu") throw new Error("Explicit development target required.");
  const context = await existingGoogleTest();
  const { connection, connections, dataOAuth } = context;
  mkdirSync("supabase/.temp", { recursive: true });
  if (process.argv.includes("--before-consent")) {
    writeFileSync(file, JSON.stringify(connection));
    console.log("PASS: pre-consent ownership and Gmail checkpoints captured internally; no credentials recorded.");
  } else {
    const before = JSON.parse(readFileSync(file, "utf8"));
    if (connection.id !== before.id || connection.user_id !== before.user_id || connection.provider_account_id !== before.provider_account_id
      || JSON.stringify(connection.sync_state) !== JSON.stringify(before.sync_state) || connection.last_synced_at !== before.last_synced_at)
      throw new Error("Consent identity/checkpoint mismatch.");
    dataOAuth.validateGrantedScopes(connection.scopes.join(" "), "drive_scope_upgrade", before.scopes);
    const tokens = await connections.getGoogleConnectionTokens(connection.user_id, connection.id);
    if (!tokens?.refreshToken) throw new Error("Offline bundle missing.");
    console.log("PASS: stored Gmail plus both Drive scopes, same account/connection, usable encrypted bundle and Gmail checkpoints preserved.");
    if (process.argv.includes("--collect")) {
      stage = "docs_e2e";
      const contract = load("src/lib/google/drive-contract.ts");
      const fileId = process.env.DRIVE_TEST_FILE_ID;
      if (!contract.isGoogleFileId(fileId)) throw new Error("One explicit Google Docs test target required.");
      const driveModule = load("src/lib/google/drive-client.ts", {
        "@/lib/google/drive-contract": contract, "@/lib/google/connections": connections, "@/lib/google/data-oauth": dataOAuth,
      });
      let bodyReads = 0;
      const countedDrive = { async createDriveClient(...args) {
        const client = await driveModule.createDriveClient(...args);
        return { ...client, async document(...params) { bodyReads++; return client.document(...params); } };
      } };
      const collector = load("src/lib/google/drive-collection.ts", {
        "@/lib/google/drive-contract": contract, "@/lib/google/docs-text": load("src/lib/google/docs-text.ts", { "@/lib/google/drive-contract": contract }),
        "@/lib/google/drive-client": countedDrive,
        "@/lib/supabase/auth": context.auth, "@/lib/supabase/server": context.server, "@/lib/supabase/admin": context.adminModule,
      });
      async function protectedFingerprint() {
        const { data, error } = await context.admin.from("items").select("id,updated_at,content_hash,metadata")
          .eq("user_id", connection.user_id).eq("source", "gmail").order("id");
        if (error) throw new Error("Gmail snapshot unavailable.");
        const { data: state, error: stateError } = await context.admin.from("connections").select("id,user_id,provider_account_id,status,scopes,sync_state,last_synced_at")
          .eq("id", connection.id).single();
        if (stateError) throw new Error("Gmail state snapshot unavailable.");
        const graph = await Promise.all(["classifications", "actions", "action_sources"].map(async name => {
          const { data: rows, error: readError, count } = await context.admin.from(name).select("*", { count: "exact" })
            .eq("user_id", connection.user_id).order("id").limit(1000);
          if (readError || count !== rows?.length) throw new Error("Analysis snapshot unavailable.");
          return rows;
        }));
        return createHash("sha256").update(JSON.stringify({ data, state, graph })).digest("hex");
      }
      const fingerprint = await protectedFingerprint();
      const input = { mode: "files", fileIds: [fileId] };
      const first = await collector.collectDrive(input);
      if (!first.complete || first.results.length !== 1 || !first.results[0].itemId || first.failed) {
        console.error("Drive E2E result code: " + (first.results[0]?.code ?? "INCOMPLETE"));
        throw new Error("Drive E2E incomplete.");
      }
      const itemId = first.results[0].itemId, readsAfterFirst = bodyReads;
      writeFileSync("supabase/.temp/drive3-e2e-result.json", JSON.stringify({ itemId, fileId, userId: connection.user_id,
        connectionId: connection.id, firstOutcome: first.results[0].outcome, bodyReads: readsAfterFirst, complete: false }));
      const second = await collector.collectDrive(input);
      if (!second.complete || second.reused !== 1 || second.results[0].itemId !== itemId || bodyReads !== readsAfterFirst)
        throw new Error("Same-version reuse failed.");
      const filters = load("src/lib/items/filters.ts", { "@/types/database": load("src/types/database.ts") });
      const queryImports = {
        "@/lib/google/calendar-contract": load("src/lib/google/calendar-contract.ts"),
        "@/lib/uploads/contract": load("src/lib/uploads/contract.ts"),
        "@/lib/supabase/auth": context.auth, "@/lib/supabase/server": context.server, "@/lib/items/filters": filters,
        "@/lib/items/presentation": load("src/lib/items/presentation.ts"),
        "@/lib/gemini/validation": loadAnalysisModule("src/lib/gemini/validation.ts"),
      };
      const queries = load("src/lib/items/queries.ts", queryImports);
      const detail = await queries.getItemDetail(itemId);
      const library = await queries.listItems(filters.parseItemQuery(new URLSearchParams({ source: "drive", limit: "100" })));
      if (!detail || detail.item.source !== "drive" || detail.original.url !== `https://docs.google.com/document/d/${fileId}/edit`
        || !library.items.some(i => i.id === itemId) || (await protectedFingerprint()) !== fingerprint)
        throw new Error("Library/Detail/Gmail isolation failed.");
      const { count, error } = await context.admin.from("items").select("id", { head: true, count: "exact" })
        .eq("user_id", connection.user_id).eq("connection_id", connection.id).eq("source", "drive")
        .is("external_container_id", null).eq("external_id", fileId);
      if (error || count !== 1) throw new Error("Duplicate ITEM found.");
      const foreignQueries = load("src/lib/items/queries.ts", { ...queryImports,
        "@/lib/supabase/auth": { async requireUser() { return { id: randomUUID() }; } },
      });
      if (await foreignQueries.getItemDetail(itemId)) throw new Error("Foreign detail exposed.");
      const rlsFile = "supabase/.temp/drive3-real-item-rls.sql";
      if (!/^[0-9a-f-]{36}$/i.test(itemId)) throw new Error("Invalid stored identity.");
      writeFileSync(rlsFile, `begin; do $check$ declare owner_id uuid; begin
        select user_id into owner_id from public.items where id='${itemId}'::uuid and source='drive';
        if owner_id is null then raise exception 'Target missing'; end if;
        perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
        execute 'set local role authenticated';
        if exists(select 1 from public.items where id='${itemId}'::uuid) then raise exception 'Foreign RLS failed'; end if;
        execute 'reset role';
        perform set_config('request.jwt.claim.sub',owner_id::text,true);
        execute 'set local role authenticated';
        if not exists(select 1 from public.items where id='${itemId}'::uuid) then raise exception 'Owner RLS failed'; end if;
        execute 'reset role'; end; $check$; select true as real_drive_item_rls_pass; rollback;`);
      try {
        const checked = spawnSync("cmd.exe", ["/d", "/s", "/c", `npx --yes supabase db query --linked --project-ref oclzdppdiljbojvqtkeu --file ${rlsFile}`],
          { encoding: "utf8", timeout: 60000 });
        if (checked.status !== 0 || !checked.stdout.includes('"real_drive_item_rls_pass": true')) throw new Error("Real ITEM RLS check failed.");
      } finally { unlinkSync(rlsFile); }
      writeFileSync("supabase/.temp/drive3-e2e-result.json", JSON.stringify({ itemId, fileId, userId: connection.user_id,
        connectionId: connection.id, firstOutcome: first.results[0].outcome, bodyReads, reused: true, rls: true, complete: true }));
      console.log(`PASS: one real Docs metadata -> all-tab text -> ITEM (${first.results[0].outcome}); same-version reuse without body download; one identity; Library/Detail/original_url; Gmail ITEM/checkpoints/analysis unchanged; foreign read denied by owner filter and authenticated DB RLS.`);
      console.log("CLI auth/cookie adapters are substituted; authenticated RLS and Browser checks are verified separately. No Gemini call.");
    }
  }
} catch {
  console.error(`NOT VERIFIED: ${stage}; identity, credentials and provider errors suppressed.`); process.exitCode = 1;
}
