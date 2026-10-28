/** Only allow returning to the local library, never an external redirect. */
export function libraryReturnUrl(value: unknown): string {
  if (typeof value !== "string" || !/^\/library(?:\?|$)/.test(value) || value.length > 8192) return "/library";
  const url = new URL(value, "https://library.invalid");
  return url.origin === "https://library.invalid" && url.pathname === "/library"
    ? `${url.pathname}${url.search}`
    : "/library";
}
