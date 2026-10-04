import "server-only";

import { isAuthApiError, isAuthSessionMissingError, type User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication required.");
    this.name = "AuthenticationRequiredError";
  }
}

/** Returns a server-verified user; raw cookie session data is never trusted. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    if (
      isAuthSessionMissingError(error) ||
      (isAuthApiError(error) &&
        (error.status === 401 ||
          ["bad_jwt", "user_not_found", "session_not_found", "refresh_token_not_found", "refresh_token_already_used"].includes(error.code ?? "")))
    ) {
      return null;
    }

    // Do not expose Supabase's raw error, JWT, or session to callers or logs.
    throw new Error("Unable to verify the current authentication state.");
  }

  return data.user;
});

export async function isAuthenticated(): Promise<boolean> {
  return (await getCurrentUser()) !== null;
}

/** Call inside every protected server entry point; map this error to 401 later. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();

  if (!user) {
    throw new AuthenticationRequiredError();
  }

  return user;
}

/** Pages redirect; API handlers must still map requireUser() failures to 401. */
export async function requirePageUser(): Promise<User> {
  try {
    return await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      redirect("/login");
    }
    throw error;
  }
}
