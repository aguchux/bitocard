import type { StoreP2pAd } from "@bitocard/api-client/storefront";

/**
 * Afrippa's escrow orders and payment methods as the API presents them (`/v1/afrippa/p2p/orders`,
 * `/v1/afrippa/p2p/payment-methods`), with the words the pages use. Plain types and helpers: safe in client components.
 */

export type PaymentMethodKind = "bank" | "mobile_money" | "named";

/** A trader's own saved payment method: never its details, only the label and the last digits. */
export type PaymentMethod = {
  object: "p2p_payment_method";
  id: string;
  kind: PaymentMethodKind;
  currency: string;
  label: string;
  hint: string;
  holder_name: string;
  /** Payments through it can be taken back by the payer after release (PayPal). */
  reversible: boolean;
  /** Usable 24 hours after it was added. */
  usable: boolean;
  usable_from: string;
  created_at: string;
};

/** A payment method as an ad lists it: its id (a taker names one), never its details; the hint for its owner only. */
export type AdPaymentMethod = { id: string; kind: PaymentMethodKind; label: string; currency: string; reversible: boolean; hint?: string };

/** An ad with what escrow adds: the payment window and where the buyer pays. */
export type EscrowAd = StoreP2pAd & { payment_window: number; payment_methods: AdPaymentMethod[]; fee_locked: string | null };

export type OrderStatus = "pending_payment" | "paid" | "appealed" | "released" | "cancelled" | "returned";

/** What an order on an ad would be, before it is opened. */
export type OrderPreview = {
  object: "p2p_order_preview";
  asset: string;
  currency: string;
  price: number;
  amount: string;
  fiat: number;
  buyer_fee: string;
  seller_fee: string;
  received: string;
  payment_window: number;
};

export type Order = {
  object: "p2p_order";
  id: string;
  number: string;
  mode: "live" | "test";
  ad_id: string;
  market: string;
  asset: string;
  decimals: number;
  currency: string;
  /** From the viewer's side: buy (they receive the coins) or sell. */
  side: "buy" | "sell";
  status: OrderStatus;
  price: number;
  amount: string;
  fiat: number;
  buyer_fee: string;
  seller_fee: string;
  received: string;
  escrow: string;
  payment_window: number;
  pay_by: string;
  buyer: { nickname: string };
  seller: { nickname: string };
  /** The seller's account the buyer pays into; its details only while the order is open. */
  payment_method: { kind: PaymentMethodKind; label: string; currency: string; hint: string; holder_name: string; details: Record<string, string | null> | null };
  /** The payment must come from an account in this name (the buyer's own). */
  payer_name: string;
  paid_from: { kind: PaymentMethodKind; label: string; hint: string; holder_name: string } | null;
  warnings: string[];
  paid_at: string | null;
  appealed_at: string | null;
  appealed_by: "buyer" | "seller" | null;
  appeal_reason: string | null;
  closed_at: string | null;
  cancel_reason: string | null;
  decision: { fault: "buyer" | "seller" | "none"; note: string | null } | null;
  /** The viewer rated the other party already (null in lists). */
  feedback_given: boolean | null;
  created_at: string;
  updated_at: string;
};

export type OrderMessage = {
  object: "p2p_order_message";
  id: string;
  /** `you`, the other party (`buyer` or `seller`), Afrippa's team (`afrippa`) or the order's own lines (`system`). */
  from: "you" | "buyer" | "seller" | "afrippa" | "system";
  body: string | null;
  file: { name: string; content_type: string; size: number; width: number | null; height: number | null } | null;
  created_at: string;
};

export type OrderMessages = { object: "list"; order_id: string; open: boolean; data: OrderMessage[] };

/** The services a payment method can name (labels only: Afrippa never connects to them). */
export const namedServices: Array<[string, string]> = [
  ["wise", "Wise"],
  ["payoneer", "Payoneer"],
  ["paypal", "PayPal"],
  ["revolut", "Revolut"],
  ["skrill", "Skrill"],
  ["chipper_cash", "Chipper Cash"],
  ["grey", "Grey"],
];

export const kindNames: Record<PaymentMethodKind, string> = { bank: "Bank account", mobile_money: "Mobile money", named: "Payment service" };

/** The payment windows an ad can give buyers, in minutes. */
export const paymentWindows = [15, 30, 60] as const;

/** How an order's status reads, from the viewer's side, with a tone for its badge. */
export function statusText(order: Pick<Order, "status" | "side" | "cancel_reason">): [string, "wait" | "act" | "done" | "closed" | "alert"] {
  switch (order.status) {
    case "pending_payment":
      return order.side === "buy" ? ["Pay the seller", "act"] : ["Waiting for payment", "wait"];
    case "paid":
      return order.side === "sell" ? ["Check and release", "act"] : ["Waiting for release", "wait"];
    case "appealed":
      return ["In appeal", "alert"];
    case "released":
      return ["Completed", "done"];
    case "returned":
      return ["Returned to the seller", "closed"];
    default:
      return [order.cancel_reason === "expired" ? "Expired" : "Cancelled", "closed"];
  }
}

export const openStatuses: OrderStatus[] = ["pending_payment", "paid", "appealed"];

/** The names of a payment method's details, in the order they are shown. */
export const detailNames: Record<string, string> = {
  bank_name: "Bank",
  bank_code: "Bank code",
  account_number: "Account number",
  network: "Network",
  phone: "Mobile number",
  provider: "Service",
  handle: "Paid at",
};

/** The details worth showing (no kind, nothing empty), named; a named service's code reads as its name. */
export function shownDetails(details: Record<string, string | null>) {
  return Object.entries(details)
    .filter(([key, value]) => key !== "kind" && value)
    .map(([key, value]) => [detailNames[key] ?? key, key === "provider" ? (namedServices.find(([code]) => code === value)?.[1] ?? value!) : value!] as const);
}

/** The rail a payment travels on: any bank to any bank, a network or service only to the same one (the API's rule). */
export const railOf = (method: { kind: PaymentMethodKind; label: string }) => (method.kind === "bank" ? "bank" : `${method.kind}:${method.label.toLowerCase()}`);

/** Why a trader is reported, in the API's codes. */
export const reportReasons: Array<[string, string]> = [
  ["fraud", "Fraud or a scam"],
  ["fake_payment", "Said they paid but did not"],
  ["third_party_payment", "Paid from someone else's account"],
  ["off_platform", "Asked to trade off Afrippa"],
  ["abuse", "Abusive or threatening"],
  ["other", "Something else"],
];
