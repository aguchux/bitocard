/**
 * The airtime exchange: what a rate means, how a typed amount is checked against a network's limits, what each sale
 * and purchase status says, and a number written as people read it. Free of React Native, so it runs under `node --test`.
 */
import { digitsOf, formatMoney } from './money.ts';
import type { AirtimeNetwork, AirtimePurchase, AirtimeSale } from './types.ts';

/** `8000` basis points is `80%`; `8250` is `82.5%`. */
export const rateText = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

/** A typed amount in whole units (the exchange takes no kobo), within the network's limits; else why not. */
export function tradeAmount(text: string, network: Pick<AirtimeNetwork, 'min_amount' | 'max_amount'>, currency: string): { amount: number } | { problem: string } {
  const cleaned = text.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(cleaned) || Number(cleaned) === 0) return { problem: 'Enter a whole amount, with no kobo.' };
  const amount = Number(cleaned) * 10 ** digitsOf(currency);
  if (amount < network.min_amount || amount > network.max_amount) {
    return { problem: `Choose between ${formatMoney(network.min_amount, currency, { cents: false })} and ${formatMoney(network.max_amount, currency, { cents: false })}.` };
  }
  return { amount };
}

type Tone = 'good' | 'warn' | 'bad';

const saleWords: Record<AirtimeSale['status'], { label: string; tone: Tone }> = {
  awaiting_transfer: { label: 'Send the airtime', tone: 'warn' },
  sent: { label: 'Being checked', tone: 'warn' },
  received: { label: 'Received: paid after the hold', tone: 'good' },
  credited: { label: 'Paid to your wallet', tone: 'good' },
  expired: { label: 'Time ran out', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
  not_received: { label: 'Not received', tone: 'bad' },
  reversed: { label: 'Reversed by the network', tone: 'bad' },
};

const purchaseWords: Record<AirtimePurchase['status'], { label: string; tone: Tone }> = {
  paid: { label: 'Waiting to be sent', tone: 'warn' },
  delivering: { label: 'Being sent', tone: 'warn' },
  delivered: { label: 'Sent to your number', tone: 'good' },
  refunded: { label: 'Refunded to your wallet', tone: 'bad' },
};

export const saleStatusOf = (status: AirtimeSale['status']) => saleWords[status] ?? { label: status, tone: 'warn' as const };
export const purchaseStatusOf = (status: AirtimePurchase['status']) => purchaseWords[status] ?? { label: status, tone: 'warn' as const };

/** Still moving, so its page asks again. A received sale waits for its hold, which takes hours, not seconds. */
export const saleMoving = (status: AirtimeSale['status']) => status === 'awaiting_transfer' || status === 'sent';
export const purchaseMoving = (status: AirtimePurchase['status']) => status === 'paid' || status === 'delivering';

/** `+2348061234567` as Nigerians write it, `0806 123 4567`; any other number as it came. */
export function localNumber(phone: string) {
  const match = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return match ? `0${match[1]} ${match[2]} ${match[3]}` : phone;
}

/** The time left before `until`, in words (`12 min`, `1 h 5 min`); null once it has passed. */
export function timeLeft(until: string, now = Date.now()) {
  const minutes = Math.ceil((new Date(until).getTime() - now) / 60_000);
  if (minutes <= 0) return null;
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}

/** The phone's dialler address for a transfer code: `#` must be written `%23`, or the dialler stops at it. */
export const dialUrl = (steps: string) => `tel:${steps.replace(/\s/g, '').replaceAll('#', '%23')}`;

/** Whether the network's transfer steps are a code to dial (`*600*…#`) rather than words to follow. */
export const isDialCode = (steps: string) => /^[*#][\d*#A-Z]*#$/.test(steps.replace(/\s/g, ''));
