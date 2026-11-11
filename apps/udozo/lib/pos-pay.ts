/**
 * Paying a shop's Udozo POS till from the Udozo wallet (docs/UDOZO_POS_PLAN.md): the link the till's QR code opens, or
 * the notice the shop sent to the buyer's mobile number. Shapes and words, pure for the page and its tests.
 */

export type PosWalletPayment = {
  object: "pos_wallet_payment";
  number: string;
  status: "waiting" | "paid" | "declined" | "cancelled" | "expired";
  shop: { name: string };
  currency: string;
  /** What the wallet pays, in minor units; the rest of the sale (`total`) was paid at the counter. */
  amount: number;
  total: number;
  items: Array<{ title: string; quantity: number }>;
  own_shop: boolean;
  expires_at: string;
  paid_at: string | null;
};

/** The link's token as the till made it; anything else is never sent to the API. */
export const posPayToken = /^pw_[A-Za-z0-9_-]{32}$/;

/** What the page says once the request is no longer waiting, or null while it is. */
export function posPayOutcome(payment: Pick<PosWalletPayment, "status" | "shop">) {
  switch (payment.status) {
    case "paid":
      return `Paid. Show this to ${payment.shop.name}: the sale is done.`;
    case "declined":
      return "You declined this payment. Nothing was taken.";
    case "cancelled":
      return "The shop cancelled this payment. Nothing was taken.";
    case "expired":
      return "This payment request ran out of time. Nothing was taken: ask the shop for a new one.";
    default:
      return null;
  }
}
