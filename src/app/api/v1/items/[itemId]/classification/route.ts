import { updateClassification } from "@/lib/items/writes";
import { readWriteBody, writeErrorResponse, writeResponse } from "@/lib/items/write-http";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ itemId: string }> }) {
  try { return writeResponse(await updateClassification((await context.params).itemId, await readWriteBody(request))); }
  catch (error) { return writeErrorResponse(error); }
}
