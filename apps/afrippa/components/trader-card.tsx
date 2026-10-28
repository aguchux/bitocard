import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck } from "lucide-react";
import { experiencedTrades, globalMarket } from "@afrippa/ui/market";
import { marketPath, markets, trader } from "@/lib/api";

const since = (iso: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(new Date(iso));

/** A trader's public card: their nickname, trades, open ads and the markets they are in. Nothing else about them. */
export async function TraderCard({ nickname }: { nickname: string }) {
  const [card, shown] = await Promise.all([trader(nickname), markets()]);
  if (!card) notFound();
  const names = new Map(shown.data.map(item => [item.market, item.market === globalMarket ? "Global market" : item.name]));
  return (
    <article className="rounded-3xl bg-white p-6 ring-1 ring-slate-200/70">
      <div className="flex items-center gap-4">
        <span aria-hidden="true" className="grid size-16 shrink-0 place-items-center rounded-full bg-slate-100 text-2xl font-bold text-navy-900 uppercase">
          {card.nickname.slice(0, 1)}
        </span>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-display text-2xl font-extrabold text-navy-900">
            <span className="truncate">{card.nickname}</span>
            {card.trades_total >= experiencedTrades ? <BadgeCheck className="size-6 shrink-0 text-brand-500" aria-label="Experienced trader" /> : null}
          </h1>
          <p className="text-sm text-slate-500">Trading since {since(card.since)}</p>
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
        {[
          ["Trades in 30 days", card.trades_30d],
          ["Trades in all", card.trades_total],
          ["Open ads", card.open_ads],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-slate-50 p-3">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="font-display text-2xl font-extrabold text-navy-900">{value}</dd>
          </div>
        ))}
      </dl>
      {card.markets.length ? (
        <div className="mt-5">
          <h2 className="text-sm font-semibold text-slate-600">Has ads in</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {card.markets.map(code => (
              <li key={code}>
                <Link href={`${marketPath(code)}?q=${encodeURIComponent(card.nickname)}`} className="inline-flex min-h-10 items-center rounded-full bg-white px-4 text-sm font-semibold ring-1 ring-slate-200 hover:ring-slate-300">
                  {names.get(code) ?? code}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

export function TraderCardSkeleton() {
  return <div aria-hidden="true" className="h-64 animate-pulse rounded-3xl bg-white ring-1 ring-slate-200/70 motion-reduce:animate-none" />;
}
