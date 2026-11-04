"use server";

import { revalidatePath } from "next/cache";
import { type CustomerResult, customerApi } from "@/lib/customer";

/**
 * Account > Privacy: what discovery remembers about a signed-in customer, and their say over it. Every change answers
 * plainly whether it worked; the page is read again afterwards.
 */

export type PrivacyResult = { ok: true } | { ok: false; message: string };

const page = "/account/privacy";
const done = (result: CustomerResult<unknown>): PrivacyResult => {
  if (result.ok) {
    revalidatePath(page);
    return { ok: true };
  }
  return { ok: false, message: result.status === 401 ? "Sign in again to carry on." : result.message };
};

/** Personalise what I see: on starts recording again; off stops it and deletes what was kept. */
export async function setPersonalisation(enabled: boolean): Promise<PrivacyResult> {
  if (typeof enabled !== "boolean") return { ok: false, message: "Choose on or off." };
  return done(await customerApi("PUT", "/v1/classifieds/me/personalisation", { enabled }));
}

/** Takes one listing out of Recently viewed. */
export async function removeViewed(ref: number): Promise<PrivacyResult> {
  if (!Number.isSafeInteger(ref) || ref <= 0) return { ok: false, message: "No such listing." };
  return done(await customerApi("DELETE", `/v1/classifieds/history/listings/${ref}`));
}

/** Takes one search out of Recent searches. */
export async function removeSearch(query: string): Promise<PrivacyResult> {
  const q = typeof query === "string" ? query.trim().slice(0, 100) : "";
  if (!q) return { ok: false, message: "No such search." };
  return done(await customerApi("DELETE", `/v1/classifieds/history/searches?q=${encodeURIComponent(q)}`));
}

/** Clear my history: every listing viewed, search and what Udozo learned from them. */
export async function clearHistory(): Promise<PrivacyResult> {
  return done(await customerApi("DELETE", "/v1/classifieds/history"));
}
