import "server-only";
import { cache } from "react";
import { ownerPermissions, type PermissionSet, type PosApprover, type PosDeviceInfo, type PosDeviceRow, type PosRoles, type PosShop, type PosStaffList, type PosStaffMe } from "./pos";
import type { PosApps, PosCatalogue, PosCharge, PosFlaggedSale, PosOfflineHeld, PosCollections, PosCollectionsOverview, PosCustomer, PosCustomers, PosOwner, PosCurrentShift, PosDay, PosOverview, PosPlans, PosReceipts, PosSale, PosSales, PosShift, PosShifts, PosSettlement, PosSettlements, PosShopKind } from "./pos";
import { actorKind } from "./pos-api";
import { type ApiResult, currentCustomer, customerApi, deviceApi, staffApi } from "./session";
import { posApi } from "./pos-api";
import { apiUrl } from "./site";

/** A public read, kept a minute; never throws (null when the API cannot answer). */
async function publicRead<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(apiUrl(path), { headers: { accept: "application/json" }, next: { revalidate: 60 } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The plans as a market sees them (priced in its currency), or unpriced without one. */
export const publicPlans = (country?: string | null) => publicRead<PosPlans>(`/v1/pos/plans${country && /^[A-Z]{2}$/.test(country) ? `?country=${country}` : ""}`);

/**
 * Which market's prices the public pages show: the signed-in owner's own country (fixed on their account), else the
 * `?country=` asked for, else Nigeria, Udozo's first market.
 */
export function marketFor(customerCountry: string | null | undefined, asked?: string | string[]) {
  const query = typeof asked === "string" ? asked.toUpperCase() : "";
  return customerCountry ?? (/^[A-Z]{2}$/.test(query) ? query : "NG");
}

/** Where each app's button goes; every one Coming soon when the API cannot say. */
export async function posApps(): Promise<PosApps> {
  return (await publicRead<PosApps>("/v1/pos/apps")) ?? { object: "pos_apps", android: null, ios: null, windows: null };
}

/** The kinds of shop the till is tailored to (General shop alone when the API cannot say). */
export async function shopKinds(): Promise<PosShopKind[]> {
  return (await publicRead<{ data: PosShopKind[] }>("/v1/pos/shop-kinds"))?.data ?? [{ code: "general", name: "General shop", categories: [] }];
}

/** The signed-in owner's place: POS open in their country, their wallet, the plans and their account (or none yet). */
export const currentOwner = cache((): Promise<ApiResult<PosOwner>> => customerApi<PosOwner>("GET", "/v1/pos/owner"));

/** The listings ticked Sell at POS, read live from udozo.com (`query` from `catalogueQuery`). */
export const ownerCatalogue = (query = "") => posApi<PosCatalogue>("GET", `/catalogue${query}`);

/** How many products the till reads a call, and the most calls (20,000 products). */
export const tillPage = 1000;
const tillPages = 20;

/**
 * Every product at the till, read page by page (a shop is never cut off at one page), the summary and categories from
 * the first. Fails as the first page fails; a later page that fails stops there with what was read.
 */
export async function tillCatalogue(shopId?: string): Promise<ApiResult<PosCatalogue>> {
  // With several shops, what this till's shop can sell.
  const shop = shopId && /^[0-9a-f-]{36}$/i.test(shopId) ? `&shop=${shopId}` : "";
  const first = await ownerCatalogue(`?show=all&limit=${tillPage}&offset=0${shop}`);
  if (!first.ok) return first;
  const data = [...first.data.data];
  let more = first.data.has_more;
  for (let page = 1; more && page < tillPages; page += 1) {
    const next = await ownerCatalogue(`?show=all&limit=${tillPage}&offset=${page * tillPage}${shop}`);
    if (!next.ok) break;
    data.push(...next.data.data);
    more = next.data.has_more;
  }
  return { ok: true, data: { ...first.data, data, has_more: more } };
}

/** Every charge for the plan, newest first. */
export const ownerCharges = () => customerApi<{ object: "list"; data: PosCharge[] }>("GET", "/v1/pos/owner/charges");

/** The owner's sales, newest first, with the filter's takings (`query` from `salesQuery`). */
export const ownerSales = (query = "") => posApi<PosSales>("GET", `/sales${query}`);

/** One sale with its lines and payments. */
export const ownerSale = (id: string) => posApi<PosSale>("GET", `/sales/${id}`);
/** A sale's receipts: how they can go, the printed QR code, the shop and what was sent (milestone 6). */
export const saleReceipts = (id: string) => posApi<PosReceipts>("GET", `/sales/${id}/receipts`);

/** The shop's customers (`query` from `customersQuery`), and one with its sales and what it owes. */
export const ownerCustomers = (query = "") => posApi<PosCustomers>("GET", `/customers${query}`);
export const ownerCustomer = (id: string) => posApi<PosCustomer>("GET", `/customers/${id}`);

/** The owner's collection accounts: whether they may open one, where collections are paid, each till's account. */
export const ownerCollections = cache(() => customerApi<PosCollectionsOverview>("GET", "/v1/pos/owner/collections"));
/** Transfers into them, newest first (`status`: matched, unmatched or kept). */
export const ownerCollectionTransfers = (status?: string) => posApi<PosCollections>("GET", `/collections/transfers?limit=50${status && /^[a-z]+$/.test(status) ? `&status=${status}` : ""}`);
export const ownerSettlements = () => customerApi<PosSettlements>("GET", "/v1/pos/owner/collections/settlements?limit=30");
export const ownerSettlement = (id: string) => customerApi<PosSettlement>("GET", `/v1/pos/owner/collections/settlements/${id}`);

// ---- Who is at the till (milestone 5) ----

/** The signed-in member of staff's role, permissions and the tills they may use. */
export const staffMe = cache(() => staffApi<PosStaffMe>("GET", "/v1/pos/staff"));

/**
 * Whoever is signed in, as the till's pages need them: the owner (every permission) or a member of staff (their
 * role's, at their tills), the shops they may sell in, and who may approve what they may not do alone.
 */
export type PosView = {
  actor: "owner" | "staff";
  /** A member of staff whose PIN is from before PINs were 6 digits (they choose a new one first). */
  pinChangeRequired?: boolean;
  staffId?: string;
  name: string;
  role: string;
  permissions: PermissionSet;
  /** The most discount without a manager, in basis points (null: any amount). */
  discountLimit: number | null;
  currency: string;
  country: string;
  walletPayments: boolean;
  collections: boolean;
  shops: PosShop[];
  /** A linked till's own till (staff signed in on it). */
  tillId: string | null;
  /** Staff: the tills with an open Udozo collection account. */
  transferTills: string[];
  approvers: PosApprover[];
  planName: string;
};

export const currentPos = cache(async (): Promise<ApiResult<PosView>> => {
  if ((await actorKind()) === "staff") {
    const me = await staffMe();
    if (!me.ok) return me;
    return {
      ok: true,
      data: {
        actor: "staff",
        name: me.data.staff.name,
        role: me.data.role.name,
        permissions: me.data.permissions,
        discountLimit: me.data.role.discount_limit_bps,
        currency: me.data.currency,
        country: me.data.country,
        walletPayments: me.data.wallet_payments,
        collections: me.data.collections,
        shops: me.data.account.shops,
        tillId: me.data.till_id,
        transferTills: me.data.transfer_accounts.map(item => item.till_id),
        approvers: me.data.approvers,
        planName: me.data.account.plan.name,
        pinChangeRequired: Boolean(me.data.pin_change_required),
        staffId: me.data.staff.id,
      },
    };
  }
  const [owner, customer] = await Promise.all([currentOwner(), currentCustomer()]);
  if (!owner.ok) return owner;
  return {
    ok: true,
    data: {
      actor: "owner",
      name: customer?.name ?? "Owner",
      role: "Owner",
      permissions: ownerPermissions,
      discountLimit: null,
      currency: owner.data.currency,
      country: owner.data.country,
      walletPayments: owner.data.wallet_payments === true,
      collections: owner.data.collections === true,
      shops: owner.data.account?.shops ?? [],
      tillId: null,
      transferTills: [],
      approvers: [],
      planName: owner.data.account?.plan.name ?? "Free",
    },
  };
});

/** The owner's staff, or (a manager) the cashiers they manage. */
export const posStaff = async () => ((await actorKind()) === "staff" ? staffApi<PosStaffList>("GET", "/v1/pos/staff/staff") : customerApi<PosStaffList>("GET", "/v1/pos/owner/staff"));
/** The fixed roles and the owner's own, with the matrix's words. */
export const ownerRoles = () => customerApi<PosRoles>("GET", "/v1/pos/owner/roles");
/** The tills' linked devices. */
export const ownerDevices = () => customerApi<{ object: "list"; data: PosDeviceRow[] }>("GET", "/v1/pos/owner/devices");
/** This browser as a linked till: its shop, till and the name tiles. */
export const linkedDevice = () => deviceApi<PosDeviceInfo>("GET", "/v1/pos/device");

/** Offline sales with something to look at (milestone 9), and an unlinked device's sales waiting for the owner. */
export const offlineFlagged = (resolved = false) => posApi<{ object: "list"; total: number; has_more: boolean; data: PosFlaggedSale[] }>("GET", `/offline/flagged?limit=50${resolved ? "&resolved=true" : ""}`);
export const offlineHeld = () => customerApi<{ object: "list"; currency: string; data: PosOfflineHeld[] }>("GET", "/v1/pos/owner/offline/held");

// ---- Shifts, the overview and reports (milestone 7), as the owner or the member of staff at the till ----

const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  return search.size ? `?${search}` : "";
};

/** The overview: a period's takings in the shop and online, by the hour or the day, and what needs restocking. */
export const posOverview = (params: { period?: string; from?: string; to?: string; shop?: string }) => posApi<PosOverview>("GET", `/reports/overview${query(params)}`);
/** End of day for a date (the shop's today without one). */
export const posDay = (params: { date?: string; shop?: string }) => posApi<PosDay>("GET", `/reports/day${query(params)}`);
/** A till's open shift, if any. */
export const currentShift = (tillId: string) => posApi<PosCurrentShift>("GET", `/shifts/current?till_id=${encodeURIComponent(tillId)}`);
export const posShifts = (params: { status?: string; till?: string; limit?: string; offset?: string } = {}) => posApi<PosShifts>("GET", `/shifts${query(params)}`);
export const posShift = (id: string) => posApi<PosShift>("GET", `/shifts/${id}`);
