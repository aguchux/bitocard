import type { MarketingProspect, MarketingStage } from "@bitocard/api-client/admin";

/**
 * Ready messages for each stage, filled with the seller's details and their own invite link. The admin edits them
 * before sending; nothing promises what Udozo does not do (listing is free, Safe pay holds the money, Seller HQ is free
 * while paid plans are off).
 */
export type MessageTemplate = { key: string; stage: MarketingStage; label: string; text: string };

export const messageTemplates: MessageTemplate[] = [
  {
    key: "reach_out",
    stage: "reach_out",
    label: "First contact",
    text: "Hello {first}, I'm {me} from Udozo. I came across your {category} adverts on {source} and they look great. We're opening Udozo, a new marketplace where buyers near you can find you and pay safely. Could I tell you a bit more?",
  },
  {
    key: "invitation",
    stage: "invitation",
    label: "Invitation with link",
    text: "Thanks {first}! Here is your invitation to sell on Udozo: {link}\n\nSigning up takes two minutes with your email and mobile, and listing is free. With Safe pay the buyer's money is held until they have the item, so no fake transfer alerts. You can also open your own store on Seller HQ, free.",
  },
  {
    key: "onboarding",
    stage: "onboarding",
    label: "Onboarding nudge",
    text: "Hi {first}, how did the sign-up go? If anything got in the way, reply here and I'll walk you through it. Next step: post your first listing at {sell}. A few clear photos and your price are enough.",
  },
  {
    key: "follow_up_1",
    stage: "follow_up",
    label: "Follow-up, day 1",
    text: "Hi {first}, {me} from Udozo again. Did you get a chance to look at the invitation? Your link is here when you're ready: {link}",
  },
  {
    key: "follow_up_3",
    stage: "follow_up",
    label: "Follow-up, day 3",
    text: "Hi {first}, just checking in. Have you been able to post your first listing on Udozo? If you're stuck on any step, tell me which one and I'll help.",
  },
  {
    key: "follow_up_7",
    stage: "follow_up",
    label: "Follow-up, day 7",
    text: "Hi {first}, a last check-in from Udozo this week. Buyers in {location} are already browsing. Your invitation is still open: {link}. Would you like help getting your first listings up?",
  },
  {
    key: "feedback",
    stage: "feedback",
    label: "Ask for feedback",
    text: "Hi {first}, thank you for trying Udozo. Could you tell me in a line what worked and what didn't? And from 1 to 5, how likely are you to recommend Udozo to another seller?",
  },
];

/** The templates for a stage, its own first. */
export const templatesFor = (stage: MarketingStage) => [...messageTemplates.filter(item => item.stage === stage), ...messageTemplates.filter(item => item.stage !== stage)];

const firstName = (name: string) => {
  const word = name.trim().split(/\s+/)[0] ?? "";
  // A store name in capitals ("ALPHA GADGETS NG") reads as a greeting in title case.
  return word.length > 1 && word === word.toUpperCase() ? word.charAt(0) + word.slice(1).toLowerCase() : word || "there";
};

/** The template filled in for this seller, from this admin, with their invite link. */
export function fillTemplate(template: string, prospect: MarketingProspect, me: { name: string }, site: string) {
  const values: Record<string, string> = {
    first: prospect.name.startsWith("Seller ") ? "there" : firstName(prospect.name),
    name: prospect.name,
    store: prospect.store_name ?? prospect.name,
    category: (prospect.categories[0] ?? "product").toLowerCase(),
    source: prospect.source,
    location: (prospect.location ?? "your area").split(",").at(-1)!.trim(),
    link: prospect.invite_link,
    sell: `${site.replace(/\/$/, "")}/sell`,
    me: me.name.trim().split(/\s+/)[0] || "the Udozo team",
  };
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/** WhatsApp with the message written in, for the seller's number. */
export function whatsappMessage(phone: string, text: string) {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
