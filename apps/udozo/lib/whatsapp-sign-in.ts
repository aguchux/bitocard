import "server-only";
import { cookies } from "next/headers";
import { markets } from "@/lib/api";
import { marketCookie, readMarketChoice } from "@/lib/market-choice";
import { channelsFor } from "@/lib/whatsapp";

/**
 * "Continue with WhatsApp" on udozo.com: starting it (`continueWithWhatsapp`) asks the API for a one-time code and a
 * token; the code goes in a wa.me link to Udozo's number, the token stays in this site's own `udz_whatsapp` cookie
 * (host-only, httpOnly, `SameSite=Lax`, 20 minutes) with what was asked and where to go next. The waiting page then asks
 * the API with the token (`/api/whatsapp-sign-in`) until the sign-in is approved on WhatsApp, and signs this browser in.
 */
export const whatsappSignInCookie = "udz_whatsapp";
export const whatsappSignInMaxAge = 60 * 20;

export type WhatsappSignInFlow = { token: string; code: string; text: string; link: string; intent: "signin" | "signup"; next: string; expires: string };

export async function keepWhatsappFlow(flow: WhatsappSignInFlow) {
  (await cookies()).set(whatsappSignInCookie, JSON.stringify(flow), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: whatsappSignInMaxAge });
}

/** The sign-in this browser started, if it is still there (read, not removed). */
export async function readWhatsappFlow(): Promise<WhatsappSignInFlow | null> {
  const raw = (await cookies()).get(whatsappSignInCookie)?.value;
  if (!raw) return null;
  try {
    const flow = JSON.parse(raw) as Partial<WhatsappSignInFlow>;
    const ok =
      typeof flow.token === "string" &&
      /^bws_[\w-]{20,}$/.test(flow.token) &&
      typeof flow.code === "string" &&
      typeof flow.text === "string" &&
      typeof flow.link === "string" &&
      flow.link.startsWith("https://wa.me/") &&
      (flow.intent === "signin" || flow.intent === "signup") &&
      typeof flow.next === "string" &&
      typeof flow.expires === "string";
    return ok ? (flow as WhatsappSignInFlow) : null;
  } catch {
    return null;
  }
}

export async function dropWhatsappFlow() {
  (await cookies()).delete(whatsappSignInCookie);
}

/**
 * Where WhatsApp signs people in from: the market the visitor chose (`udz_market`) where Udozo is on WhatsApp there,
 * else the first open market where it is. Null where it is on WhatsApp nowhere (the buttons are then left out).
 */
export async function whatsappMarket(): Promise<{ country: string; number: string } | null> {
  const chosen = readMarketChoice((await cookies()).get(marketCookie)?.value);
  const open = (await markets()).data.map(market => market.country);
  const order = chosen && chosen !== "all" && open.includes(chosen) ? [chosen, ...open.filter(code => code !== chosen)] : open;
  for (const country of order) {
    const channels = await channelsFor(country);
    if (channels.whatsapp.available && channels.whatsapp.number) return { country, number: channels.whatsapp.number };
  }
  return null;
}

/** What a refused or ended WhatsApp sign-in says, by the code in the address. */
export const whatsappSignInErrors: Record<string, string> = {
  whatsapp_unavailable: "Udozo is not on WhatsApp in your country yet. Use your email instead.",
  whatsapp_sign_in_expired: "That took too long. Start again with WhatsApp.",
  whatsapp_sign_in_declined: "The sign-in was turned down on WhatsApp. Start again if it was you.",
  whatsapp_failed: "Signing in with WhatsApp did not work. Try again.",
};
