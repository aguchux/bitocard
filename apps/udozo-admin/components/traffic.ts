import type { TrafficChannel, TrafficLanding } from "@bitocard/api-client/admin";

/** Each channel in words, with what it means, and its colour on the chart (in this fixed order, never by rank). */
export const channelLabels: Record<TrafficChannel, { name: string; detail: string }> = {
  paid: { name: "Ads", detail: "Clicked one of our ads (a click id such as fbclid with a paid medium, gclid or msclkid, or utm_medium=cpc)" },
  social: { name: "Social", detail: "Followed a link on Facebook, Instagram, X, TikTok, YouTube, Nairaland and other social sites" },
  search: { name: "Search", detail: "Came from Google, Bing or another search engine without an ad" },
  messaging: { name: "Messaging", detail: "Opened a link in WhatsApp, Telegram or Messenger" },
  email: { name: "Email", detail: "Opened a link in an email" },
  referral: { name: "Other sites", detail: "Followed a link on another website" },
  campaign: { name: "Campaign links", detail: "A link tagged with utm_source that is none of the above" },
  direct: { name: "Direct", detail: "Typed the address, used a bookmark, or the browser did not say where they came from" },
};
export const channelOrder: TrafficChannel[] = ["paid", "social", "search", "messaging", "email", "referral", "campaign", "direct"];

export const landingLabels: Record<TrafficLanding, string> = {
  home: "Home page (all countries)",
  market: "A country's home page",
  listing: "A listing",
  category: "A category",
  search: "Search results",
  place: "A state or area",
  seller: "A seller's page",
  brand: "A brand's page",
  start_here: "Start here",
  invite: "An invite link",
  signup: "Sign up or sign in",
  sell: "Post an ad",
  help: "Help and Safe trade",
  other: "Another page",
};

/** Sources as people know them: the report's codes for well-known sites, else the site's own name. */
const sourceNames: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  google: "Google",
  bing: "Bing",
  x: "X (Twitter)",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  messenger: "Messenger",
  gmail: "Gmail",
  outlook: "Outlook",
  yahoo: "Yahoo",
  yahoo_mail: "Yahoo Mail",
  duckduckgo: "DuckDuckGo",
  nairaland: "Nairaland",
  pinterest: "Pinterest",
  reddit: "Reddit",
  snapchat: "Snapchat",
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  direct: "Direct",
};
export const sourceName = (source: string) => sourceNames[source] ?? source;

/** The change from the period before, in words. */
export function changeWords(now: number, before: number) {
  if (!before) return now ? "New this period" : "None yet";
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? "Same as the period before" : `${pct > 0 ? "Up" : "Down"} ${Math.abs(pct)}% on the period before`;
}
