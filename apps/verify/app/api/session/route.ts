import { NextResponse } from "next/server";
import { exchangeToken, kycCookie, kycCookieOptions } from "@/lib/api";
import { crossSite, errorReply } from "@/lib/requests";

const tokenPattern = /^[A-Za-z0-9._~-]{16,512}$/;
const invalid = () => errorReply(404, "kyc_link_invalid", "This link has expired or was already used.");

/**
 * Exchanges the one-time link's token (read from the address's fragment by `/s`) for the applicant's session, kept in
 * the `bc_kyc` cookie. The session token itself never reaches the browser.
 */
export async function POST(request: Request) {
  if (crossSite(request)) return errorReply(403, "cross_site", "Open the link you were sent.");
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!tokenPattern.test(token)) return invalid();
  const result = await exchangeToken(token);
  if (!result.ok) return result.status === 0 || result.status >= 500 ? errorReply(502, "unreachable", result.message) : invalid();
  const response = NextResponse.json({ ok: true, status: result.data.case.status }, { headers: { "cache-control": "no-store" } });
  response.cookies.set(kycCookie, result.data.session.token, kycCookieOptions());
  return response;
}
