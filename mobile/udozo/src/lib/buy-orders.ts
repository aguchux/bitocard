/**
 * Buy orders in the app (docs/UDOZO_RATINGS_PLAN.md phase 0): what happens next on each, the question asked before each
 * step, and the step's route, in udozo.com's words (apps/udozo/lib/buy-orders.ts, lib/buy-order-actions.ts). Payment
 * is between buyer and seller when they meet. Kept free of React Native so they run under `node --test`.
 */
import type { ShopBuyOrder, ShopBuyOrderAction } from '../shared/classifieds';

import { money } from './format.ts';

const date = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'Africa/Lagos' });

/** One line under an order: what happens next, and by when. */
export function buyOrderNext(order: Pick<ShopBuyOrder, 'status' | 'role' | 'respond_by' | 'meet_by' | 'bought_at' | 'completes_at' | 'void_until' | 'with'>) {
  const seller = order.role === 'seller';
  switch (order.status) {
    case 'requested':
      return seller ? `Accept, offer another price or decline${order.respond_by ? ` by ${date(order.respond_by)}` : ''}.` : `Waiting for ${order.with.name} to answer.`;
    case 'countered':
      return seller ? `Waiting for ${order.with.name} to answer your price.` : `Accept their price or cancel${order.respond_by ? ` by ${date(order.respond_by)}` : ''}.`;
    case 'accepted':
      if (order.bought_at) return seller ? `${order.with.name} says they bought it: mark it sold to confirm.` : `Waiting for ${order.with.name} to confirm${order.completes_at ? `, or recorded by itself on ${date(order.completes_at)}` : ''}.`;
      return `Meet${order.meet_by ? ` by ${date(order.meet_by)}` : ''}: inspect it, then pay in person.${seller ? ' Mark it sold once they have bought it.' : ''}`;
    case 'completed':
      return order.void_until && !seller ? `Recorded. Did not buy it? Say so by ${date(order.void_until)}.` : 'Recorded on Udozo.';
    default:
      return 'Ended.';
  }
}

export type BuyQuestion = {
  title: string;
  body: string;
  action: string;
  tone: 'money' | 'danger' | 'primary';
  /** A reason box: optional, or required. */
  reason?: { label: string; required?: boolean };
  /** Counter asks for a price. */
  price?: boolean;
};

/** The question asked before a step (with a reason box or a price where one is asked). */
export function buyQuestion(action: ShopBuyOrderAction, order: Pick<ShopBuyOrder, 'price' | 'counter' | 'currency' | 'with' | 'listing'>): BuyQuestion {
  const amount = (minor: number) => money(minor, order.currency);
  const name = order.with.name;
  const title = order.listing.title ?? 'this';
  switch (action) {
    case 'accept':
      return { title: `Accept ${amount(order.price)}?`, body: `It is held for ${name} while you meet. Meet in a busy public place; they inspect it and pay you in person.`, action: `Accept ${amount(order.price)}`, tone: 'money' };
    case 'accept_counter':
      return { title: `Accept ${amount(order.counter ?? order.price)}?`, body: `${name} holds it for you while you meet. Inspect it before you pay, and never pay in advance.`, action: `Accept ${amount(order.counter ?? order.price)}`, tone: 'money' };
    case 'counter':
      return { title: 'Offer another price', body: `${name} can accept it or cancel.`, action: 'Send my price', tone: 'primary', price: true };
    case 'decline':
      return { title: 'Decline this buy order?', body: `${name} is told.`, action: 'Decline', tone: 'danger', reason: { label: 'Why (optional)' } };
    case 'cancel':
      return { title: 'Cancel the buy order?', body: `${name} is told, and ${title} is no longer held.`, action: 'Cancel the buy order', tone: 'danger', reason: { label: 'Why (optional)' } };
    case 'no_show':
      return { title: 'Say the sale did not happen?', body: 'The buy order ends. Udozo keeps a record when people do not turn up.', action: 'It did not happen', tone: 'danger', reason: { label: 'What happened (optional)' } };
    case 'extend':
      return { title: `Give ${name} more time?`, body: 'The buy order stays open, and the item held, for more days. You can do this once.', action: 'Give more time', tone: 'primary' };
    case 'bought':
      return { title: `Did you buy ${title}?`, body: `${name} is asked to confirm. If they say nothing, it is recorded as bought in 3 days.`, action: 'Yes, I bought it', tone: 'money' };
    case 'complete':
      return { title: `Mark ${title} sold to ${name}?`, body: 'Only once they have paid you and have the item. The sale is recorded on Udozo, and your stock goes down.', action: 'Mark sold', tone: 'money' };
    case 'confirm':
      return { title: `You bought ${title}?`, body: `Thanks. The sale stands, and you can rate ${name}. If something is wrong, you can still say you did not buy it within 7 days.`, action: 'Yes, I bought it', tone: 'money' };
    case 'void':
      return { title: 'You did not buy this?', body: `Udozo removes the sale from your record and tells ${name}. Marking sales that did not happen breaks Udozo's terms.`, action: 'I did not buy this', tone: 'danger', reason: { label: 'What happened', required: true } };
  }
}

/** The button that opens each step, in the reader's words. */
export const buyActionLabels: Record<ShopBuyOrderAction, string> = {
  accept: 'Accept',
  counter: 'Offer another price',
  decline: 'Decline',
  accept_counter: 'Accept their price',
  cancel: 'Cancel',
  no_show: 'It did not happen',
  complete: 'Mark sold',
  bought: 'I bought it',
  void: 'I did not buy this',
  confirm: 'Yes, I bought it',
  extend: 'Give more time',
};

/** The step's route: `POST /v1/classifieds/buy-orders/:id/<action, hyphenated>`. */
export const buyOrderPath = (id: string, action: ShopBuyOrderAction) => `/v1/classifieds/buy-orders/${id}/${action.replace(/_/g, '-')}`;

/** The step's body: the price for a counter, and a reason only when one was written (300 characters at most). */
export function buyOrderBody(action: ShopBuyOrderAction, input: { price?: number | null; reason?: string }) {
  const reason = input.reason?.trim() ? input.reason.trim().slice(0, 300) : undefined;
  return { ...(action === 'counter' && input.price ? { price: input.price } : {}), ...(reason ? { reason } : {}) };
}
