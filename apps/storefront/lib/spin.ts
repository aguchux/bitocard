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

/** How far through the $1 the customer is, 0 to 100. */
export function wonPercent(won: string, total: string) {
  const share = Number(total) > 0 ? (Number(won) / Number(total)) * 100 : 0;
  return Math.max(0, Math.min(100, Number.isFinite(share) ? share : 0));
}

/** Why the customer cannot spin, in plain words, with where to put it right (if anywhere). */
export const spinBlocks: Record<string, { title: string; text: string; link?: { href: string; label: string } }> = {
  not_enabled: { title: "Spin and win is not open here yet", text: "We open it store by store and country by country. We will tell you when you can spin." },
  spins_not_enabled: { title: "Spin and win is not open here yet", text: "We open it store by store and country by country. We will tell you when you can spin." },
  crypto_not_enabled: { title: "Crypto is not available in your country yet", text: "Winnings are paid in crypto, so the wheel opens when crypto does." },
  email_not_verified: { title: "Confirm your email address first", text: "Enter the code we emailed you, then come back to spin.", link: { href: "/account/verify", label: "Confirm my email" } },
  customer_verification_required: { title: "Verify your identity to spin", text: "Winnings go into your crypto wallet, which needs a quick identity check, once.", link: { href: "/account/verification", label: "Verify my identity" } },
  crypto_account_frozen: { title: "Your crypto account is frozen", text: "You cannot spin until BitoCard has looked into your account. Contact support to find out more." },
  claimed_elsewhere: { title: "You have had your $1 already", text: "It is one $1 per person across every store, and yours started at another store." },
};
