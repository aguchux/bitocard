"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { marketCookie } from "@/lib/market";

/**
 * Remembers the shopper's market for a year (a country, or `global`), then refreshes the store for it. A preference
 * cookie the shopper sets themselves: listed in the cookie notice, read only by bitocard.com's server.
 */
export async function chooseMarket(market: string) {
  const value = market === "global" ? "global" : /^[A-Za-z]{2}$/.test(market) ? market.toUpperCase() : null;
  if (!value) return;
  (await cookies()).set(marketCookie, value, { maxAge: 60 * 60 * 24 * 365, path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  revalidatePath("/", "layout");
}
