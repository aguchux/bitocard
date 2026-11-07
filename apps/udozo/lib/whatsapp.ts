import { cache } from "react";
import { shopApi } from "@/lib/api";

/** Whether WhatsApp and wanted requests are open in a market, and Udozo's number there (`GET /v1/classifieds/channels`). */
export type Channels = { object: "classified_channels"; country: string; whatsapp: { available: boolean; number: string | null; /** Codes confirming a mobile can go on WhatsApp (Meta approved the template). */ codes?: boolean }; wanted: boolean };

/** The customer's WhatsApp (`GET /v1/store/account/whatsapp`). */
export type WhatsappConnection = {
  object: "whatsapp_connection";
  available: boolean;
  number: string | null;
  chat_link: string | null;
  connected: boolean;
  phone: string | null;
  connected_at: string | null;
  opted_out: boolean;
  chats: boolean;
  alerts: boolean;
  /** "Let buyers WhatsApp me directly": Contact seller on Udozo's WhatsApp gives buyers this number. */
  direct: boolean;
  window_open: boolean;
};

export type WhatsappLink = { object: "whatsapp_link"; code: string; link: string | null; expires_at: string };

export const whatsappScreen = "/account/profile/whatsapp";

/** A market's channels, kept a minute; nothing open while the API cannot answer. */
export const channelsFor = cache(async (country: string | null | undefined): Promise<Channels> => {
  const code = (country ?? "").toUpperCase();
  const closed: Channels = { object: "classified_channels", country: code, whatsapp: { available: false, number: null, codes: false }, wanted: false };
  if (!/^[A-Z]{2}$/.test(code)) return closed;
  const result = await shopApi<Channels>(`/v1/classifieds/channels?country=${code}`, { revalidate: 60 });
  return result.ok ? result.data : closed;
});

/** A wa.me link to Udozo's number with the message filled in, or null without a number. */
export function whatsappHref(number: string | null | undefined, text?: string) {
  const digits = (number ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** "Ask on WhatsApp" on a listing: Udozo's number with `L <ref>`, which opens that listing in the chat. */
export const askOnWhatsappHref = (number: string | null | undefined, ref: number) => whatsappHref(number, `L ${ref}`);

/** What a refusal says, in plain words. */
export function whatsappErrorText(error: { status: number; code: string | null; message: string }) {
  if (error.status === 401) return "Sign in again to carry on.";
  switch (error.code) {
    case "whatsapp_unavailable":
      return "Udozo is not on WhatsApp in your country yet.";
    case "link_code_limit":
      return "You asked for several codes in the last hour. Use the last one, or try again later.";
    case "whatsapp_not_connected":
      return "Connect your WhatsApp first.";
    default:
      return error.message || "That did not work. Try again in a moment.";
  }
}
