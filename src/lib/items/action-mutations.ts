import "server-only";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isItemId } from "./filters";
import { ItemWriteError } from "./writes";
import { parseActionInput } from "./action-input";

async function ownedManualAction(actionId: string) {
  const user = await requireUser();
  if (!isItemId(actionId)) throw new ItemWriteError("NOT_FOUND", 404);
  const client = await createClient();
  const { data: action, error } = await client.from("actions").select("id,updated_at,origin").eq("id", actionId).eq("user_id", user.id).maybeSingle();
  if (error) throw new ItemWriteError("STORAGE_UNAVAILABLE", 503);
  if (!action) throw new ItemWriteError("NOT_FOUND", 404);
  const { data: sources, error: sourceError } = await client.from("action_sources").select("id").eq("action_id", actionId).eq("user_id", user.id).limit(1);
  if (sourceError) throw new ItemWriteError("STORAGE_UNAVAILABLE", 503);
  // AI actions require a durable user override/tombstone contract before editing or deleting.
  // Never rewrite or cascade-delete original evidence to bypass current DB constraints.
  if (action.origin !== "manual" || sources?.length) throw new ItemWriteError("CONFLICT", 409);
  return { user, action };
}

export async function updateManualAction(actionId: string, body: unknown) {
  const { user, action } = await ownedManualAction(actionId);
  const { title, date, deadlineAt } = parseActionInput(body);
  const { data, error } = await createAdminClient().from("actions")
    .update({ title, deadline_date: date, deadline_at: deadlineAt, deadline_status: "confirmed" })
    .eq("id", actionId).eq("user_id", user.id).eq("origin", "manual").eq("updated_at", action.updated_at)
    .select("id,title,deadline_date,deadline_at").maybeSingle();
  if (error) throw new ItemWriteError("STORAGE_UNAVAILABLE", 503);
  if (!data) throw new ItemWriteError("CONFLICT", 409);
  return { actionId: data.id, title: data.title, date: data.deadline_date, deadlineAt: data.deadline_at };
}

export async function deleteManualAction(actionId: string) {
  const { user, action } = await ownedManualAction(actionId);
  const { data, error } = await createAdminClient().from("actions").delete()
    .eq("id", actionId).eq("user_id", user.id).eq("origin", "manual").eq("updated_at", action.updated_at).select("id").maybeSingle();
  if (error) throw new ItemWriteError("STORAGE_UNAVAILABLE", 503);
  if (!data) throw new ItemWriteError("CONFLICT", 409);
  return { actionId: data.id, deleted: true };
}
