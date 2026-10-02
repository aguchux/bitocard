import { randomInt } from 'node:crypto';
import { ProviderError } from './provider-error';
import type { CheckoutProvider, ReservedAccountProvider, TransferProvider, TransferResult } from './providers';

/** Account number the sandbox refuses to resolve, so integrations can test the failure. */
export const sandboxUnknownAccount = '0000000000';

export const sandboxBanks = [
  { code: 'SBX001', name: 'Sandbox Bank' },
  { code: 'SBX002', name: 'Sandbox Microfinance Bank' },
];

/**
 * Test mode: never calls a real provider or moves real money. Payments, deposits and payouts stay pending until
 * the reseller simulates the outcome through the API.
 */
export class SandboxProvider implements CheckoutProvider, ReservedAccountProvider, TransferProvider {
  readonly name = 'sandbox';

  constructor(private readonly checkoutBaseUrl: string) {}

  supportsCheckout() {
    return true;
  }

  async createCheckout(input: { reference: string }) {
    return { checkoutUrl: `${this.checkoutBaseUrl}/sandbox/checkout/${encodeURIComponent(input.reference)}` };
  }

  async verifyByReference() {
    return null;
  }

  supportsReservedAccounts() {
    return true;
  }

  async createReservedAccount(input: { name: string }) {
    return [{ bankName: 'Sandbox Bank', accountNumber: `99${randomInt(10_000_000, 99_999_999)}`, accountName: input.name }];
  }

  supportsTransfers() {
    return true;
  }

  async listBanks() {
    return sandboxBanks;
  }

  async resolveAccount(input: { bankCode: string; accountNumber: string }) {
    if (input.accountNumber === sandboxUnknownAccount || !sandboxBanks.some(bank => bank.code === input.bankCode)) {
      throw new ProviderError(this.name, 'account not found', true, 400);
    }
    return { accountName: 'SANDBOX ACCOUNT HOLDER' };
  }

  async transfer(input: { reference: string }): Promise<TransferResult> {
    return { status: 'pending', providerTransferId: `sandbox_${input.reference}`, fee: 0n };
  }

  async transferStatus(providerTransferId: string): Promise<TransferResult> {
    return { status: 'pending', providerTransferId, fee: 0n };
  }
}
