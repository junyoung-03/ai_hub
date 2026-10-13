import { listActions } from "@/lib/items/actions";
import { createManualAction } from "@/lib/items/manual-action";
import { readWriteBody, writeErrorResponse, writeResponse } from "@/lib/items/write-http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    return writeResponse(await listActions(new URL(request.url).searchParams));
  } catch (error) {
    return writeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return writeResponse(await createManualAction(await readWriteBody(request)), 201);
  } catch (error) {
    return writeErrorResponse(error);
  }
}
