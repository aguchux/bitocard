/**
 * Money in the app (phase 3): what the reader of a UdozoPay order can do next and what it says, what a checkout
 * charges for each way of handing over, a shop till's payment link, and when a money step keeps its Idempotency-Key.
 * The same rules as udozo.com (apps/udozo/lib/shop.ts `orderActions`, `orderNext`; components/safe-pay.tsx), kept free
 * of React Native so they run under `node --test`. The API checks everything again.
 */
import type { ShopFulfilment, ShopListingPage, ShopOrder, ShopSafePayQuote, ShopViewer } from '../shared/classifieds';

// ---- Money steps ----

/**
 * Whether a money step's Idempotency-Key is kept for the next tap. A refusal (any 4xx) is final, so the next try is a
 * new request with a new key; no answer, or the API failing (5xx), may have gone through, so the next tap sends the
 * same key and can never pay twice.
 */
export function keepKey(error: unknown) {
  const status = (error as { status?: number } | null)?.status;
  return typeof status !== 'number' || status === 0 || status >= 500;
}

/** What is still to add to the wallet before paying `total`, in minor units (0 when it covers it, or unknown). */
export const walletShort = (balance: number | null | undefined, total: number) => (balance === null || balance === undefined ? 0 : Math.max(0, total - balance));

// ---- UdozoPay orders ----

export type OrderAction = 'accept' | 'decline' | 'pay' | 'release_code' | 'enter_code' | 'sent' | 'delivered' | 'received' | 'cancel' | 'dispute' | 'pay_storage';

type OrderView = Pick<ShopOrder, 'role' | 'status' | 'fulfilment'> & { shipment?: ShopOrder['shipment']; connect?: ShopOrder['connect'] };

/**
 * What the reader of an order can do now, as udozo.com offers it: the seller accepts, enters the buyer's code at a
 * meet-up, marks it sent and delivered; the buyer pays, shows their release code, confirms a delivery, disputes; either
 * cancels before the hand-over. A buyer owing storage at a Connect Centre pays it before the centre takes their code.
 */
export function orderActions(order: OrderView): OrderAction[] {
  const buyer = order.role === 'buyer';
  const storage = buyer && (order.connect?.storage_owed ?? 0) > 0 ? (['pay_storage'] as OrderAction[]) : [];
  switch (order.status) {
    case 'requested':
    case 'locked':
      return buyer ? ['cancel'] : ['accept', 'decline'];
    case 'awaiting_payment':
      return buyer ? ['pay', 'cancel'] : ['cancel'];
    case 'paid':
      if (order.fulfilment === 'meet_up') return buyer ? ['release_code', 'cancel', 'dispute'] : ['enter_code', 'cancel'];
      if (order.fulfilment === 'connect') return buyer ? ['release_code', 'cancel', 'dispute'] : ['sent', 'cancel'];
      return buyer ? ['cancel', 'dispute'] : ['sent', 'cancel'];
    case 'sent':
      // At a Connect Centre the centre hands it over: the buyer never confirms it at home, nor the seller its delivery.
      if (order.fulfilment === 'connect') return buyer ? [...storage, 'release_code', 'dispute'] : [];
      return buyer ? ['received', 'dispute'] : order.shipment?.delivered_at ? [] : ['delivered'];
    case 'at_centre':
      return buyer ? [...storage, 'release_code', 'dispute'] : [];
    default:
      return [];
  }
}

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** The line under an order's status: what the reader does next, or what happened (udozo.com's words). */
export function orderNext(order: Pick<ShopOrder, 'role' | 'status' | 'fulfilment' | 'deadlines' | 'with'> & { connect?: ShopOrder['connect'] }) {
  const buyer = order.role === 'buyer';
  const centre = order.connect?.centre.name ?? 'the Connect Centre';
  const by = (iso: string | null) => (iso ? ` by ${when(iso)}` : '');
  if (order.fulfilment === 'connect') {
    if (order.status === 'paid') return buyer ? `Paid. ${order.with.name} sends it to ${centre}${by(order.deadlines.handover_by)}.` : `Photograph it and the sealed parcel, get it to ${centre}${by(order.deadlines.handover_by)} and mark it sent.`;
    if (order.status === 'sent') return buyer ? `On its way to ${centre}. We will tell you when it is ready.` : `On its way to ${centre}. You are paid once ${order.with.name} collects it.`;
    if (order.status === 'at_centre') {
      if (!order.connect?.ready_at) return buyer ? `At ${centre}: being checked in and shelved.` : `${centre} received it.`;
      return buyer
        ? `Ready at ${centre}. Inspect it at the counter, then give your release code${order.connect.collect_by ? `; free to collect until ${when(order.connect.collect_by)}` : ''}.`
        : `Ready at ${centre}: waiting for ${order.with.name} to collect it.`;
    }
  }
  switch (order.status) {
    case 'requested':
      return buyer ? `Waiting for ${order.with.name} to accept, by ${when(order.deadlines.accept_by)}.` : `Accept or decline by ${when(order.deadlines.accept_by)}, or it lapses.`;
    case 'locked':
      return buyer ? `Paid: your money is locked until ${order.with.name} confirms, by ${when(order.deadlines.accept_by)}.` : `Paid and waiting: accept or decline by ${when(order.deadlines.accept_by)}. Letting it lapse counts against you.`;
    case 'awaiting_payment':
      return buyer ? `Accepted. Pay from your wallet${by(order.deadlines.pay_by)}.` : `Waiting for ${order.with.name} to pay.`;
    case 'paid':
      if (order.fulfilment === 'meet_up') return buyer ? `Meet ${order.with.name}, check it, then give your release code.` : `Meet ${order.with.name} and enter their release code.`;
      return buyer ? `Paid. ${order.with.name} ships it${by(order.deadlines.handover_by)}.` : `Photograph it and the sealed parcel, ship it with tracking${by(order.deadlines.handover_by)}, and mark it shipped.`;
    case 'at_centre':
      return buyer ? `At ${centre}.` : `At ${centre}: waiting for the buyer.`;
    case 'sent':
      return buyer
        ? `On its way. Confirm when it arrives in good condition${order.deadlines.confirm_by ? `, or it releases on ${when(order.deadlines.confirm_by)}` : ''}.`
        : `Shipped. You are paid once ${order.with.name} confirms${order.deadlines.confirm_by ? `, or on ${when(order.deadlines.confirm_by)}` : ''}.`;
    case 'disputed':
      return 'Udozo is looking at both sides and will decide.';
    case 'released':
      return buyer ? 'Complete.' : 'Paid to you: withdrawable after the payout hold.';
    case 'refunded':
      return buyer ? 'Refunded to your wallet.' : 'The buyer was refunded.';
    case 'partly_refunded':
      return buyer ? 'Part refunded to your wallet.' : 'Part refunded; the rest paid to you.';
    case 'declined':
      return buyer ? 'The seller declined. You can still chat with them.' : 'You declined this request.';
    case 'lapsed':
      return 'Closed: not answered or paid in time.';
    case 'cancelled':
      return 'Cancelled. Nothing was charged, or it was refunded in full.';
  }
}

/** Whether a status is still going (the order list's first group; the screen keeps it fresh). */
export const orderOpen = (status: ShopOrder['status']) => ['requested', 'locked', 'awaiting_payment', 'paid', 'sent', 'at_centre', 'disputed'].includes(status);

// ---- Checkout ----

/**
 * The listing's Buy with UdozoPay button, from what the buyer already has with it (udozo.com's `buyButton`): carry on
 * their order, or start one where UdozoPay is open and there is a price and stock. None for the seller, a sold or
 * reserved item, or an auction (bid on udozo.com).
 */
export function buyAction(
  listing: Pick<ShopListingPage, 'status' | 'reserved' | 'price'> & Partial<Pick<ShopListingPage, 'in_stock' | 'sale_method'>>,
  viewer: Pick<ShopViewer, 'own' | 'order'> | null,
  safePayOpen: boolean,
): { kind: 'order'; id: string; label: string } | { kind: 'checkout'; label: string } | null {
  if (listing.status !== 'active' || viewer?.own) return null;
  if (viewer?.order) return { kind: 'order', id: viewer.order.id, label: `Continue order ${viewer.order.number}` };
  if (listing.sale_method === 'auction' || !safePayOpen) return null;
  if (listing.in_stock === false || listing.reserved) return null;
  if (listing.price.kind === 'on_request' || listing.price.amount === null) return null;
  return { kind: 'checkout', label: 'Buy with UdozoPay' };
}

/** The buyer's choice at checkout: how it is handed over, and where. */
export type CheckoutChoice = {
  fulfilment: ShopFulfilment;
  /** Delivery: within the seller's state, or elsewhere in the country. */
  zone?: 'state' | 'elsewhere';
  address?: string;
  /** Connect: the state chosen, then the centre in it. */
  connectStateId?: string;
  centreId?: string;
};

/** What a choice adds to the quote's total: the delivery or shipping charge and the Connect fee. */
export function checkoutCharges(quote: Pick<ShopSafePayQuote, 'total' | 'delivery' | 'connect'>, choice: CheckoutChoice) {
  let delivery = 0;
  let connectFee = 0;
  if (choice.fulfilment === 'delivery' && quote.delivery) {
    delivery = choice.zone === 'elsewhere' && quote.delivery.nationwide !== null ? quote.delivery.nationwide : quote.delivery.within_state;
  }
  if (choice.fulfilment === 'connect' && quote.connect) {
    const state = quote.connect.states.find(item => item.id === choice.connectStateId);
    delivery = state?.shipping ?? 0;
    connectFee = state?.connect_fee ?? 0;
  }
  return { delivery, connectFee, total: quote.total + delivery + connectFee };
}

/** What the choice still needs before it can be sent, or null when it is ready. */
export function checkoutProblem(quote: Pick<ShopSafePayQuote, 'fulfilment' | 'connect'>, choice: CheckoutChoice) {
  if (!quote.fulfilment.includes(choice.fulfilment)) return 'Choose how you get it.';
  if (choice.fulfilment === 'delivery' && (choice.address ?? '').trim().length < 10) return 'Write the delivery address in full.';
  if (choice.fulfilment === 'connect') {
    const state = quote.connect?.states.find(item => item.id === choice.connectStateId);
    if (!state) return 'Choose the state you collect it in.';
    if (!state.centres.some(centre => centre.id === choice.centreId)) return 'Choose the Connect Centre you collect it from.';
  }
  return null;
}

/** `POST /v1/classifieds/orders`'s body for a choice (only what the way it is handed over needs). */
export function checkoutBody(quote: Pick<ShopSafePayQuote, 'listing_id' | 'offer_id' | 'delivery'>, choice: CheckoutChoice) {
  const body: Record<string, string> = { listing_id: quote.listing_id, fulfilment: choice.fulfilment };
  if (quote.offer_id) body.offer_id = quote.offer_id;
  if (choice.fulfilment === 'delivery') {
    body.delivery_address = (choice.address ?? '').trim().slice(0, 500);
    if (choice.zone !== 'elsewhere' && quote.delivery?.state_id) body.delivery_state_id = quote.delivery.state_id;
  }
  if (choice.fulfilment === 'connect' && choice.centreId) body.connect_centre_id = choice.centreId;
  return body;
}

/** How long a buyer may collect free, in words ("3 days", "36 hours"). */
export const freeTime = (hours: number) => (hours >= 48 && hours % 24 === 0 ? `${hours / 24} days` : `${hours} hours`);

/** Why a checkout cannot open, in the buyer's words (by the API's refusal code), else the API's own message. */
export const checkoutUnavailable: Record<string, string> = {
  safe_pay_unavailable: 'UdozoPay is not open here yet. You can still chat with the seller.',
  price_required: 'This listing has no price: agree one by offer in the chat first, then buy at that price.',
  offer_not_accepted: 'Use an offer the seller accepted in the last 7 days.',
  listing_reserved: 'Someone has already paid for this with UdozoPay.',
  auction_not_won: 'This is sold by auction: bid on it on udozo.com, and pay if your bid wins.',
  out_of_stock: 'This is out of stock: the seller has none to sell right now. Chat with them to ask when more come in.',
  safe_pay_limited: 'This seller cannot take UdozoPay orders right now. You can still chat with them.',
  own_listing: 'This is your own listing.',
};

// ---- Paying a shop's till ----

/** A Udozo POS till's payment link token, as the till makes it. */
export const payToken = /^pw_[A-Za-z0-9_-]{32}$/;

/** The token in what was scanned or opened: `https://udozo.com/pay/<token>`, `udozo://pay/<token>` or the token alone. */
export function scannedPayToken(text: string) {
  const value = text.trim();
  if (payToken.test(value)) return value;
  const match = /^(?:https?:\/\/(?:www\.)?udozo\.com|udozo:\/)\/pay\/([^/?#\s]+)\/?(?:[?#].*)?$/i.exec(value);
  return match && payToken.test(match[1]) ? match[1] : null;
}

export type PosWalletPayment = {
  object: 'pos_wallet_payment';
  number: string;
  status: 'waiting' | 'paid' | 'declined' | 'cancelled' | 'expired';
  shop: { name: string };
  currency: string;
  /** What the wallet pays, in minor units; the rest of the sale (`total`) was paid at the counter. */
  amount: number;
  total: number;
  items: { title: string; quantity: number }[];
  own_shop: boolean;
  expires_at: string;
  paid_at: string | null;
};

/** What the screen says once the request is no longer waiting, or null while it is. */
export function posPayOutcome(payment: Pick<PosWalletPayment, 'status' | 'shop'>) {
  switch (payment.status) {
    case 'paid':
      return `Paid. Show this to ${payment.shop.name}: the sale is done.`;
    case 'declined':
      return 'You declined this payment. Nothing was taken.';
    case 'cancelled':
      return 'The shop cancelled this payment. Nothing was taken.';
    case 'expired':
      return 'This payment request ran out of time. Nothing was taken: ask the shop for a new one.';
    default:
      return null;
  }
}

/** Seconds left before a request runs out (never below 0). */
export const secondsLeft = (expiresAt: string, now: number) => Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));

/** "4:05" for a countdown. */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
