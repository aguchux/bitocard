// Anjio's seller scores (docs/UDOZO_RATINGS_PLAN.md phase 3): the rules, apart from the data, so each is easy to test.

const minuteMs = 60_000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;

export const metricKeys = ['response', 'attention', 'pricing', 'costing', 'reliability', 'satisfaction', 'salesmanship'] as const;
export type MetricKey = (typeof metricKeys)[number];

/** Below these samples a metric is null: not enough to say. */
export const minSamples: Record<MetricKey, number> = { response: 5, attention: 8, pricing: 5, costing: 3, reliability: 3, satisfaction: 3, salesmanship: 5 };
/** The overall score's weights, over the metrics that have a score. */
export const weights: Record<MetricKey, number> = { reliability: 25, satisfaction: 25, response: 15, attention: 15, salesmanship: 10, costing: 5, pricing: 5 };
/** The overall score needs at least this much weight behind it (never one metric on its own). */
export const minOverallWeight = 30;

export type Metric = { score: number; n: number; [extra: string]: number | string | null };
export type Metrics = Record<MetricKey, Metric | null>;

export const bands = ['excellent', 'very_good', 'good', 'fair', 'needs_work'] as const;
export type Band = (typeof bands)[number];
export const bandLabels: Record<Band, string> = { excellent: 'Excellent', very_good: 'Very good', good: 'Good', fair: 'Fair', needs_work: 'Needs work' };
export function bandOf(score: number): Band {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'very_good';
  if (score >= 55) return 'good';
  if (score >= 40) return 'fair';
  return 'needs_work';
}
const topTwo = (score: number) => score >= 70;

const clamp = (value: number) => Math.max(0, Math.min(100, value));
export const round = (value: number) => Math.round(clamp(value));

/** Straight lines between points, flat outside them. */
function between(points: Array<[number, number]>, x: number) {
  if (x <= points[0]![0]) return points[0]![1];
  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = points[index - 1]!;
    const [x2, y2] = points[index]!;
    if (x <= x2) return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
  }
  return points.at(-1)![1];
}

/** A missing reply counts as this long. */
export const noReplyMs = 7 * dayMs;
/** The median first reply: 15 minutes or less 100, an hour 85, four hours 65, a day 30, a week 0. */
export const responseScore = (medianMs: number) => between([[15 * minuteMs, 100], [hourMs, 85], [4 * hourMs, 65], [dayMs, 30], [noReplyMs, 0]], medianMs);

export const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/** A listing's price against comparable ones: at or below p25 100, p75 50, falling to 0 a range's width above p75. */
export function costingScore(price: number, p25: number, p75: number, med: number) {
  const width = Math.max(p75 - p25, med * 0.05, 1);
  if (price <= p25) return 100;
  if (price <= p75) return 100 - (50 * (price - p25)) / Math.max(p75 - p25, 1);
  return Math.max(0, 50 - (50 * (price - p75)) / width);
}

/** Pulled towards the market's own level (`prior`, 0-100) by `m` imaginary ratings, so few ratings say little. */
export const smoothed = (sum: number, weight: number, prior: number, m = 5) => (sum + m * prior) / (weight + m);

/** The weighted overall score, or null without enough behind it. */
export function overall(metrics: Metrics) {
  let total = 0;
  let weight = 0;
  for (const key of metricKeys) {
    const metric = metrics[key];
    if (!metric) continue;
    total += metric.score * weights[key];
    weight += weights[key];
  }
  return weight >= minOverallWeight ? Math.round(total / weight) : null;
}

/** Only below the minimum sample is a metric left out. */
export const metric = (key: MetricKey, score: number | null, n: number, extra: Record<string, number | string | null> = {}): Metric | null => (score === null || n < minSamples[key] ? null : { score: round(score), n, ...extra });

// ---- What people see ----

export function responseWords(medianMs: number) {
  if (medianMs <= hourMs) return 'Usually replies within an hour';
  if (medianMs <= 4 * hourMs) return 'Usually replies within a few hours';
  if (medianMs <= dayMs) return 'Usually replies within a day';
  return 'Can take more than a day to reply';
}
export function attentionWords(score: number) {
  if (score >= 85) return 'Answers almost every request';
  if (score >= 65) return 'Answers most requests';
  return 'Misses some requests';
}
const highlightWords: Partial<Record<MetricKey, string>> = {
  reliability: 'Completes sales reliably',
  satisfaction: 'Buyers are happy with their purchases',
  pricing: 'Keeps to the prices listed',
  costing: 'Prices in line with the market or below',
};

export type PublicScores = {
  new_seller: boolean;
  response: string | null;
  attention: string | null;
  /** Only at Good or better. */
  band: Band | null;
  band_label: string | null;
  /** Other metrics, only in their top two bands; never salesmanship. */
  highlights: Array<{ key: MetricKey; words: string }>;
};

/** The public view: response and attention as words, the band only at Good or better, the rest only when strong. */
export function publicScores(metrics: Metrics, overallScore: number | null): PublicScores {
  const band = overallScore !== null && overallScore >= 55 ? bandOf(overallScore) : null;
  const response = metrics.response ? responseWords(Number(metrics.response.median_ms)) : null;
  const attention = metrics.attention ? attentionWords(metrics.attention.score) : null;
  const highlights = (['reliability', 'satisfaction', 'pricing', 'costing'] as const).filter(key => metrics[key] && topTwo(metrics[key]!.score)).map(key => ({ key, words: highlightWords[key]! }));
  return { new_seller: !response && !attention && overallScore === null, response, attention, band, band_label: band ? bandLabels[band] : null, highlights };
}

/** The numbers behind a sentence: every number in it must be one of the inputs'. */
export function numbersIn(text: string) {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map(match => match[0].replace(',', '.'));
}

/** Words a summary may never use: claims of safety or trust, payment advice, comparisons. */
export const summaryDenied = /\b(safe(?:ly|ty)?|trust\w*|guarantee\w*|reliab\w* (?:payment|seller)|scam\w*|fraud\w*|pay(?:s|ing|ment)?|wallet|bank|transfer|best|better|worse|worst|than others?|other sellers?|cheapest)\b/i;
export const summaryMax = 240;
export const summaryMin = 20;
