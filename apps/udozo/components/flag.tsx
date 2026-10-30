/* eslint-disable @next/next/no-img-element -- a 3:2 SVG flag served by this site (`/flags/<code>.svg`), no optimisation needed. */

/** A country's flag, from this site's own `/flags` (never an outside host). Decorative: the code or name sits beside it. */
export function Flag({ country, className = "h-3.5 w-5" }: { country: string; className?: string }) {
  return <img src={`/flags/${country.toLowerCase()}.svg`} alt="" width={20} height={14} className={`${className} shrink-0 rounded-[2px] object-cover`} />;
}
