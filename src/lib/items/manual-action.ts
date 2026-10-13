import "server-only";
import { requireUser } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ItemWriteError } from "./writes";
import type { SearchActionResult } from "@/types/search-ui";
import { parseActionInput } from "./action-input";

export async function createManualAction(body: unknown) {
  const user = await requireUser();
  const { title, date, deadlineAt } = parseActionInput(body);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("actions")
    .insert({
      user_id: user.id,
      origin: "manual",
      title,
      action_type: "required",
      status: "open",
      deadline_status: "confirmed",
      deadline_date: date,
      deadline_at: deadlineAt,
      requirements: [],
      conditions: [],
    })
    .select("id,title,action_type,status,deadline_status,deadline_date,deadline_at,requirements,conditions,completed_at,created_at")
    .single();

  if (error || !data) {
    throw new ItemWriteError("STORAGE_UNAVAILABLE", 503);
  }

  const result: SearchActionResult = {
    kind: "action",
    actionId: data.id,
    title: data.title,
    type: data.action_type,
    status: data.status,
    deadlineStatus: data.deadline_status,
    deadlineDate: data.deadline_date,
    deadlineAt: data.deadline_at,
    requirements: data.requirements ?? [],
    conditions: data.conditions ?? [],
    sources: [],
  };

  return { action: result };
}
