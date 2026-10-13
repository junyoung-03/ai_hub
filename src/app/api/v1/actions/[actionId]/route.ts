import { updateManualAction, deleteManualAction } from "@/lib/items/action-mutations";
import { readWriteBody, writeErrorResponse, writeResponse } from "@/lib/items/write-http";
export const runtime = "nodejs";
type Context = { params: Promise<{ actionId: string }> };
export async function PATCH(request: Request, context: Context) {
  try { return writeResponse(await updateManualAction((await context.params).actionId, await readWriteBody(request))); }
  catch (error) { return writeErrorResponse(error); }
}
export async function DELETE(request: Request, context: Context) {
  try { await readWriteBody(request, true); return writeResponse(await deleteManualAction((await context.params).actionId)); }
  catch (error) { return writeErrorResponse(error); }
}
