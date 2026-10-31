import { Prisma } from '../generated/prisma/client.js';
import { ProviderError, providerRequest } from '../payments/provider-error.js';
import type { TransferResult } from '../payments/providers.js';
import { pawapayCountry, pawapayOutcome, payoutId } from '../suppliers/pawapay.adapter.js';

const Decimal = Prisma.Decimal;

/** The mobile money network a phone number is on, as the payout provider names it. */
export type MobileNetwork = { code: string; name: string; wholeUnits: boolean };

/** Withdrawals to a mobile money wallet: pawaPay live, simulated in the sandbox. */
export interface MobileMoneyPayouts {
  readonly name: string;
  /** The network a phone (E.164) is on, if payouts to it are open in that currency; null otherwise. */
  network(phone: string, country: string, currency: string): Promise<MobileNetwork | null>;
  send(input: { reference: string; phone: string; network: string; amount: bigint; currency: string }): Promise<TransferResult>;
  status(reference: string): Promise<TransferResult>;
}

type Operation = { operationType?: string; status?: string; decimalsInAmount?: string };
type ActiveConf = {
  countries?: Array<{
    country: string;
    providers?: Array<{ provider: string; displayName?: string; currencies?: Array<{ currency: string; operationTypes?: Operation[] | Record<string, Operation> }> }>;
  }>;
};

const payoutOperation = (types: Operation[] | Record<string, Operation> | undefined) =>
  Array.isArray(types) ? types.find(item => item.operationType === 'PAYOUT') : types?.PAYOUT;

/**
 * pawaPay payouts from BitoCard's prefunded pawaPay wallet. The phone's network is predicted by pawaPay and must be
 * open for payouts in the currency (its active configuration). The payout ID is made from our reference, so a repeat
 * is ignored as a duplicate and a check always finds the same payout.
 */
export class PawapayPayouts implements MobileMoneyPayouts {
  readonly name = 'pawapay';

  constructor(
    private readonly token: string,
    private readonly baseUrl: string,
  ) {}

  private call<T>(path: string, init: { method?: string; body?: unknown } = {}) {
    const token = this.token.trim().replace(/^bearer\s+/i, '');
    return providerRequest<T>(this.name, `${this.baseUrl.replace(/\/+$/, '')}${path}`, { ...init, headers: { authorization: `Bearer ${token}` } });
  }

  async network(phone: string, country: string, currency: string): Promise<MobileNetwork | null> {
    const three = pawapayCountry(country);
    if (!three) return null;
    const predicted = await this.call<{ country?: string; provider?: string }>('/v2/predict-provider', { method: 'POST', body: { phoneNumber: phone.replace(/^\+/, '') } });
    if (!predicted.provider || predicted.country !== three) return null;
    const conf = await this.call<ActiveConf>('/v2/active-conf?operationType=PAYOUT');
    const provider = conf.countries?.find(item => item.country === three)?.providers?.find(item => item.provider === predicted.provider);
    const operation = payoutOperation(provider?.currencies?.find(item => item.currency === currency)?.operationTypes);
    if (!provider || !operation || operation.status === 'CLOSED') return null;
    return { code: provider.provider, name: provider.displayName || provider.provider, wholeUnits: operation.decimalsInAmount === 'NONE' };
  }

  async send(input: { reference: string; phone: string; network: string; amount: bigint; currency: string }): Promise<TransferResult> {
    const amount = new Decimal(input.amount.toString()).div(100);
    const res = await this.call<{ status: string; failureReason?: { failureCode?: string; failureMessage?: string } }>('/v2/payouts', {
      method: 'POST',
      body: {
        payoutId: payoutId(input.reference),
        amount: amount.toFixed(2).replace(/\.?0+$/, ''),
        currency: input.currency,
        recipient: { type: 'MMO', accountDetails: { phoneNumber: input.phone.replace(/^\+/, ''), provider: input.network } },
        clientReferenceId: input.reference,
      },
    });
    // Refused before anything was sent: a clear failure, so the amount goes back to earnings.
    if (res.status === 'REJECTED') throw new ProviderError(this.name, `${res.failureReason?.failureCode ?? 'REJECTED'}: ${res.failureReason?.failureMessage ?? 'payout rejected'}`, true);
    return this.status(input.reference).catch(() => ({ status: 'pending' as const, providerTransferId: payoutId(input.reference), fee: 0n }));
  }

  async status(reference: string): Promise<TransferResult> {
    const id = payoutId(reference);
    const res = await this.call<{ status: string; data?: { status?: string; failureReason?: { failureCode?: string; failureMessage?: string } } }>(`/v2/payouts/${id}`);
    // Not found is not failed: the request may still arrive.
    if (res.status !== 'FOUND' || !res.data) return { status: 'pending', providerTransferId: id, fee: 0n, reference };
    const outcome = pawapayOutcome(res.data.status);
    return {
      status: outcome === 'completed' ? 'paid' : outcome,
      providerTransferId: id,
      fee: 0n,
      reference,
      ...(outcome === 'failed' ? { failureReason: res.data.failureReason?.failureMessage || 'The mobile money provider refused the payout.' } : {}),
    };
  }
}

/** The sandbox network: any phone; the outcome is set with the payout's simulate endpoint. */
export class SandboxMobileMoney implements MobileMoneyPayouts {
  readonly name = 'sandbox';

  async network() {
    return { code: 'SANDBOX_MOMO', name: 'Sandbox mobile money', wholeUnits: false };
  }

  async send(input: { reference: string }): Promise<TransferResult> {
    return { status: 'pending', providerTransferId: `sandbox_${input.reference}`, fee: 0n };
  }

  async status(reference: string): Promise<TransferResult> {
    return { status: 'pending', providerTransferId: `sandbox_${reference}`, fee: 0n, reference };
  }
}

/**
 * The fee taken out of a withdrawal of `amount`, at pawaPay's payout fee (`percent`, charged on what is sent): what is
 * sent is the most whose cost (sent plus the fee on it, rounded up) stays within the amount, in whole units where the
 * network takes no decimals. Null when nothing would be left to send.
 */
export function mobileMoneySplit(amount: bigint, percent: string, wholeUnits: boolean) {
  const rate = new Decimal(percent).div(100);
  let sent = BigInt(new Decimal(amount.toString()).div(rate.plus(1)).floor().toFixed(0));
  const cost = (value: bigint) => value + BigInt(new Decimal(value.toString()).mul(rate).ceil().toFixed(0));
  while (sent > 0n && cost(sent) > amount) sent -= 1n;
  if (wholeUnits) sent -= sent % 100n;
  if (sent <= 0n) return null;
  return { sent, fee: amount - sent };
}
