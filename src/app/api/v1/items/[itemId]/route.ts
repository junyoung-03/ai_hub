import { itemErrorResponse, itemNotFound, itemResponse } from "@/lib/items/http";
import { getItemDetail } from "@/lib/items/queries";

export async function GET(_request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const data = await getItemDetail((await params).itemId);
    return data ? itemResponse(data) : itemNotFound();
  } catch (error) { return itemErrorResponse(error); }
}
