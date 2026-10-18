"use server";

import { refresh } from "next/cache";
import type { StoreVpn } from "@bitocard/api-client/storefront";
import { accessApi, accessToken } from "@/lib/access";
import { customerApi } from "@/lib/customer";

/** Where VPN access is managed from: the customer's own checkout (signed in) or its order link (with their proof). */
export type VpnSource = { checkout: string } | { token: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VpnResetResult = { ok: true; username: string; password: string } | { ok: false; error: string };

/**
 * A new VPN password, returned once to show the customer (it also replaces the one on the order). An unclear reset
 * answers with a message to try again: the same reset continues.
 */
export async function resetVpnPassword(source: VpnSource): Promise<VpnResetResult> {
  type Reset = { vpn_subscription: StoreVpn; credentials: { username: string; password: string } };
  let result;
  if ("checkout" in source) {
    if (!uuid.test(source.checkout)) return { ok: false, error: "This order was not found." };
    result = await customerApi<Reset>("POST", `/v1/store/checkouts/${source.checkout}/vpn/password-reset`, {});
  } else {
    if (!accessToken.test(source.token)) return { ok: false, error: "This link is not valid." };
    result = await accessApi<Reset>(source.token, "/vpn/password-reset", {});
    if (!result.ok && result.status === 401) return { ok: false, error: "Your access has ended. Reload the page to confirm it is you again." };
  }
  if (!result.ok) return { ok: false, error: result.message };
  refresh();
  return { ok: true, username: result.data.credentials.username, password: result.data.credentials.password };
}
