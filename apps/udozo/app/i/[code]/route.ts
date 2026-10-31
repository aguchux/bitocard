import { NextResponse, type NextRequest } from "next/server";
import { apiUrl } from "@/lib/api";
import { inviteSignupPath, isInviteCode } from "@/lib/invite";

/**
 * A seller's invite link from Udozo's Marketing (udozo.com/i/<code>): tells the API it was opened (best effort, never
 * holding the visitor up), then opens sign-up carrying the code, so the account it makes is tracked to the invitation.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!isInviteCode(code)) return NextResponse.redirect(new URL("/start-here", request.url), 307);
  await fetch(apiUrl(`/v1/marketing/invites/${code}/open`), { method: "POST", cache: "no-store", signal: AbortSignal.timeout(2000) }).catch(() => undefined);
  const response = NextResponse.redirect(new URL(inviteSignupPath(code), request.url), 307);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
