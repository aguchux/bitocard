/** The one-time token from the link's fragment (`#t=…`), which never reaches any server log or referrer. */
export function tokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get("t")?.trim();
  return token && /^[A-Za-z0-9._~-]{16,512}$/.test(token) ? token : null;
}
