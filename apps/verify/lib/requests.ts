import type { ApiResult } from "./api";

/**
 * Only this site's own pages may call its route handlers. The session cookie is SameSite=Strict already; browsers also
 * say where a request comes from (`Sec-Fetch-Site`), so anything another site makes is refused before it reaches the API.
 */
export function crossSite(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin";
}

export function errorReply(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });
}

/** Passes the API's answer on: its data, or its error with the same status (a failed connection is a 502). */
export function reply<T>(result: ApiResult<T>) {
  if (result.ok) return Response.json(result.data, { headers: { "cache-control": "no-store" } });
  return Response.json({ error: { code: result.code, message: result.message, param: result.param } }, { status: result.status || 502, headers: { "cache-control": "no-store" } });
}

/** What the wizard may change through `/api/case/<step>`, and the API endpoint for each. Anything else is a 404. */
export const caseSteps = {
  consent: { method: "PUT", path: "/v1/kyc/case/consent" },
  business: { method: "PUT", path: "/v1/kyc/case/business" },
  identity: { method: "PUT", path: "/v1/kyc/case/identity" },
  liveness: { method: "POST", path: "/v1/kyc/case/liveness" },
  submit: { method: "POST", path: "/v1/kyc/case/submit" },
} as const;
