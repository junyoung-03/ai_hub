import "server-only";
import { connection } from "next/server";

/** Request time for display-only date groups, never a source of deadline values. */
export async function getWorkspaceClock() {
  await connection();
  return Date.now();
}
