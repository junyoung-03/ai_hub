import { disconnectGoogleConnection, getGoogleConnectionSummary } from "@/lib/google/connections";
import { connectionErrorResponse, connectionResponse } from "@/lib/google/http";
import { requireUser } from "@/lib/supabase/auth";

export async function POST() {
  try {
    const user = await requireUser();
    const connection = await getGoogleConnectionSummary(user.id);
    if (!connection) return connectionResponse({ error: { code: "NOT_FOUND", message: "연결을 찾을 수 없습니다.", details: {} } }, 404);
    await disconnectGoogleConnection(connection.id);
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return connectionErrorResponse(error);
  }
}
