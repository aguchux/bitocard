import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { Encryption } from '../common/encryption.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import type { BankAccount, LedgerMode, Payout } from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { minor } from '../ledger/mode.js';
import { WalletService } from '../ledger/wallet.service.js';
import { EmailService } from '../notifications/email.service.js';
import { bankAccountAddedEmail, formatMoney, payoutFailedEmail, payoutPaidEmail } from '../notifications/templates.js';
import { PaymentProviders } from '../payments/payment-providers.js';
import { resellerNotVerified, testModeOnly } from '../payments/payments.service.js';
import { ProviderError } from '../payments/provider-error.js';
import type { TransferResult } from '../payments/providers.js';
import { EventsService } from '../webhooks/events.service.js';
import { accountNameMatches } from '../identity/providers.js';
import { InboxService } from '../notifications/inbox.service.js';

/** Payouts to a newly added live bank account start after this, so a taken-over account cannot be emptied at once. */
export const bankAccountCoolingOffMs = 24 * 60 * 60 * 1000;
export const maxBankAccounts = 5;
const bankListTtlMs = 60 * 60 * 1000;

const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);

/** Live payouts start 24 hours after the account was added, or later when a business rename restarted the wait. */
const payoutsFrom = (account: BankAccount) => {
  if (account.mode === 'test') return account.createdAt;
  const added = account.createdAt.getTime() + bankAccountCoolingOffMs;
  return new Date(Math.max(added, account.payoutsFrom?.getTime() ?? 0));
};

export function presentBankAccount(account: BankAccount) {
  return {
    object: 'bank_account' as const,
    id: account.id,
    mode: account.mode,
    country: account.country,
    currency: account.currency,
    bank_code: account.bankCode,
    bank_name: account.bankName,
    account_number_last4: account.accountNumberLast4,
    account_name: account.accountName,
    payouts_available_from: payoutsFrom(account).toISOString(),
    created_at: account.createdAt.toISOString(),
  };
}

/**
 * A payout. With its bank account (list and get), it names the bank and last four digits, which stay readable after the
 * account is removed; webhook payloads leave the account details out.
 */
export function presentPayout(payout: Payout & { bankAccount?: BankAccount | null }) {
  return {
    object: 'payout' as const,
    id: payout.id,
    mode: payout.mode,
    status: payout.status,
    amount: minor(payout.amountMinor),
    currency: payout.currency,
    bank_account_id: payout.bankAccountId,
    ...(payout.bankAccount
      ? { bank_account: { bank_name: payout.bankAccount.bankName, account_number_last4: payout.bankAccount.accountNumberLast4, removed: payout.bankAccount.removedAt !== null } }
      : {}),
    failure_reason: payout.failureReason,
    created_at: payout.createdAt.toISOString(),
    completed_at: payout.completedAt?.toISOString() ?? null,
  };
}

/**
 * Withdrawals of earnings to the reseller's bank account. Only matured earnings can be withdrawn. The amount moves to
 * "payouts in progress" before the bank transfer starts, and back to earnings only if the transfer definitely failed.
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger('Payouts');
  private readonly bankLists = new Map<string, { at: number; banks: Array<{ code: string; name: string }> }>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletService,
    private readonly providers: PaymentProviders,
    private readonly email: EmailService,
    private readonly events: EventsService,
    private readonly inbox: InboxService,
  ) {}

  private encryption() {
    if (!this.config.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is not configured');
    return new Encryption(this.config.ENCRYPTION_KEY);
  }

  private async ownerEmail(resellerId: string) {
    const owner = await this.prisma.resellerMember.findFirst({ where: { resellerId, role: 'owner' }, include: { user: true } });
    return owner?.user.email ?? null;
  }

  private notify(resellerId: string, build: (to: string) => Parameters<EmailService['send']>[0]) {
    void this.ownerEmail(resellerId)
      .then(to => (to ? this.email.send(build(to)) : undefined))
      .catch(error => this.logger.warn({ err: error, resellerId }, 'Could not send the email'));
  }

  // -- Banks and bank accounts -----------------------------------------------------------------------------------

  async banks(resellerId: string, mode: LedgerMode) {
    const { country } = await this.wallets.currencyOf(resellerId);
    const provider = this.providers.transfers(mode, country.code);
    const key = `${provider.name}:${country.code}`;
    const cached = this.bankLists.get(key);
    if (cached && Date.now() - cached.at < bankListTtlMs) return { object: 'list' as const, data: cached.banks };
    const banks = await provider.listBanks(country.code).catch(error => {
      this.logger.warn({ err: error }, 'Could not list banks');
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'provider_error', 'The bank list is unavailable right now. Try again shortly.');
    });
    this.bankLists.set(key, { at: Date.now(), banks });
    return { object: 'list' as const, data: banks };
  }

  async listBankAccounts(resellerId: string, mode: LedgerMode) {
    const accounts = await this.prisma.bankAccount.findMany({ where: { resellerId, mode, removedAt: null }, orderBy: { createdAt: 'asc' } });
    return { object: 'list' as const, data: accounts.map(presentBankAccount) };
  }

  /** Adds a payout account. The bank confirms it exists and supplies the account name; the owner is emailed. */
  async addBankAccount(resellerId: string, mode: LedgerMode, userId: string, input: { bank_code: string; account_number: string }) {
    const { reseller, country, currency } = await this.wallets.currencyOf(resellerId);
    if (mode === 'live' && !reseller.verifiedAt) throw resellerNotVerified();
    const active = await this.prisma.bankAccount.count({ where: { resellerId, mode, removedAt: null } });
    if (active >= maxBankAccounts) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'bank_account_limit_reached', `You can have up to ${maxBankAccounts} payout accounts. Remove one first.`);
    }
    const bank = (await this.banks(resellerId, mode)).data.find(b => b.code === input.bank_code);
    if (!bank) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Unknown bank. Use a code from the bank list.', 'bank_code');

    const provider = this.providers.transfers(mode, country.code);
    let accountName: string;
    try {
      ({ accountName } = await provider.resolveAccount({ country: country.code, bankCode: bank.code, accountNumber: input.account_number }));
    } catch (error) {
      if (error instanceof ProviderError && error.definite) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'bank_account_invalid', 'The bank could not find this account. Check the number and bank.', 'account_number');
      }
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'provider_error', 'The bank could not be reached. Try again shortly.');
    }
    // Live payouts go only to the verified owner's or the business's own account.
    if (mode === 'live' && !accountNameMatches(accountName, [reseller.verifiedName, reseller.name])) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'invalid_request_error',
        'account_name_mismatch',
        `This account is in the name of ${accountName}. Payouts can only go to an account in your verified name or your business name.`,
        'account_number',
      );
    }
    const account = await this.prisma.bankAccount.create({
      data: {
        resellerId,
        mode,
        country: country.code,
        currency,
        bankCode: bank.code,
        bankName: bank.name,
        accountNumberEncrypted: this.encryption().encrypt(input.account_number),
        accountNumberLast4: input.account_number.slice(-4),
        accountName,
        createdById: userId,
      },
    });
    if (mode === 'live') this.notify(resellerId, to => bankAccountAddedEmail(to, bank.name, account.accountNumberLast4));
    await this.inbox.reseller(resellerId, 'bank_account.added', {
      subject: account.id,
      title: 'Payout bank account added',
      body: `${bank.name} account ending ${account.accountNumberLast4} (${accountName}) can receive withdrawals after the 24-hour wait. If you did not add it, remove it and contact support.`,
      link: '/wallet/bank-accounts',
      mode,
    });
    return presentBankAccount(account);
  }

  async removeBankAccount(resellerId: string, mode: LedgerMode, id: string) {
    const account = await this.prisma.bankAccount.findFirst({ where: { id, resellerId, mode, removedAt: null } });
    if (!account) throw notFound('bank account');
    return { ...presentBankAccount(await this.prisma.bankAccount.update({ where: { id }, data: { removedAt: new Date() } })), removed: true };
  }

  // -- Payouts ---------------------------------------------------------------------------------------------------

  async listPayouts(resellerId: string, mode: LedgerMode, page: { limit?: number; starting_after?: string }) {
    const limit = page.limit ?? 25;
    const payouts = await this.prisma.payout.findMany({
      where: { resellerId, mode },
      include: { bankAccount: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(page.starting_after ? { cursor: { id: page.starting_after }, skip: 1 } : {}),
    });
    return { object: 'list' as const, data: payouts.slice(0, limit).map(presentPayout), has_more: payouts.length > limit };
  }

  async getPayout(resellerId: string, mode: LedgerMode, id: string) {
    const payout = await this.prisma.payout.findFirst({ where: { id, resellerId, mode }, include: { bankAccount: true } });
    if (!payout) throw notFound('payout');
    return presentPayout(payout);
  }

  async createPayout(resellerId: string, mode: LedgerMode, userId: string, input: { amount: number; bank_account_id: string }) {
    const { reseller, country, currency } = await this.wallets.currencyOf(resellerId);
    if (mode === 'live' && reseller.status !== 'active') throw resellerNotVerified();
    const account = await this.prisma.bankAccount.findFirst({ where: { id: input.bank_account_id, resellerId, mode, removedAt: null } });
    if (!account) throw notFound('bank account');
    // Withdrawals wait while a chargeback is open, or a lost one's shortfall is not settled: the money may be owed back.
    const charged = await this.prisma.chargeback.count({
      where: { resellerId, mode, protected: false, OR: [{ status: 'open' }, { status: 'lost', shortfallMinor: { gt: 0n }, clearedAt: null }] },
    });
    if (charged > 0) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'payouts_on_hold', 'Withdrawals wait while a chargeback is open or unsettled. Contact support for details.');
    }
    if (payoutsFrom(account) > new Date()) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'bank_account_cooling_off', `Payouts to this account start at ${payoutsFrom(account).toISOString()}.`, 'bank_account_id');
    }
    const amount = BigInt(input.amount);
    if (amount < country.minWithdrawalMinor) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'amount_too_small', `The smallest withdrawal is ${formatMoney(country.minWithdrawalMinor, currency)}.`, 'amount');
    }

    const provider = this.providers.transfers(mode, country.code);
    const id = randomUUID();
    const entry = await this.ledger.prepare({
      mode,
      type: 'payout',
      reference: `payout:${id}`,
      resellerId,
      description: `Withdrawal to ${account.bankName} ••••${account.accountNumberLast4}`,
      metadata: { payout_id: id },
      lines: [
        { account: { kind: 'reseller_earnings', currency, resellerId }, debit: amount },
        { account: { kind: 'reseller_payouts_pending', currency, resellerId }, credit: amount },
      ],
    });
    const payout = await this.prisma.$transaction(async tx => {
      const created = await tx.payout.create({
        data: { id, resellerId, mode, bankAccountId: account.id, amountMinor: amount, currency, reference: `bc_po_${id.replaceAll('-', '')}`, provider: provider.name, requestedById: userId },
      });
      await this.ledger.write(tx, entry);
      return created;
    });

    try {
      const result = await provider.transfer({
        reference: payout.reference,
        bankCode: account.bankCode,
        accountNumber: this.encryption().decrypt(account.accountNumberEncrypted),
        amount,
        currency,
        narration: `${reseller.name} BitoCard earnings`,
      });
      return presentPayout({ ...(await this.apply(payout, result)), bankAccount: account });
    } catch (error) {
      if (error instanceof ProviderError && error.definite) {
        return presentPayout({ ...(await this.apply(payout, { status: 'failed', providerTransferId: '', fee: 0n, failureReason: 'The bank transfer was refused.' })), bankAccount: account });
      }
      // Unclear: the transfer may still happen. The payout stays pending for the exception queue; money stays set aside.
      this.logger.error({ err: error, payoutId: payout.id }, 'Payout transfer outcome unclear; needs review');
      return presentPayout({ ...payout, bankAccount: account });
    }
  }

  /** Applies a transfer result. Paid and failed are final; repeating them does nothing. */
  async apply(payout: Payout, result: TransferResult) {
    const transferId = result.providerTransferId || payout.providerTransferId;
    if (result.status === 'pending') {
      await this.prisma.payout.updateMany({ where: { id: payout.id, status: 'pending' }, data: { status: 'processing', providerTransferId: transferId } });
      return this.prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    }
    const resellerAccount = (kind: 'reseller_payouts_pending' | 'reseller_earnings') => ({ kind, currency: payout.currency, resellerId: payout.resellerId });
    const providerAccount = { kind: 'provider_balance' as const, currency: payout.currency, provider: payout.provider };
    const fee = result.fee > 0n ? result.fee : 0n;
    const entry = await this.ledger.prepare(
      result.status === 'paid'
        ? {
            mode: payout.mode,
            type: 'payout',
            reference: `payout_paid:${payout.id}`,
            resellerId: payout.resellerId,
            description: 'Withdrawal paid',
            metadata: { payout_id: payout.id, provider_transfer_id: transferId },
            lines: [
              { account: resellerAccount('reseller_payouts_pending'), debit: payout.amountMinor },
              ...(fee > 0n ? [{ account: { kind: 'processing_fees' as const, currency: payout.currency, provider: payout.provider }, debit: fee }] : []),
              { account: providerAccount, credit: payout.amountMinor + fee },
            ],
          }
        : {
            mode: payout.mode,
            type: 'payout_reversal',
            reference: `payout_failed:${payout.id}`,
            resellerId: payout.resellerId,
            description: 'Withdrawal failed: returned to earnings',
            metadata: { payout_id: payout.id, reason: result.failureReason },
            lines: [
              { account: resellerAccount('reseller_payouts_pending'), debit: payout.amountMinor },
              { account: resellerAccount('reseller_earnings'), credit: payout.amountMinor },
            ],
          },
    );
    const changed = await this.prisma.$transaction(async tx => {
      const claimed = await tx.payout.updateMany({
        where: { id: payout.id, status: { in: ['pending', 'processing'] } },
        data: {
          status: result.status,
          providerTransferId: transferId || null,
          failureReason: result.status === 'failed' ? (result.failureReason ?? 'The transfer failed.') : null,
          completedAt: new Date(),
        },
      });
      if (claimed.count === 1) {
        await this.ledger.write(tx, entry);
        const settled = await tx.payout.findUniqueOrThrow({ where: { id: payout.id } });
        await this.events.record(tx, { resellerId: settled.resellerId, mode: settled.mode, type: settled.status === 'paid' ? 'payout.paid' : 'payout.failed', object: presentPayout(settled) });
      }
      return claimed.count === 1;
    });
    if (changed) this.events.committed();
    const updated = await this.prisma.payout.findUniqueOrThrow({ where: { id: payout.id }, include: { bankAccount: true } });
    if (changed) {
      const amount = formatMoney(updated.amountMinor, updated.currency);
      const paid = updated.status === 'paid';
      await this.inbox.reseller(updated.resellerId, paid ? 'payout.paid' : 'payout.failed', {
        subject: updated.id,
        title: paid ? `${amount} withdrawal paid` : `${amount} withdrawal failed`,
        body: paid
          ? `Your withdrawal was paid to the account ending ${updated.bankAccount.accountNumberLast4}.`
          : `Your withdrawal to the account ending ${updated.bankAccount.accountNumberLast4} failed: ${(updated.failureReason ?? 'the bank refused it').replace(/\.+$/, '')}. The money is back in your earnings.`,
        link: '/wallet/payouts',
        mode: updated.mode,
      });
      if (!paid && updated.mode === 'live') {
        await this.inbox.admins('admin.payout.failed', {
          subject: updated.id,
          title: `${amount} withdrawal failed`,
          body: `A reseller withdrawal failed: ${(updated.failureReason ?? 'the bank refused it').replace(/\.+$/, '')}.`,
          link: `/resellers/${updated.resellerId}`,
        });
      }
    }
    if (changed && updated.mode === 'live') {
      const amount = formatMoney(updated.amountMinor, updated.currency);
      this.notify(updated.resellerId, to =>
        updated.status === 'paid' ? payoutPaidEmail(to, amount, updated.bankAccount.accountNumberLast4) : payoutFailedEmail(to, amount, updated.failureReason ?? 'the bank refused it'),
      );
    }
    return updated;
  }

  /** A provider notification about a transfer: re-read its status from the provider, then apply it. */
  async refreshByTransferId(providerName: string, transferId: string) {
    const provider = this.providers.transfersByName(providerName);
    if (!provider) return { handled: false };
    const result = await provider.transferStatus(transferId);
    const payout = await this.prisma.payout.findFirst({
      where: { provider: providerName, OR: [{ providerTransferId: transferId }, ...(result.reference ? [{ reference: result.reference }] : [])] },
    });
    if (!payout) {
      this.logger.warn({ providerName, transferId }, 'Transfer notification for an unknown payout');
      return { handled: false };
    }
    return { handled: true, status: (await this.apply(payout, result)).status };
  }

  /** Checks live payouts still in progress. Run on a schedule. */
  async refreshProcessing() {
    const payouts = await this.prisma.payout.findMany({
      where: { status: 'processing', mode: 'live', providerTransferId: { not: null }, createdAt: { lt: new Date(Date.now() - 60_000) } },
      take: 100,
    });
    let completed = 0;
    for (const payout of payouts) {
      const provider = this.providers.transfersByName(payout.provider);
      if (!provider || !payout.providerTransferId) continue;
      try {
        if ((await this.apply(payout, await provider.transferStatus(payout.providerTransferId))).status !== 'processing') completed += 1;
      } catch (error) {
        this.logger.warn({ err: error, payoutId: payout.id }, 'Payout status check failed; will retry');
      }
    }
    return { checked: payouts.length, completed };
  }

  async simulatePayout(resellerId: string, mode: LedgerMode, id: string, outcome: 'paid' | 'failed') {
    if (mode !== 'test') throw testModeOnly();
    const payout = await this.prisma.payout.findFirst({ where: { id, resellerId, mode: 'test' }, include: { bankAccount: true } });
    if (!payout) throw notFound('payout');
    const result: TransferResult = { status: outcome, providerTransferId: payout.providerTransferId ?? `sandbox_${payout.reference}`, fee: 0n, failureReason: outcome === 'failed' ? 'Simulated failure.' : undefined };
    return presentPayout({ ...(await this.apply(payout, result)), bankAccount: payout.bankAccount });
  }
}
