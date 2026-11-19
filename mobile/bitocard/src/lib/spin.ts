/**
 * The spin wheel's geometry: segments drawn clockwise from the top (index 0 centred at the top, as the API numbers
 * them), and how far to turn so the won segment stops under the pointer. Free of React Native, for `node --test`.
 */

const radians = (degrees: number) => ((degrees - 90) * Math.PI) / 180;

/** The SVG path of segment `index` of `count`, a wedge of a circle of radius `r` centred at (r, r). */
export function wedgePath(index: number, count: number, r: number) {
  const step = 360 / count;
  const from = radians(index * step - step / 2);
  const to = radians(index * step + step / 2);
  const point = (angle: number) => `${(r + r * Math.cos(angle)).toFixed(2)} ${(r + r * Math.sin(angle)).toFixed(2)}`;
  return `M ${r} ${r} L ${point(from)} A ${r} ${r} 0 0 1 ${point(to)} Z`;
}

/** Where a segment's label sits: its middle, at `share` of the radius out from the centre. */
export function labelPoint(index: number, count: number, r: number, share = 0.68) {
  const angle = radians(index * (360 / count));
  return { x: r + r * share * Math.cos(angle), y: r + r * share * Math.sin(angle), rotate: index * (360 / count) };
}

/**
 * The wheel's next rotation (degrees, always forward from `current`): `turns` whole turns, then on until segment
 * `index` is at the top under the pointer.
 */
export function landingRotation(current: number, index: number, count: number, turns = 5) {
  const target = (((360 - index * (360 / count)) % 360) + 360) % 360;
  const now = ((current % 360) + 360) % 360;
  return current + turns * 360 + ((target - now + 360) % 360);
}

/** `"0.05"` as `5¢`, `"1.00"` as `$1`: how the wheel shows US dollar values. */
export function spinValue(usd: string) {
  const cents = Math.round(Number(usd) * 100);
  return cents < 100 ? `${cents}¢` : `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
}
