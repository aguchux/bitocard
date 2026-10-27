import Link from "next/link";
import { Globe2 } from "lucide-react";
import { globalMarket } from "@bitocard/crypto-ui/market";
import { marketPath, markets } from "@/lib/api";

/**
 * Every market BitoCard Crypto shows, as cards with their ads per currency: its own small part, reading the cached
 * markets list. `current` is left out (the page it is on).
 */
export async function MarketsList({ current, title = "Other markets" }: { current?: string; title?: string }) {
  const shown = (await markets()).data.filter(item => item.market !== current);
  if (!shown.length) return null;
  return (
    <section aria-labelledby="markets-title" className="space-y-3">
      <h2 id="markets-title" className="font-display text-xl font-extrabold text-navy-900">
        {title}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {shown.map(item => (
          <li key={item.market}>
            <Link href={marketPath(item.market)} className="flex h-full items-center gap-3 rounded-3xl bg-white p-4 ring-1 ring-slate-200/70 transition hover:shadow-md hover:ring-slate-300">
              <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
                {item.market === globalMarket ? (
                  <Globe2 className="size-5 text-navy-900" aria-hidden="true" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- the flag is a static SVG served by this site.
                  <img src={`/flags/${item.market.toLowerCase()}.svg`} alt="" width={44} height={44} className="size-full object-cover" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{item.market === globalMarket ? "Global market" : item.name}</span>
                <span className="block text-xs text-slate-500">{item.currencies.map(currency => `${item.ads[currency] ?? 0} in ${currency}`).join(" · ")}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The markets' shape while they load. */
export function MarketsListSkeleton() {
  return <div aria-hidden="true" className="h-24 animate-pulse rounded-3xl bg-white ring-1 ring-slate-200/70 motion-reduce:animate-none" />;
}
