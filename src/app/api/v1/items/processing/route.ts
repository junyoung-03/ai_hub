import { requireUser } from "@/lib/supabase/auth";
import { itemErrorResponse, itemResponse } from "@/lib/items/http";
import { getProcessingSnapshots, parseProcessingIds } from "@/lib/items/processing-queries";

/** Authenticated, owner-scoped read only. Never starts analysis or indexing. */
export async function GET(request: Request) {
  try {
    await requireUser();
    const ids = parseProcessingIds(new URL(request.url).searchParams);
    return itemResponse({ items: await getProcessingSnapshots(ids) });
  } catch (error) { return itemErrorResponse(error); }
}
