import { getGoogleConnectionSummary } from "@/lib/google/connections";
import { connectionErrorResponse, connectionResponse } from "@/lib/google/http";
import { requireUser } from "@/lib/supabase/auth";

export async function GET() {
  try {
    const user = await requireUser();
    const connection = await getGoogleConnectionSummary(user.id);
    return connectionResponse({
      google: connection
        ? {
            status: connection.status,
            accountEmail: connection.accountEmail,
            lastSyncedAt: connection.lastSyncedAt,
          }
        : null,
    });
  } catch (error) {
    return connectionErrorResponse(error);
  }
}
