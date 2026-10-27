import type { StoreSpinAllowance, StoreSpinRewards } from "@bitocard/api-client/storefront";

/**
 * The wheel's geometry, shared by the wheel and its tests. Segments run clockwise from the top: segment `i` covers
 * `[i × width, (i + 1) × width)` degrees clockwise from twelve o'clock, and the pointer is fixed at the top. Turning the
 * wheel by `angle` degrees (CSS `rotate`, clockwise) puts the wheel's point at `a` under `a + angle`.
 */

/** Degrees per segment. */
export const segmentWidth = (count: number) => 360 / count;

const mod = (value: number, by: number) => ((value % by) + by) % by;

/** The segment under the pointer when the wheel is turned by `angle` degrees. */
export function segmentAt(angle: number, count: number) {
  const width = segmentWidth(count);
  // The wheel's point under the top pointer is at -angle (mod 360).
  return Math.floor(mod(-angle, 360) / width + 1e-9) % count;
}

/** The angle that centres segment 0 under the pointer: where the wheel rests before its first spin. */
export const restingAngle = (count: number) => -segmentWidth(count) / 2;

/**
 * Where the wheel stops to show `segment`: at least `turns` full turns past `current` (so it always spins forwards
 * and never snaps back), with the pointer inside the segment. `offset` moves the landing point off the segment's
 * centre, as a fraction of its width (kept within ±0.4, so it never lands on a line).
 */
export function landingAngle({ current, segment, count, turns, offset = 0 }: { current: number; segment: number; count: number; turns: number; offset?: number }) {
  const width = segmentWidth(count);
  const nudge = Math.max(-0.4, Math.min(0.4, offset));
  // The point on the wheel that must end at the top, and the rotation (mod 360) that puts it there.
  const point = (mod(segment, count) + 0.5 + nudge) * width;
  const target = mod(-point, 360);
  const extra = mod(target - current, 360);
  return current + Math.max(1, Math.floor(turns)) * 360 + extra;
}

/** "$0.05" from "0.05"; the API's dollar strings keep two places. */
export const usd = (value: string) => `$${Number(value).toFixed(2)}`;

/** A wedge's colour: the wheel's top prize is gold, the rest alternate navy and pink. */
export type SegmentTone = "navy" | "pink" | "gold";

export function segmentTones(segments: Array<{ usd: string }>): SegmentTone[] {
  const top = Math.max(...segments.map(segment => Number(segment.usd)));
  return segments.map((segment, i) => (segments.length > 2 && Number(segment.usd) === top ? "gold" : i % 2 ? "pink" : "navy"));
}

/** The dollar token on the wheel's chips, the wins and the rewards: Spin and win pays in US dollars. */
export const dollar = { colour: "#16a34a", glyph: "$" } as const;

/** Today's spins as lights: one per spin a day, lit for each still to spin (all lit before the first spin). */
export function todayLights(allowance: StoreSpinAllowance | null, dailyLimit: number) {
  const total = Math.max(1, allowance?.daily_limit ?? dailyLimit);
  const lit = !allowance ? total : allowance.finished ? 0 : Math.min(total, Math.max(0, allowance.today_left));
  return { lit, total };
}

/** Wins shown at a time in the dialog's history; the rest are a page away. */
export const winsPerPage = 5;

/**
 * Which wins a page of the history shows: `page` (0 is the newest) kept within the pages there are, and the slice
 * `start` to `end` of the list, newest first.
 */
export function winsPage(count: number, page: number, size = winsPerPage) {
  const pages = Math.max(1, Math.ceil(count / size));
  const current = Math.min(Math.max(0, page), pages - 1);
  const start = current * size;
  return { pages, current, start, end: Math.min(count, start + size) };
}

/** Why the customer cannot spin, in plain words, with where to put it right (if anywhere). */
export const spinBlocks: Record<string, { title: string; text: string; link?: { href: string; label: string } }> = {
  not_enabled: { title: "Spin and win is not open here yet", text: "We open it store by store and country by country. We will tell you when you can spin." },
  spins_not_enabled: { title: "Spin and win is not open here yet", text: "We open it store by store and country by country. We will tell you when you can spin." },
  email_not_verified: { title: "Confirm your email address first", text: "Enter the code we emailed you, then come back to spin.", link: { href: "/account/verify", label: "Confirm my email" } },
  claimed_elsewhere: { title: "You have had your spins already", text: "Spin and win is once per person across every store, and yours started at another store." },
};

/**
 * Whether Spin and win belongs on Home: the customer can spin, has spins still to come, or holds rewards to move into
 * their wallet.
 */
export const showSpin = (rewards: StoreSpinRewards | null): rewards is StoreSpinRewards =>
  Boolean(rewards && (rewards.enabled || (rewards.allowance && !rewards.allowance.finished) || Number(rewards.rewards?.usd ?? 0) > 0));
