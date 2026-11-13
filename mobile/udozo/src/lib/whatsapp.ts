/**
 * Connecting the customer's WhatsApp to their Udozo account, as udozo.com's Profile > WhatsApp
 * (apps/udozo/lib/whatsapp.ts): the types the API answers, wa.me links and its refusals in words. Kept free of React
 * Native so it runs under `node --test`.
 */

/** Whether WhatsApp is open in a market, and Udozo's number there (`GET /v1/classifieds/channels?country=`). */
export type Channels = { object: 'classified_channels'; country: string; whatsapp: { available: boolean; number: string | null; codes?: boolean }; wanted: boolean };

/** The customer's WhatsApp (`GET /v1/store/account/whatsapp`). */
export type WhatsappConnection = {
  object: 'whatsapp_connection';
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

/** A one-time code to send from their number as `LINK <code>` (10 minutes), with the wa.me link that fills it in. */
export type WhatsappLink = { object: 'whatsapp_link'; code: string; link: string | null; expires_at: string };

export type WhatsappChoices = { chats?: boolean; alerts?: boolean; direct?: boolean };

/** A wa.me link to a number with the message filled in, or null without a number. */
export function whatsappHref(number: string | null | undefined, text?: string) {
  const digits = (number ?? '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/** Where Connect sends the customer: the API's own link, else one made from Udozo's number and the code. */
export const linkHref = (link: WhatsappLink, number: string | null) => link.link ?? whatsappHref(number, `LINK ${link.code}`);

/** What a refusal says, in plain words. */
export function whatsappErrorText(code: string, message: string) {
  switch (code) {
    case 'whatsapp_unavailable':
      return 'Udozo is not on WhatsApp in your country yet.';
    case 'link_code_limit':
      return 'You asked for several codes in the last hour. Use the last one, or try again later.';
    case 'whatsapp_not_connected':
      return 'Connect your WhatsApp first.';
    default:
      return message || 'That did not work. Try again in a moment.';
  }
}

/** Udozo's number with "Hi", as udozo.com's WhatsApp tab's Start a chat with Udozo (its menu answers it). */
export const startChatHref = (number: string | null | undefined) => whatsappHref(number, 'Hi');

/** What Udozo does on WhatsApp (udozo.com's `whatsappFeatures`), each opening the chat with the word that starts it. */
export const whatsappFeatures = [
  { word: 'FIND', title: 'Find something', detail: 'Send what you are looking for and tap a listing to see its photo, price and place.', icon: 'find' },
  { word: 'SELL', title: 'Sell something', detail: 'Post an ad step by step: title, category, price, place and photos, all in the chat.', icon: 'sell' },
  { word: 'WANT', title: 'Post a request', detail: 'Say what you need and sellers with a match answer you with their listing.', icon: 'want' },
  { word: 'CHATS', title: 'Chat with sellers', detail: 'Messages go through Udozo, so nobody sees your number. Reply to a message to answer it.', icon: 'chats' },
  { word: 'Hi', title: "Ask Udozo's assistant", detail: 'Questions about buying, selling, prices and staying safe, answered by AI where it is on. It can make mistakes.', icon: 'assistant' },
  { word: 'HELP', title: 'Help', detail: 'MENU shows the menu, CANCEL stops what you are doing, STOP means no more messages.', icon: 'help' },
] as const;

/** The safety note under them. */
export const whatsappSafety = 'Udozo never asks for your codes or passwords on WhatsApp. See the item before you pay, or use UdozoPay.';

/** WhatsApp's own green, for the pull-up's handle and header. */
export const whatsappGreen = '#25D366';
