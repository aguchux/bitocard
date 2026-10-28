import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import type { CryptoBook, CryptoMarket, CryptoMarkets, CryptoTrader } from "@bitocard/api-client/crypto";
import { globalMarket } from "@afrippa/ui/market";
import { signatureFor } from "./signing";

/**
 * The API, read on Afrippa's server only (its pages never call it from the browser). `API_URL` wins, then the public
 * API address, then production on Vercel and the local API (port 3001) in development.
 */
export function apiUrl(path: string) {
  const base = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? (process.env.VERCEL ? "https://api.bitocard.com" : "http://localhost:3001");
  return `${base.replace(/\/+$/, "")}${path}`;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string | null };

/** How long the public data is kept: a minute, as the API says (`Cache-Control: public, max-age=60`). */
export const revalidate = 60;

/** An answer that is not cached (a refusal, or the API unreachable): thrown out of the cache, then returned. */
class Uncached extends Error {
  constructor(readonly result: ApiResult<never>) {
    super("uncached");
  }
}

/** One signed GET of a public Afrippa route, never cached by `fetch` itself (its signature changes every second). */
async function signedGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { cache: "no-store", headers: { accept: "application/json", ...signatureFor("GET", path) } });
  } catch {
    throw new Uncached({ ok: false, status: 0, code: null });
  }
  if (res.ok) return (await res.json()) as T;
  const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
  throw new Uncached({ ok: false, status: res.status, code: body?.error?.code ?? null });
}

/**
 * GET a public Afrippa endpoint (`/v1/afrippa/markets`, `/v1/afrippa/traders`), signed by this server, through Next's
 * cache: kept a minute and tagged, so every page and every small component asking the same thing shares one answer
 * across requests (`afrippa`, plus the tags given, can be revalidated on demand). Only answers are kept, never a refusal
 * or an unreachable API. Never throws: an unreachable API comes back as status 0, so each part of a page degrades on its
 * own (including during builds) instead of failing the page.
 */
export async function publicApi<T>(path: string, tags: string[] = []): Promise<ApiResult<T>> {
  try {
    const data = await unstable_cache(() => signedGet<T>(path), ["afrippa-public", path], { revalidate, tags: ["afrippa", ...tags] })();
    return { ok: true, data };
  } catch (error) {
    if (error instanceof Uncached) return error.result;
    return { ok: false, status: 0, code: null };
  }
}

// The readers below are wrapped in React's `cache()`: within one request, the header, the page and its small parts each
// call them freely and the API is asked once; across requests, `publicApi`'s data cache answers.

const noMarkets: CryptoMarkets = { object: "list", mode: "live", assets: [], data: [] };

/** The markets Afrippa shows now (empty while the API is unreachable). */
export const markets = cache(async (): Promise<CryptoMarkets> => {
  const result = await publicApi<CryptoMarkets>("/v1/afrippa/markets", ["afrippa:markets"]);
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
  publicApi<CryptoBook>(`/v1/afrippa/markets/${market}/ads?${query}`, [`afrippa:book:${market}`]),
);

/** The countries a trader can sign up in (its markets), by name; empty while the API is unreachable. */
export const countries = cache(async (): Promise<Array<{ code: string; name: string }>> => {
  const result = await publicApi<{ data: Array<{ code: string; name: string }> }>("/v1/countries", ["afrippa:countries"]);
  return result.ok ? result.data.data.map(({ code, name }) => ({ code, name })) : [];
});

/** A trader's public card by nickname, or null. */
export const trader = cache(async (nickname: string): Promise<CryptoTrader | null> => {
  if (!/^[A-Za-z0-9_]{3,20}$/.test(nickname)) return null;
  const result = await publicApi<CryptoTrader>(`/v1/afrippa/traders/${nickname}`, [`afrippa:trader:${nickname.toLowerCase()}`]);
  return result.ok ? result.data : null;
});
