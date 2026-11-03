import type { MarketingStage } from "@bitocard/api-client/admin";
import type { MessageTemplate } from "./templates";

/**
 * Short messages for texting sellers, one per stage, filled like the WhatsApp ones (`fillTemplate`). Kept to plain
 * characters (straight apostrophes, hyphens) so each fits the fewest SMS parts, and promising only what Udozo does.
 */
export const smsTemplates: MessageTemplate[] = [
  { key: "sms_reach_out", stage: "reach_out", label: "First contact", text: "Hi {first}, I'm {me} from Udozo. I saw your {category} adverts on {source}. Udozo is a new marketplace where buyers near you can pay safely. Can I tell you more?" },
  { key: "sms_invitation", stage: "invitation", label: "Invitation with link", text: "Hi {first}, here is your invitation to sell on Udozo: {link} Listing is free, and Safe pay holds the buyer's money until they have the item. - {me}, Udozo" },
  { key: "sms_onboarding", stage: "onboarding", label: "Onboarding nudge", text: "Hi {first}, how did sign-up go? Post your first listing at {sell} - a few clear photos and your price are enough. Reply if you need help. - {me}, Udozo" },
  { key: "sms_follow_up", stage: "follow_up", label: "Follow-up", text: "Hi {first}, {me} from Udozo again. Your invitation is still open: {link} Reply if you'd like help with your first listing." },
  { key: "sms_feedback", stage: "feedback", label: "Ask for feedback", text: "Hi {first}, thanks for trying Udozo. From 1 to 5, how likely are you to recommend it to another seller? Reply with a number and a line on why." },
];

/** The SMS templates for a stage, its own first. */
export const smsTemplatesFor = (stage: MarketingStage) => [...smsTemplates.filter(item => item.stage === stage), ...smsTemplates.filter(item => item.stage !== stage)];

// The GSM 03.38 alphabet every phone shows without Unicode; the extension characters take two places each.
const gsmBasic = new Set("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà");
const gsmExtension = new Set("^{}\\[~]|€\f");

/** How a message is sent and what it costs: GSM (160 a part, 153 when split) or Unicode (70, 67 when split). */
export function smsParts(text: string) {
  let units = 0;
  let unicode = false;
  for (const char of text) {
    if (gsmBasic.has(char)) units += 1;
    else if (gsmExtension.has(char)) units += 2;
    else {
      unicode = true;
      break;
    }
  }
  const length = unicode ? [...text].reduce((sum, char) => sum + (char.codePointAt(0)! > 0xffff ? 2 : 1), 0) : units;
  const [single, split] = unicode ? [70, 67] : [160, 153];
  const parts = length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / split);
  return { encoding: unicode ? ("unicode" as const) : ("gsm" as const), length, parts, left: parts <= 1 ? single - length : parts * split - length };
}

/** Curly quotes, dashes, ellipses and odd spaces written as their plain forms, which keep a message in GSM. */
export function plainCharacters(text: string) {
  return text
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[–—‒―]/g, "-")
    .replace(/…/g, "...")
    .replace(/[\u00a0\u2000-\u200a\u202f\u205f]/g, " ")
    .replace(/[•·]/g, "-");
}
