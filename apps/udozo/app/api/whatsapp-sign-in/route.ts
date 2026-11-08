import { confirmationPending, type Customer, customerApi, keepSession, safeNext } from "@/lib/customer";
import { mergeVisitorHistory } from "@/lib/discovery-server";
import { dropWhatsappFlow, readWhatsappFlow } from "@/lib/whatsapp-sign-in";

type Status =
  | { status: "waiting" | "declined" | "expired" }
  | { status: "approved"; customer: Customer; session: { token: string }; signed_up: boolean };

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

/**
 * The waiting page asks here every few seconds (only this site's own pages): with the token this browser keeps, has
 * the sign-in been approved on WhatsApp? Once it has, this browser is signed in (the session kept, the visitor's history
 * merged, the flow's cookie removed) and told where to go: `/verify` while anything is left to confirm, else `next`.
 */
export async function POST(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return json({ status: "error" }, 403);
  const flow = await readWhatsappFlow();
  if (!flow) return json({ status: "missing" });
  const result = await customerApi<Status>("POST", "/v1/store/account/whatsapp-sign-in/finish", { token: flow.token });
  if (!result.ok) {
    await dropWhatsappFlow();
    return json({ status: "over" });
  }
  if (result.data.status !== "approved") {
    if (result.data.status !== "waiting") await dropWhatsappFlow();
    return json({ status: result.data.status });
  }
  await keepSession(result.data.session);
  await mergeVisitorHistory(result.data.session);
  await dropWhatsappFlow();
  const next = safeNext(flow.next);
  return json({ status: "approved", redirect: confirmationPending(result.data.customer) ? `/verify?next=${encodeURIComponent(next)}` : next, signed_up: result.data.signed_up });
}
