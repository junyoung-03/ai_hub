import { listActions } from "@/lib/items/actions";
import { writeErrorResponse, writeResponse } from "@/lib/items/write-http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { return writeResponse(await listActions(new URL(request.url).searchParams)); }
  catch (error) { return writeErrorResponse(error); }
}
