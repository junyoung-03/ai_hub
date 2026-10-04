import { existsSync } from "node:fs";

// Local CLI only: no public health endpoint, user query, or admin key.
if (process.env.NODE_ENV === "production") {
  console.error("NOT RUN: This connection check is for local development only.");
  process.exit(2);
}

if (existsSync(".env.local")) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    console.error("FAIL: Unable to load .env.local. File contents are not logged.");
    process.exit(1);
  }
}

if (process.env.NODE_ENV === "production") {
  console.error("NOT RUN: Production configuration is not allowed.");
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

if (!url || !publishableKey) {
  console.error(
    "NOT RUN: Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.",
  );
  process.exit(2);
}

try {
  const projectUrl = new URL(url);
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(
    projectUrl.hostname,
  );
  if (
    (projectUrl.protocol !== "https:" &&
      !(isLocal && projectUrl.protocol === "http:")) ||
    projectUrl.username ||
    projectUrl.password ||
    projectUrl.search ||
    projectUrl.hash ||
    projectUrl.pathname !== "/" ||
    !publishableKey.startsWith("sb_publishable_")
  ) {
    throw new Error("Invalid public connection configuration.");
  }

  const response = await fetch(new URL("/auth/v1/settings", projectUrl), {
    headers: { apikey: publishableKey },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    console.error(`FAIL: Supabase Auth connection check returned HTTP ${response.status}.`);
    process.exitCode = 1;
  } else {
    const settings = await response.json();
    if (
      typeof settings !== "object" ||
      settings === null ||
      typeof settings.external !== "object" ||
      settings.external === null
    ) {
      throw new Error("Unexpected Auth settings response.");
    }
    console.log("PASS: Supabase Auth is reachable with the configured publishable key.");
    console.log("DB access, RLS, and signed-in session refresh were not tested.");
  }
} catch {
  console.error(
    "FAIL: Check the public connection configuration, network access, and Supabase Auth availability. Values and response bodies are not logged.",
  );
  process.exitCode = 1;
}
