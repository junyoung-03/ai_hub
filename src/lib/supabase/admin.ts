import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSupabaseConfig } from "@/lib/supabase/env";
import type { Database, Json } from "@/types/database";

// Postgres type generation does not describe nullable function arguments.
type RefreshFields = "p_refresh_token_ciphertext" | "p_refresh_token_iv" | "p_refresh_token_tag";
type NullableRefreshArgs<T> = Omit<T, RefreshFields> & Record<RefreshFields, string | null>;
type Functions = Database["public"]["Functions"];
type TokenRpcDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Omit<Functions, "upsert_google_connection" | "refresh_google_connection_tokens" | "persist_gmail_item_analysis"> & {
      upsert_google_connection: Omit<Functions["upsert_google_connection"], "Args"> & {
        Args: NullableRefreshArgs<Functions["upsert_google_connection"]["Args"]>;
      };
      refresh_google_connection_tokens: Omit<Functions["refresh_google_connection_tokens"], "Args"> & {
        Args: NullableRefreshArgs<Functions["refresh_google_connection_tokens"]["Args"]>;
      };
      persist_gmail_item_analysis: {
        Args: { p_user_id: string; p_item_id: string; p_content_text: string;
          p_content_hash: string | null; p_analysis: Json; p_model: string; p_input_fingerprint: string };
        Returns: Json;
      };
    };
  };
};

/** No cookie storage or user session can override this server credential. */
export function createAdminClient() {
  const { url } = getSupabaseConfig();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim()
    || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) throw new Error("Supabase server credentials are not configured.");

  return createClient<TokenRpcDatabase>(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
