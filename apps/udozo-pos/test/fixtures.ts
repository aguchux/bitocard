import type { PosAccount, PosPlan } from "@/lib/pos";

const limits = { free: { products: 50, shops: 1, tills: 2, staff: 3 }, premium: { products: null, shops: 1, tills: null, staff: null }, multi_shop: { products: null, shops: 10, tills: null, staff: null } } as const;

/** A plan as the API presents it in Nigeria: Free, Premium at ₦15,000 with a 14-day trial, Multi-shop at ₦40,000. */
export function plan(code: PosPlan["code"], over: Partial<PosPlan> = {}): PosPlan {
  const price = { free: null, premium: { amount: 1_500_000, currency: "NGN" }, multi_shop: { amount: 4_000_000, currency: "NGN" } }[code];
  return {
    object: "pos_plan",
    code,
    name: { free: "Free", premium: "Premium", multi_shop: "Multi-shop" }[code],
    description: null,
    price,
    available: true,
    paid: code !== "free",
    limits: { ...limits[code] },
    trial_days: code === "premium" ? 14 : 0,
    ...over,
  };
}

export const plans = () => [plan("multi_shop"), plan("free"), plan("premium")];

/** An owner's account on Free with one shop and one till, unless overridden. */
export function account(over: Partial<PosAccount> = {}): PosAccount {
  return {
    object: "pos_account",
    id: "0b7f1c52-3a3c-4f7e-9c58-2b9b3c8d1e01",
    country: "NG",
    currency: "NGN",
    mode: "live",
    status: "free",
    plan: plan("free"),
    next_plan: null,
    trial_ends_at: null,
    period_start: null,
    period_end: null,
    past_due_since: null,
    drops_to_free_at: null,
    lapsed_plan: null,
    limits: { ...limits.free },
    shops: [
      {
        object: "pos_shop",
        id: "5e0d2a1b-9c8f-4d3e-8b7a-6f5e4d3c2b1a",
        name: "Ada's Gadget Hub",
        address: null,
        phone: null,
        tin: null,
        shop_code: "ADA-4821",
        vat_bps: 750,
        receipt_footer: null,
      kind: { code: "general", name: "General shop", categories: [] },
        tills: [{ object: "pos_till", id: "7c6b5a49-3827-4e1d-9c0b-a1b2c3d4e5f6", name: "Till 1", printer_width: 80, auto_print: false }],
      },
    ],
    created_at: "2026-11-11T08:00:00.000Z",
    ...over,
  };
}
