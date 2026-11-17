import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, Smartphone, Wifi } from "lucide-react";

type Tile = { label: string; hint: string; href: string; icon: typeof Smartphone; exchange?: boolean };

const tiles: Tile[] = [
  { label: "Buy airtime", hint: "Any number. We find the network.", href: "/account/topup", icon: Smartphone },
  { label: "Buy data", hint: "Bundles for any number.", href: "/account/topup?kind=data", icon: Wifi },
  { label: "Sell unused airtime", hint: "Turn it into wallet money.", href: "/account/airtime/sell", icon: ArrowUpFromLine, exchange: true },
  { label: "Buy unused airtime", hint: "For less than its value.", href: "/account/airtime/buy", icon: ArrowDownToLine, exchange: true },
];

/**
 * The Mobile catalogue's four actions (2 × 2 on phones, four across on desktops): topping up airtime or data, and the
 * airtime exchange's selling and buying, shown as Soon (never a link) until it is open (`exchangeOpen`) on the store (bitocard.com, or a reseller’s store that trades airtime).
 */
export function MobileActions({ exchangeOpen }: { exchangeOpen: boolean }) {
  return (
    <div className="space-y-2">
      <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tiles.map(tile => {
          const closed = tile.exchange && !exchangeOpen;
          const body = (
            <>
              <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${closed ? "bg-slate-100 text-slate-400" : "bg-white/10"}`}>
                <tile.icon className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block font-bold leading-tight">{tile.label}</span>
                <span className={`mt-0.5 block text-xs ${closed ? "text-slate-400" : "text-white/70"}`}>{closed ? "Soon" : tile.hint}</span>
              </span>
            </>
          );
          return (
            <li key={tile.label}>
              {closed ? (
                <span className="flex h-full min-h-20 flex-col gap-2 rounded-2xl bg-white p-3 text-slate-500 ring-1 ring-slate-200/70 sm:flex-row sm:items-center sm:gap-3 sm:p-4">{body}</span>
              ) : (
                <Link href={tile.href} className="flex h-full min-h-20 flex-col gap-2 rounded-2xl bg-navy-900 p-3 text-white transition hover:bg-navy-800 sm:flex-row sm:items-center sm:gap-3 sm:p-4">
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {exchangeOpen ? (
        <Link href="/account/airtime" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-600 hover:underline">
          See the live airtime pool
        </Link>
      ) : null}
    </div>
  );
}

/** The same four as cards on Home (`HomeActions`), with a longer line each. */
export const homeCards = [
  { ...tiles[0], tile: "bg-sky-400", text: "Top up any number in your country. We find the network for you." },
  { ...tiles[1], tile: "bg-teal-400", text: "Data bundles for any number, delivered in moments." },
  { ...tiles[2], tile: "bg-amber-400", text: "Send airtime you will not use to our number and get wallet money for it." },
  { ...tiles[3], tile: "bg-violet-400", text: "Airtime other customers sold us, for less than its value, sent within the hour." },
];
