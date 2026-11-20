/**
 * What a reported problem says to its customer, as bitocard.com says it (`apps/storefront/lib/disputes.ts`). Free of
 * React Native, so it runs under `node --test`.
 */
import type { Dispute } from './types.ts';

/** Where a dispute stands, in the customer's words, and its tone. */
export function disputeStatus(dispute: Pick<Dispute, 'status' | 'outcome'>): { label: string; tone: 'warn' | 'good' | 'neutral' } {
  if (dispute.status === 'open') return { label: 'Being looked at', tone: 'warn' };
  if (dispute.status === 'escalated') return { label: 'With BitoCard', tone: 'warn' };
  if (dispute.outcome === 'refunded_customer') return { label: 'Refunded', tone: 'good' };
  if (dispute.outcome === 'rejected') return { label: 'Closed', tone: 'neutral' };
  return { label: 'Resolved', tone: 'good' };
}

/** Still being looked at: the customer can write more. */
export const disputeOpen = (dispute: Pick<Dispute, 'status'>) => dispute.status === 'open' || dispute.status === 'escalated';

/** Orders a customer can report a problem with: anything past the payment page. */
export const canDispute = (status: string) => status !== 'awaiting_payment';
