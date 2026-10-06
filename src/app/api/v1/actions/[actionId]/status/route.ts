import { updateActionStatus } from "@/lib/items/writes";
import { readWriteBody, writeErrorResponse, writeResponse } from "@/lib/items/write-http";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ actionId: string }> }) {
  try { return writeResponse(await updateActionStatus((await context.params).actionId, await readWriteBody(request))); }
  catch (error) { return writeErrorResponse(error); }
}
