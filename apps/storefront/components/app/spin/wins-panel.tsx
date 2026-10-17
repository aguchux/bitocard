"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, History } from "lucide-react";
import { formatCrypto, type StoreSpinWin } from "@bitocard/api-client/storefront";
import { usd, winsPage } from "@/lib/spin";
import { CoinToken } from "./coin-token";
import styles from "./spin.module.css";

const winDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/**
 * The customer's wins, newest first, six at a time with Newer and Older to page through the rest (the API sends every
 * win, at most 100). A new win takes the list back to the first page, where it shows at the top.
 */
export function WinsPanel({ wins }: { wins: StoreSpinWin[] }) {
  const [page, setPage] = useState(0);
  // A new win: back to the newest page (adjusted while rendering, so the old page never flashes).
  const [newest, setNewest] = useState(wins[0]?.id);
  if (wins[0]?.id !== newest) {
    setNewest(wins[0]?.id);
    setPage(0);
  }
  const { pages, current, start, end } = winsPage(wins.length, page);
  const shown = wins.slice(start, end);

  return (
    <section aria-labelledby="wins" className={`${styles.panel} p-5 sm:p-6`}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 id="wins" className="flex items-center gap-2 text-lg font-bold">
          <History className="size-5 text-gold-400" aria-hidden="true" />
          Your wins
        </h2>
        {wins.length ? <span className="text-xs font-semibold text-white/50 tabular-nums">{wins.length} in all</span> : null}
      </div>
      {wins.length ? (
        <>
          {/* Keyed by page, so each page fades in; tall enough for a full page, so the buttons stay put. */}
          <ul key={current} className={`divide-y divide-white/10 ${styles.pageIn} ${pages > 1 ? "min-h-[24.5rem]" : ""}`}>
            {shown.map(item => (
              <li key={item.id} className="flex items-center gap-3 py-3">
                <CoinToken asset={item.asset} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{formatCrypto(item.amount, item.asset)}</span>
                  <span className="block truncate text-sm text-white/55" suppressHydrationWarning>
                    Spin {item.number} · {winDate(item.created_at)}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-emerald-400/10 px-2.5 py-1 text-sm font-bold text-emerald-300 tabular-nums ring-1 ring-emerald-400/25">+{usd(item.usd)}</span>
              </li>
            ))}
          </ul>
          {pages > 1 ? (
            <nav aria-label="Pages of wins" className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
              <p className="text-sm text-white/60 tabular-nums" aria-live="polite">
                {start + 1}–{end} of {wins.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(current - 1)}
                  disabled={current === 0}
                  title="Newer wins"
                  className="inline-flex min-h-10 items-center gap-1 rounded-full bg-white/10 pr-3.5 pl-2.5 text-sm font-semibold transition-colors hover:bg-white/20 disabled:opacity-35 disabled:hover:bg-white/10"
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                  Newer
                </button>
                <button
                  type="button"
                  onClick={() => setPage(current + 1)}
                  disabled={current >= pages - 1}
                  title="Older wins"
                  className="inline-flex min-h-10 items-center gap-1 rounded-full bg-white/10 pr-2.5 pl-3.5 text-sm font-semibold transition-colors hover:bg-white/20 disabled:opacity-35 disabled:hover:bg-white/10"
                >
                  Older
                  <ChevronRight className="size-4" aria-hidden="true" />
                </button>
              </div>
            </nav>
          ) : null}
        </>
      ) : (
        <p className="text-white/65">Your wins show here.</p>
      )}
    </section>
  );
}
