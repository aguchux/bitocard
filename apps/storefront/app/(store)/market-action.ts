"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { marketCookie } from "@/lib/market";

/**
 * Remembers the shopper's market for a year (a country, or `global`), then refreshes the store for it — unless that
 * market has its own live country store (`docs/BITOCARD_COUNTRY_STORES_PLAN.md`), in which case the shopper is sent
 * there instead and no cookie is set (the subdomain fixes the market on its own). `storeSubdomain` comes from the
 * already-fetched country list the dialog showed; it is re-validated here (never trusted blind) before building a
 * redirect, and only ever produces a `*.bitocard.com` address.
 */
export async function chooseMarket(market: string, storeSubdomain?: string | null) {
  const value = market === "global" ? "global" : /^[A-Za-z]{2}$/.test(market) ? market.toUpperCase() : null;
  if (!value) return;
  if (value !== "global" && storeSubdomain && /^[a-z0-9-]{1,30}$/.test(storeSubdomain)) redirect(`https://${storeSubdomain}.bitocard.com`);
  (await cookies()).set(marketCookie, value, { maxAge: 60 * 60 * 24 * 365, path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  revalidatePath("/", "layout");
}
