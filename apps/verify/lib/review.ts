import type { KycReviewEligibility, KycStatus } from "@bitocard/api-client/kyc";

/**
 * The review console calls the API from the browser with the reseller's session cookie (shared on .bitocard.com), like
 * SHQ. The API's address: NEXT_PUBLIC_API_URL, else production, or the local API when this app runs on localhost.
 */
export function reviewApiBase(configured = process.env.NEXT_PUBLIC_API_URL, hostname = typeof window === "undefined" ? "" : window.location.hostname) {
  const base = configured || (hostname === "localhost" || hostname === "127.0.0.1" ? "http://localhost:3001" : "https://api.bitocard.com");
  return base.replace(/\/+$/, "");
}

/** SHQ, where resellers sign in. */
export function shqBase(configured = process.env.NEXT_PUBLIC_SHQ_URL, hostname = typeof window === "undefined" ? "" : window.location.hostname) {
  const base = configured || (hostname === "localhost" || hostname === "127.0.0.1" ? "http://localhost:3004" : "https://shq.bitocard.com");
  return base.replace(/\/+$/, "");
}

/** SHQ's sign-in, coming back to this page afterwards (SHQ only returns to BitoCard's own apps). */
export const signInUrl = (shq: string, here: string) => `${shq}/signin?next=${encodeURIComponent(here)}`;

/** Why a reseller cannot review, in words; they never see a customer's documents then. */
export const ineligibleReasons: Record<NonNullable<KycReviewEligibility["reason"]>, { title: string; text: string }> = {
  not_registered: {
    title: "Only registered businesses review ID checks",
    text: "Your business is not registered, so BitoCard reviews your customers’ ID checks for you. Nothing is needed from you. To review them yourself, verify your business as a registered business in SHQ (Settings > Identity check).",
  },
  kyb_not_verified: {
    title: "Your business is not verified yet",
    text: "Once BitoCard has approved your registered business’s documents, you can review your customers’ ID checks here. Until then, BitoCard reviews them.",
  },
  not_active: {
    title: "Your account is not active",
    text: "Reviewing customers’ ID checks needs an active account. Until then, BitoCard reviews them. Check your account in SHQ.",
  },
  role: {
    title: "Ask the owner or an admin",
    text: "Only the owner and admins of a business can review its customers’ ID checks.",
  },
};

export function ineligible(eligibility: Pick<KycReviewEligibility, "eligible" | "reason">) {
  if (eligibility.eligible) return null;
  return ineligibleReasons[eligibility.reason ?? "not_registered"] ?? ineligibleReasons.not_registered;
}

export const queueTabs: Array<{ value: KycStatus; label: string }> = [
  { value: "submitted", label: "To review" },
  { value: "resubmit", label: "Asked to resubmit" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
];

/** The queue's status from the address (`?status=`), "To review" by default. */
export function queueStatus(value: string | null): KycStatus {
  return queueTabs.some(tab => tab.value === value) ? (value as KycStatus) : "submitted";
}

/** The list endpoint's address for a tab, a customer and a page. */
export function reviewListPath(filter: { status: KycStatus; customer?: string | null; after?: string | null; limit?: number }) {
  const params = new URLSearchParams({ status: filter.status, limit: String(filter.limit ?? 50) });
  if (filter.customer) params.set("customer_id", filter.customer);
  if (filter.after) params.set("starting_after", filter.after);
  return `/v1/kyc/reviews?${params}`;
}

/** Which reseller account to act for: the one chosen before, if the person still belongs to it, else their first. */
export function pickAccount(memberships: Array<{ reseller: { id: string } }>, remembered: string | null) {
  return memberships.find(item => item.reseller.id === remembered)?.reseller.id ?? memberships[0]?.reseller.id ?? null;
}

export type ReviewResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string | null; message: string };

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/**
 * One API call with the session cookie, the account (`BitoCard-Reseller`) and, on POST, a fresh Idempotency-Key.
 * Never throws.
 */
export async function reviewRequest<T>(path: string, options: { method?: "GET" | "POST"; body?: unknown; reseller?: string | null; base?: string } = {}): Promise<ReviewResult<T>> {
  const method = options.method ?? "GET";
  try {
    const res = await fetch(`${options.base ?? reviewApiBase()}${path}`, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(options.reseller ? { "bitocard-reseller": options.reseller } : {}),
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(method === "POST" ? { "idempotency-key": newKey() } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null;
    if (res.ok) return { ok: true, data: json as T };
    return { ok: false, status: res.status, code: json?.error?.code ?? null, message: json?.error?.message ?? "Something went wrong. Try again." };
  } catch {
    return { ok: false, status: 0, code: null, message: "Could not reach BitoCard. Check your connection and try again." };
  }
}

/** A document's file, read with the session and the account (an <img> could not send the account header). */
export async function fetchReviewDocument(url: string, reseller: string | null, base = reviewApiBase()): Promise<Blob> {
  const res = await fetch(`${base}${url}`, { credentials: "include", cache: "no-store", headers: reseller ? { "bitocard-reseller": reseller } : {} });
  if (!res.ok) throw new Error("Could not load this file.");
  return res.blob();
}
