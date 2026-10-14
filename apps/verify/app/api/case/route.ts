import { currentCase } from "@/lib/api";
import { crossSite, errorReply, reply } from "@/lib/requests";

/** The applicant's case, read again (after an upload elsewhere, or to resume). */
export async function GET(request: Request) {
  if (crossSite(request)) return errorReply(403, "cross_site", "Open the link you were sent.");
  return reply(await currentCase());
}
