import { noiseState } from "@/lib/items/noise";
import { readWriteBody, writeErrorResponse, writeResponse } from "@/lib/items/write-http";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ itemId: string }> }) {
  try { return writeResponse(await noiseState((await context.params).itemId)); }
  catch (error) { return writeErrorResponse(error); }
}
export async function PATCH(request: Request, context: { params: Promise<{ itemId: string }> }) {
  try { return writeResponse(await noiseState((await context.params).itemId, await readWriteBody(request))); }
  catch (error) { return writeErrorResponse(error); }
}
