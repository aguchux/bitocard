"use server";

import { redirect } from "next/navigation";
import { customerApi, safeNext } from "@/lib/customer";
import { cleanRef } from "@/lib/invite";
import { keepWhatsappFlow, whatsappMarket } from "@/lib/whatsapp-sign-in";

type Started = { code: string; text: string; link: string | null; token: string; expires_at: string };

/**
 * "Continue with WhatsApp": asks the API for a sign-in in the market where Udozo is on WhatsApp, keeps its token in
 * this browser, and opens the waiting page, which shows the code to send (and a link and QR code that fill it in).
 * A number with an account signs in after saying yes on WhatsApp; one without makes its account there first.
 */
export async function continueWithWhatsapp(form: FormData) {
  const intent = form.get("intent") === "signup" ? "signup" : "signin";
  const next = safeNext(form.get("next"));
  const page = intent === "signup" ? "/signup" : "/signin";
  const back = (code: string) => redirect(`${page}?next=${encodeURIComponent(next)}&auth_error=${code}`);
  const market = await whatsappMarket();
  if (!market) back("whatsapp_unavailable");
  const ref = cleanRef(String(form.get("ref") ?? "")) ?? undefined;
  const result = await customerApi<Started>("POST", "/v1/store/account/whatsapp-sign-in/start", { intent, country: market!.country, ...(ref ? { ref } : {}) });
  if (!result.ok || !result.data.link) back(result.ok ? "whatsapp_unavailable" : result.code === "whatsapp_unavailable" ? "whatsapp_unavailable" : "whatsapp_failed");
  const started = (result as { ok: true; data: Started }).data;
  await keepWhatsappFlow({ token: started.token, code: started.code, text: started.text, link: started.link!, intent, next, expires: started.expires_at });
  redirect("/signin/whatsapp");
}
