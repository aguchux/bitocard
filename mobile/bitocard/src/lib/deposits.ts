/**
 * What a bank deposit says to its customer, and the filters of the list of every deposit (bitocard.com's Deposits).
 * Free of React Native, so it runs under `node --test`.
 */
import type { BankDeposit } from './types.ts';

export const depositStatusWords: Record<BankDeposit['status'], string> = {
  awaiting_payment: 'Waiting for your payment',
  sent: 'Being checked by our team',
  credited: 'Added to your wallet',
  rejected: 'Not credited',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/** The list's filters, as `show=` asks the API for them (`all` asks for none). */
export const depositFilters = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'In progress' },
  { key: 'credited', label: 'Added' },
  { key: 'rejected', label: 'Not credited' },
  { key: 'done', label: 'Ended' },
] as const;

export type DepositFilter = (typeof depositFilters)[number]['key'];

/** The list's address for a filter and the page after `after`. */
export function depositsPath(show: DepositFilter, after?: string) {
  const query = new URLSearchParams({ limit: '20' });
  if (show !== 'all') query.set('show', show);
  if (after) query.set('starting_after', after);
  return `/v1/store/wallet/bank-deposits?${query}`;
}
