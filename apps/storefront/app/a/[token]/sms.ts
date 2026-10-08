/** Pure helpers for a virtual number's messages on an order's page (shared by the server page and its client parts). */

/** The GSM 03.38 alphabet, as the API checks it: anything else (emoji, most non-Latin scripts) makes a message Unicode. */
const gsm = /^[\n\r\x20-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà€^{}\\[~\]|]*$/;

/** One SMS part: 160 characters, or 70 when the text needs characters outside the GSM alphabet. */
export const smsLimit = (text: string) => (gsm.test(text) ? 160 : 70);

/**
 * The sign-in code in a message: the first run of 4 to 8 digits, where a run may be split by single hyphens or spaces
 * ("123-456" and "123 456" are 123456), or null. Longer runs (phone numbers, references) are not codes.
 */
export function smsCode(text: string): string | null {
  for (const [run] of text.matchAll(/(?<!\d)\d+(?:[- ]\d+)*(?!\d)/g)) {
    const digits = run.replace(/[- ]/g, "");
    if (digits.length >= 4 && digits.length <= 8) return digits;
  }
  return null;
}

/** What an outgoing message's status reads as. */
export const sentStatus: Record<string, string> = { queued: "Sending", sent: "Sent", delivered: "Delivered", failed: "Failed" };
