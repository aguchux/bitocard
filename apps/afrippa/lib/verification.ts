"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@afrippa/ui/forms";
import { customerApi, signInPath } from "@/lib/customer";
import type { TraderCheck } from "@/lib/verification-types";

/**
 * The trader's identity check: started (or continued) through Afrippa's signed server, which answers a single-use link
 * into Verify in Afrippa's name; the browser is sent there. The sandbox finishes it with a simulated outcome.
 */

/** Only Verify's own address (or a local one in development): a link anywhere else is never followed. */
export async function verifyLink(url: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const local = parsed.hostname === "localhost" || parsed.hostname.endsWith(".localhost");
    if (parsed.protocol === "https:" ? !parsed.hostname.startsWith("verify.") : !local) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function startCheck(_state: FormState, form: FormData): Promise<FormState> {
  if (form.get("consent") !== "on") return { error: "Tick the box to agree to the check, including the face check.", field: "consent" };
  const result = await customerApi<TraderCheck>("POST", "/v1/afrippa/account/verification", { consent: true });
  if (!result.ok) {
    if (result.status === 401) redirect(signInPath("/verification"));
    return { error: result.message, field: result.param };
  }
  const link = await verifyLink(result.data.url);
  if (link) redirect(link);
  revalidatePath("/verification");
  return { notice: result.data.status === "approved" ? "Your identity is verified." : result.data.status === "in_review" ? "Your check is with our team." : "Your check has started." };
}

/** The sandbox only: approve or decline the trader's own check. */
export async function simulateCheck(_state: FormState, form: FormData): Promise<FormState> {
  const outcome = form.get("outcome") === "declined" ? "declined" : "approved";
  const result = await customerApi("POST", "/v1/afrippa/account/verification/simulate", { outcome });
  if (!result.ok) {
    if (result.status === 401) redirect(signInPath("/verification"));
    return { error: result.message };
  }
  revalidatePath("/verification");
  return { notice: outcome === "approved" ? "Approved (sandbox)." : "Declined (sandbox)." };
}
