import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { StoreDesign, StoreHome } from "@bitocard/api-client/storefront";
import { type ApiResult, apiUrl, query } from "./api";
import { currentCustomer } from "./customer";
import { storeHeader, storeOriginHeader } from "./store-host";

/**
 * Resellers' stores in this app (docs/UDOZO_SPINOFF_PLAN.md, step 4): their pages live under `/store/<subdomain>`, which
 * only the proxy reaches, rewriting a store's own address there and naming the store in a request header (one a browser
 * sent is removed first). udozo.com never serves them.
 */

/** A store as the API describes it (`GET /v1/storefronts/:subdomain`). */
export type Storefront = {
  object: "storefront";
  name: string;
  subdomain: string;
  branding: { logo_url: string | null; primary_color: string | null; accent_color: string | null };
  design: StoreDesign | null;
  country: string | null;
  currency: string | null;
  checkout_mode: "test" | "live";
  house: boolean;
  white_label: boolean;
  domain: string | null;
};

/** The store this request is for (its subdomain), as the proxy named it; null on udozo.com. */
export const currentStoreKey = cache(async (): Promise<string | null> => (await headers()).get(storeHeader));

/** The store's own origin (its sandbox subdomain, or the domain it was reached on), as the proxy worked it out. */
export const storeOrigin = cache(async (): Promise<string | null> => (await headers()).get(storeOriginHeader));

/** GET a public store endpoint, cached for a minute (`no-store` for previews). Never throws: unreachable is status 0. */
async function get<T>(path: string, store: string, fresh = false): Promise<ApiResult<T>> {
  try {
    const res = await fetch(apiUrl(path), fresh ? { cache: "no-store" } : { next: { revalidate: 60, tags: [`store:${store}`] } });
    if (res.ok) return { ok: true, data: (await res.json()) as T };
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    return { ok: false, status: res.status, code: body?.error?.code ?? null };
  } catch {
    return { ok: false, status: 0, code: null };
  }
}

export const storefront = cache((subdomain: string) => get<Storefront>(`/v1/storefronts/${encodeURIComponent(subdomain)}`, subdomain));

/**
 * The store a page under `/store/[store]` is for: the proxy's store and the address's must agree (only the proxy reaches
 * these pages, but a page never trusts its address alone). Not open: not found.
 */
export async function requireStore(param: string): Promise<Storefront> {
  const key = await currentStoreKey();
  if (!key || key !== param) notFound();
  const result = await storefront(key);
  if (!result.ok) notFound();
  return result.data;
}

/** GET a store's public resale read (`/v1/store/resale/…`), naming the store. */
export async function storeApi<T>(store: string, path: string, params: Record<string, string | number | undefined | null> = {}) {
  return get<T>(`${path}${query({ ...params, store })}`, store);
}

/** The store's home page: what its owner published in Seller HQ (the draft with a preview link's token), its sections filled in. */
export const storeHome = (store: string, preview?: string | null) => (preview ? get<StoreHome>(`/v1/store/resale/home${query({ store, preview })}`, store, true) : storeApi<StoreHome>(store, "/v1/store/resale/home"));

/** A store's page for its signed-in shopper: the store, or sign in first (through udozo.com) and come back to `path`. */
export async function requireShopper(param: string, path: string) {
  const store = await requireStore(param);
  if (!(await currentCustomer())) redirect(`/signin?next=${encodeURIComponent(path)}`);
  return store;
}
