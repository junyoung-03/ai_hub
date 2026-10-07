import { getGoogleConnectionSummary, getGoogleServicesSyncSummary } from "@/lib/google/connections";
import { connectionErrorResponse, connectionResponse } from "@/lib/google/http";
import { requireUser } from "@/lib/supabase/auth";

export async function GET() {
  try {
    const user = await requireUser();
    const [connection, syncSummary] = await Promise.all([
      getGoogleConnectionSummary(user.id),
      getGoogleServicesSyncSummary(user.id),
    ]);
    return connectionResponse({
      google: connection
        ? {
            status: connection.status,
            accountEmail: connection.accountEmail,
            lastSyncedAt: connection.lastSyncedAt,
            capabilities: connection.capabilities,
          }
        : null,
      googleAccount: syncSummary.googleAccount,
      services: syncSummary.services,
    });
  } catch (error) {
    return connectionErrorResponse(error);
  }
}
