import type { KycCase } from "@bitocard/api-client/kyc";
import { kycApi } from "@/lib/api";
import { caseSteps, crossSite, errorReply, reply } from "@/lib/requests";

/** One step of the wizard: the JSON body goes to the API with the applicant's session; the case comes back. */
export async function POST(request: Request, { params }: { params: Promise<{ step: string }> }) {
  if (crossSite(request)) return errorReply(403, "cross_site", "Open the link you were sent.");
  const { step } = await params;
  const target = caseSteps[step as keyof typeof caseSteps];
  if (!target) return errorReply(404, "not_found", "Not found.");
  if (!request.headers.get("content-type")?.startsWith("application/json")) return errorReply(415, "json_required", "Send JSON.");
  const body = (await request.json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) return errorReply(400, "parameter_invalid", "Send an object.");
  return reply(await kycApi<KycCase>(target.method, target.path, body));
}
