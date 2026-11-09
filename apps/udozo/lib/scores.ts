import { scoreKeyLabels, type ShopMyReviews, type ShopMyScores, type ShopScoreKey } from "@bitocard/api-client/classifieds";

/** What each score measures, for the seller's own page: the score, or why it is not shown yet. */
export function myScoreLines(scores: ShopMyScores) {
  return scores.metrics.map(metric => ({
    key: metric.key,
    label: scoreKeyLabels[metric.key],
    value: metric.score,
    text: metric.score === null ? `Not enough yet (${metric.n} of ${metric.minimum})` : `${metric.score} of 100`,
    note: metric.public ? null : "Private: only you and Udozo see it",
  }));
}

export const bandText = (scores: Pick<ShopMyScores, "overall" | "band_label">) => (scores.overall === null || !scores.band_label ? "Not enough to rate yet" : `${scores.band_label} (${scores.overall} of 100)`);

const measure = (key: ShopScoreKey, how: string, who: string) => ({ key, title: scoreKeyLabels[key], how, who });

/** The help page's words: kept with the rules in the API (docs/UDOZO_RATINGS_PLAN.md phase 3). */
export const anjioMethod = {
  intro:
    "Anjio, Udozo's assistant, works out each seller's scores every night from what happens on Udozo: replies, answers to buyers, prices and completed sales. Nobody pays for a better score, and a score never changes how listings are ranked.",
  measures: [
    measure("response", "How long the seller usually takes to send a first reply in a chat over the last 90 days. A chat left without a reply counts as a week.", "Public, in words, from 5 chats."),
    measure("attention", "How many buyers' chats, calls, call backs, offers and UdozoPay requests the seller answered over 90 days.", "Public, in words, from 8 requests."),
    measure("pricing", "Whether prices stay as listed: prices raised within a week of a buyer asking, \"price on request\" and sales above the listed price count against it.", "Public only when strong, from 5 listings."),
    measure("costing", "How the seller's live prices compare with similar listings (same category, condition, brand and model) on Udozo. Very low prices are never rewarded.", "Public only when strong, from 3 listings."),
    measure("reliability", "Over 180 days: sales completed, against those cancelled after accepting, not answered in time, or that the buyer said did not happen.", "Public only when strong, from 3 sales."),
    measure("satisfaction", "Buyers' reviews over the last year, one voice per buyer, weighed with the market's usual reviews so a few cannot swing it.", "Public only when strong, from 3 reviews."),
    measure("salesmanship", "Buyers' private ratings of how the seller dealt with them before buying.", "Never public: only the seller and Udozo see it, from 5 ratings."),
  ],
  sections: [
    {
      title: "What buyers see",
      body: [
        "How fast the seller usually replies and how often they answer, in words; their band (Excellent, Very good or Good) when they are at least Good; and the measures they do best. Never a number.",
        "A seller with too little activity is shown as a new seller: not enough to rate yet.",
      ],
    },
    {
      title: "What sellers see",
      body: ["Every score with how many chats, requests, listings, sales or reviews it is based on, and tips on what would help, in Reviews > Private ratings in their account."],
    },
    {
      title: "Anjio's summary",
      body: [
        "Anjio may write one or two sentences about a seller from these figures only: never from names, messages, reviews' words or prices. Each one is checked before it shows (only numbers from the figures, no claims that a seller is safe or guaranteed, no advice about paying), and it can be imperfect.",
        "Sellers can report a summary they think is wrong, and Udozo's team can hide it or have it written again.",
      ],
    },
  ],
};

/** Reviews about the seller still showing, open for replies, that they have not answered: the ones worth a reply. */
export function waitingForReply(reviews: ShopMyReviews["data"]) {
  return reviews.filter(review => review.status === "published" && !review.locked && !review.posts.some(post => post.role === "seller"));
}
