import "server-only";
import { cache } from "react";
import type { ShopMarket, ShopMarkets } from "@bitocard/api-client/classifieds";

/**
 * The BitoCard API, read on the server only (the Shop never calls it from the browser). `API_URL` wins, then the public
 * API address, then production on Vercel and the local API (port 3001) in development.
 */
export function apiUrl(path: string) {
  const base = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? (process.env.VERCEL ? "https://api.bitocard.com" : "http://localhost:3001");
  return `${base.replace(/\/+$/, "")}${path}`;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string | null };

/**
 * GET a public `/v1/classifieds` endpoint, cached for a minute (the API says the same). Never throws: an unreachable API
 * comes back as status 0, so pages degrade instead of failing (including during builds).
 */
export async function shopApi<T>(path: string, options: { revalidate?: number } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(apiUrl(path), { next: { revalidate: options.revalidate ?? 60, tags: ["shop"] } });
    if (res.ok) return { ok: true, data: (await res.json()) as T };
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    return { ok: false, status: res.status, code: body?.error?.code ?? null };
  } catch {
    return { ok: false, status: 0, code: null };
  }
}

/** Query string from defined values only; arrays repeat their key (`f=a&f=b`). */
export function query(values: Record<string, string | number | undefined | null | string[]>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) for (const item of value) params.append(key, item);
    else if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** The countries BitoCard Shop is open in. Asked once per request; empty while the API is unreachable. */
export const markets = cache(async (): Promise<ShopMarkets> => {
  const result = await shopApi<ShopMarkets>("/v1/classifieds/markets");
  return result.ok ? result.data : { object: "list", data: [], showcase: false };
});

/** The open market an address names (`ng`), or null: only lower-case two-letter codes, as every address writes them. */
export async function marketFor(cc: string): Promise<ShopMarket | null> {
  if (!/^[a-z]{2}$/.test(cc)) return null;
  return (await markets()).data.find(market => market.country === cc.toUpperCase()) ?? null;
}
