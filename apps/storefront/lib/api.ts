import "server-only";
import { storeSubdomain } from "./store";

/**
 * The BitoCard API, read on the server only (the store never calls it from the browser). `API_URL` wins, then the
 * public API address the console apps use, then production on Vercel and the local API (port 3001) in development.
 */
export function apiUrl(path: string) {
  const base = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? (process.env.VERCEL ? "https://api.bitocard.com" : "http://localhost:3001");
  return `${base.replace(/\/+$/, "")}${path}`;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string | null };

/**
 * GET a public `/v1/store` endpoint. Cached for a minute (the API sends the same), or not at all for previews. Never
 * throws: an unreachable API comes back as status 0, so pages degrade instead of failing (including during builds). On
 * a reseller's store the store is named in the query, so each store's answers are cached apart.
 */
export async function storeApi<T>(path: string, options: { fresh?: boolean } = {}): Promise<ApiResult<T>> {
  const store = await storeSubdomain();
  const url = store ? `${path}${path.includes("?") ? "&" : "?"}store=${encodeURIComponent(store)}` : path;
  try {
    const res = await fetch(apiUrl(url), options.fresh ? { cache: "no-store" } : { next: { revalidate: 60, tags: ["store"] } });
    if (res.ok) return { ok: true, data: (await res.json()) as T };
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    return { ok: false, status: res.status, code: body?.error?.code ?? null };
  } catch {
    return { ok: false, status: 0, code: null };
  }
}

/** Query string from defined values only. */
export function query(values: Record<string, string | number | undefined | null>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
}
