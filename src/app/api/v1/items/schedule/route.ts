import { InvalidItemQueryError, parseItemQuery } from "@/lib/items/filters";
import { itemErrorResponse, itemResponse } from "@/lib/items/http";
import { getScheduleItems } from "@/lib/items/queries";
import { requireUser } from "@/lib/supabase/auth";

export async function GET(request: Request) {
  try {
    await requireUser();
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !["cursor", "limit"].includes(key))) throw new InvalidItemQueryError();
    return itemResponse(await getScheduleItems(parseItemQuery(params)));
  } catch (error) { return itemErrorResponse(error); }
}
