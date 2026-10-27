import "server-only";
import { cache } from "react";
import type { CryptoBook, CryptoMarket, CryptoMarkets, CryptoTrader } from "@bitocard/api-client/crypto";
import { globalMarket } from "@bitocard/crypto-ui/market";

/**
 * The BitoCard API, read on the server only (BitoCard Crypto's public pages never call it from the browser). `API_URL`
 * wins, then the public API address, then production on Vercel and the local API (port 3001) in development.
 */
export function apiUrl(path: string) {
  const base = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? (process.env.VERCEL ? "https://api.bitocard.com" : "http://localhost:3001");
  return `${base.replace(/\/+$/, "")}${path}`;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string | null };

/** How long the public data is kept: a minute, as the API says (`Cache-Control: public, max-age=60`). */
export const revalidate = 60;

/**
 * GET a public Afrippa endpoint (`/v1/afrippa/markets`, `/v1/afrippa/traders`) through Next's data cache: kept a minute and tagged, so every page and every small
 * component asking the same thing shares one answer across requests (`crypto`, plus the tags given, can be revalidated
 * on demand). Never throws: an unreachable API comes back as status 0, so each part of a page degrades on its own
 * (including during builds) instead of failing the page.
 */
export async function cryptoApi<T>(path: string, tags: string[] = []): Promise<ApiResult<T>> {
  try {
    const res = await fetch(apiUrl(path), { next: { revalidate, tags: ["crypto", ...tags] } });
    if (res.ok) return { ok: true, data: (await res.json()) as T };
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    return { ok: false, status: res.status, code: body?.error?.code ?? null };
  } catch {
    return { ok: false, status: 0, code: null };
  }
}

// The readers below are wrapped in React's `cache()`: within one request, the header, the page and its small parts each
// call them freely and the API is asked once; across requests, `cryptoApi`'s data cache answers.

const noMarkets: CryptoMarkets = { object: "list", mode: "live", assets: [], data: [] };

/** The markets BitoCard Crypto shows now (empty while the API is unreachable). */
export const markets = cache(async (): Promise<CryptoMarkets> => {
  const result = await cryptoApi<CryptoMarkets>("/v1/afrippa/markets", ["crypto:markets"]);
  return result.ok ? result.data : noMarkets;
});

/** The address segment a market lives at: `/` for the global market, `/ng` for a country. */
export const marketPath = (market: string) => (market === globalMarket ? "/" : `/${market.toLowerCase()}`);

/** The market shown at an address: `null` (the root) is the global market, `ng` Nigeria's; only shown markets. */
export async function marketAt(segment: string | null): Promise<CryptoMarket | null> {
  if (segment !== null && !/^[a-z]{2}$/.test(segment)) return null;
  const code = segment === null ? globalMarket : segment.toUpperCase();
  if (code === globalMarket && segment !== null) return null;
  return (await markets()).data.find(market => market.market === code) ?? null;
}

export type BookQuery = { asset: string; side: "buy" | "sell"; currency: string; q?: string; fiat?: number | null };

/** A book's query string, in one order, so the same book is always the same cache key. */
export const bookQuery = (query: BookQuery) =>
  new URLSearchParams({ asset: query.asset, side: query.side, currency: query.currency, ...(query.q ? { q: query.q } : {}), ...(query.fiat ? { fiat: String(query.fiat) } : {}) }).toString();

/**
 * A market's book for a coin, side and currency, tagged per market so one market's can be refreshed alone. Its query is
 * a string (`bookQuery`): `cache()` compares arguments by identity, so an object would never be shared.
 */
export const book = cache(async (market: string, query: string): Promise<ApiResult<CryptoBook>> =>
  cryptoApi<CryptoBook>(`/v1/afrippa/markets/${market}/ads?${query}`, [`crypto:book:${market}`]),
);

/** A trader's public card by nickname, or null. */
export const trader = cache(async (nickname: string): Promise<CryptoTrader | null> => {
  if (!/^[A-Za-z0-9_]{3,20}$/.test(nickname)) return null;
  const result = await cryptoApi<CryptoTrader>(`/v1/afrippa/traders/${nickname}`, [`crypto:trader:${nickname.toLowerCase()}`]);
  return result.ok ? result.data : null;
});
