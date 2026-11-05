import { interactionScoreLabels, interactionTagLabels, type ShopInteractionSummary, type ShopInteractionTag } from "@bitocard/api-client/classifieds";

/** What each score means, 1 to 5. */
export const scoreWords = ["Poor", "Fair", "Good", "Very good", "Excellent"] as const;
export const scoreWord = (score: number) => scoreWords[Math.min(5, Math.max(1, Math.round(score))) - 1]!;

/** The promise made beside every rating form. */
export const privacyNote = "Private: the seller never sees who rated them, only a summary once five buyers have.";
export const commentNote = "For Udozo's team only. The seller never sees it.";

export const scoreKeys = Object.keys(interactionScoreLabels) as Array<keyof typeof interactionScoreLabels>;

/** The seller's summary as lines to show: each score with its word, then how many buyers gave each tag. */
export function summaryLines(summary: ShopInteractionSummary) {
  if (!summary.shown || !summary.scores) return null;
  return {
    scores: scoreKeys.map(key => {
      const value = summary.scores![key];
      return { key, label: interactionScoreLabels[key], value, text: value === null ? "No ratings" : `${value.toFixed(1)} of 5 · ${scoreWord(value)}` };
    }),
    tags: summary.tags.map(({ tag, count }) => ({ tag, label: interactionTagLabels[tag as ShopInteractionTag] ?? tag, text: `${count} ${count === 1 ? "buyer" : "buyers"}` })),
  };
}

/** Why the seller cannot see their summary yet, in words. */
export function summaryWaiting(summary: ShopInteractionSummary) {
  if (!summary.open) return "Buyers do not rate sellers in your market yet.";
  if (!summary.shown) return `Your summary shows once ${summary.minimum} buyers have rated you. Ratings from today count from tomorrow, so nobody can tell who said what.`;
  return null;
}

/** Days of the summary's date in words ("Counted up to 5 November 2026"). */
export const asOfText = (iso: string) => `Counted up to ${new Date(Date.parse(iso) - 1).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}`;
