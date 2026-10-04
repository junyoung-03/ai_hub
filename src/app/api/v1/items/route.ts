import { requireUser } from "@/lib/supabase/auth";
import { parseItemQuery } from "@/lib/items/filters";
import { itemErrorResponse, itemResponse } from "@/lib/items/http";
import { listItems } from "@/lib/items/queries";

export async function GET(request: Request) {
  try {
    await requireUser();
    return itemResponse(await listItems(parseItemQuery(new URL(request.url).searchParams)));
  } catch (error) { return itemErrorResponse(error); }
}
