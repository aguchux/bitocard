/**
 * What an order (a store checkout) says to its customer: its status in words, a tone, and its steps. Free of React
 * Native, so it runs under `node --test`.
 */
import type { Checkout, CheckoutStatus } from './types.ts';

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

const statusWords: Record<CheckoutStatus, { label: string; tone: Tone }> = {
  awaiting_payment: { label: 'Waiting for payment', tone: 'warn' },
  paid: { label: 'On its way', tone: 'warn' },
  completed: { label: 'Delivered', tone: 'good' },
  failed: { label: 'Not completed', tone: 'bad' },
  refund_pending: { label: 'Refunding', tone: 'warn' },
  refunded: { label: 'Refunded', tone: 'neutral' },
};

export const statusOf = (status: CheckoutStatus) => statusWords[status] ?? { label: status, tone: 'neutral' as Tone };

/** Still moving: the order page asks again every few seconds while this is true. */
export const inProgress = (status: CheckoutStatus) => status === 'awaiting_payment' || status === 'paid' || status === 'refund_pending';

export type Step = { label: string; state: 'done' | 'now' | 'todo' | 'failed' };

/** The order's timeline: paid, sent, delivered; or where it stopped and the refund. */
export function stepsOf(checkout: Pick<Checkout, 'status' | 'method'>): Step[] {
  const paidWith = checkout.method.id === 'wallet' ? 'Paid from your wallet' : `Paid by ${checkout.method.label}`;
  switch (checkout.status) {
    case 'awaiting_payment':
      return [{ label: 'Waiting for your payment', state: 'now' }, { label: 'Sent', state: 'todo' }, { label: 'Delivered', state: 'todo' }];
    case 'paid':
      return [{ label: paidWith, state: 'done' }, { label: 'Being sent', state: 'now' }, { label: 'Delivered', state: 'todo' }];
    case 'completed':
      return [{ label: paidWith, state: 'done' }, { label: 'Sent', state: 'done' }, { label: 'Delivered', state: 'done' }];
    case 'failed':
      return [{ label: 'Not paid, nothing was charged', state: 'failed' }];
    case 'refund_pending':
      return [{ label: paidWith, state: 'done' }, { label: 'Could not be delivered', state: 'failed' }, { label: 'Refund on its way', state: 'now' }];
    case 'refunded':
      return [{ label: paidWith, state: 'done' }, { label: 'Could not be delivered', state: 'failed' }, { label: 'Refunded in full', state: 'done' }];
  }
}

/** Who or what an order was for: the number topped up, else the email codes went to. */
export const recipientOf = (checkout: Pick<Checkout, 'recipient'>) => checkout.recipient?.phone ?? checkout.recipient?.account_number ?? checkout.recipient?.email ?? null;
