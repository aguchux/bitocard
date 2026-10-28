/**
 * Each coin's colour and mark (its currency sign where it has one, else its first letter), drawn here: no outside
 * images. The mark stays legible at every badge size, where a 4-letter code never fitted.
 */
const coinMarks: Record<string, { colour: string; glyph: string }> = {
  USDT: { colour: "bg-emerald-500 text-white", glyph: "₮" },
  USDC: { colour: "bg-blue-600 text-white", glyph: "$" },
  BTC: { colour: "bg-orange-500 text-white", glyph: "₿" },
  ETH: { colour: "bg-indigo-600 text-white", glyph: "Ξ" },
  BNB: { colour: "bg-yellow-400 text-navy-900", glyph: "B" },
  POL: { colour: "bg-violet-600 text-white", glyph: "P" },
  TRX: { colour: "bg-red-600 text-white", glyph: "T" },
  LTC: { colour: "bg-slate-600 text-white", glyph: "Ł" },
  DOGE: { colour: "bg-amber-500 text-navy-900", glyph: "Ð" },
};
export const coinMark = (asset: string) => coinMarks[asset] ?? { colour: "bg-slate-500 text-white", glyph: asset.slice(0, 1) };

/** The mark's size for each badge size used. */
const glyphSizes: Record<string, string> = { "size-8": "text-sm", "size-9": "text-base", "size-10": "text-lg", "size-12": "text-xl" };

/** A coin's round badge: its mark on its colour, with a soft inner shade. */
export function CoinBadge({ asset, size = "size-10" }: { asset: string; size?: string }) {
  const mark = coinMark(asset);
  return (
    <span
      className={`grid ${size} shrink-0 place-items-center rounded-full font-extrabold leading-none shadow-[inset_0_-2px_0_rgb(0_0_0/0.14)] ring-1 ring-black/5 ${glyphSizes[size] ?? "text-lg"} ${mark.colour}`}
      aria-hidden="true"
    >
      {mark.glyph}
    </span>
  );
}
