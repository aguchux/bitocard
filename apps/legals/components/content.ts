import type { IconName } from "@/components/icons";

/** Card details for each legal document, keyed by its href in @bitocard/ui/legal. */
export const documentDetails: Record<string, { icon: IconName; summary: string }> = {
  "/documents/privacy": { icon: "shield", summary: "What our websites collect, why, who we share it with, and your rights in each region." },
  "/documents/terms": { icon: "document", summary: "The rules for using BitoCard websites, and the law that applies where you are." },
  "/documents/cookies": { icon: "cookie", summary: "The few cookies we use: your chosen country and keeping you signed in. Never for tracking." },
  "/documents/notice": { icon: "building", summary: "The Golojan group companies behind BitoCard and how to reach them." },
};

/** Privacy rights by region. Anchors match the region headings in the privacy notice. */
export const regions = [
  { name: "Europe", laws: "UK GDPR · EU GDPR · Swiss FADP", anchor: "europe", tone: "pink" },
  { name: "United States", laws: "CCPA/CPRA · state privacy laws", anchor: "united-states", tone: "blue" },
  { name: "Canada", laws: "PIPEDA · Quebec Law 25", anchor: "canada", tone: "violet" },
  { name: "Africa", laws: "NDPA · POPIA · Kenya DPA", anchor: "africa", tone: "green" },
  { name: "Asia", laws: "DPDP Act · PDPA · APPI · PIPA", anchor: "asia", tone: "amber" },
] as const;

export const commitments: { icon: IconName; title: string; body: string }[] = [
  { icon: "ban", title: "We don’t sell your data", body: "We do not sell personal information or use it for targeted advertising." },
  { icon: "cookie", title: "No tracking cookies", body: "We set only the cookies our sites need, such as the country you choose, and run no analytics or advertising trackers." },
  { icon: "scale", title: "Your rights, wherever you are", body: "Access, correction, deletion and more, under the law where you live." },
  { icon: "clock", title: "Updated before we launch", body: "We will publish service terms and update these notices before accounts or payments go live." },
];

