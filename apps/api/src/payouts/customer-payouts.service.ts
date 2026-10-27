import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { Encryption } from '../common/encryption.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CustomerBankAccount, CustomerPayout, LedgerMode, Prisma } from '../generated/prisma/client.js';
import { accountNameMatches } from '../identity/providers.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { minor } from '../ledger/mode.js';
import { EmailService } from '../notifications/email.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { customerBankAccountAddedEmail, formatMoney } from '../notifications/templates.js';
import { PaymentProviders } from '../payments/payment-providers.js';
import { testModeOnly } from '../payments/payments.service.js';
import { ProviderError } from '../payments/provider-error.js';
import type { TransferResult } from '../payments/providers.js';

/** Who is cashing out: a customer allowed to use P2P (checked by the caller), their store's mode and their country. */
export type PayoutContext = { customer: CustomerWithStore; mode: LedgerMode; sellerId: string; country: string; currency: string; verifiedName: string | null };

const maxAccounts = 3;
/** Payouts to a newly added live bank account start after this (as for resellers), so a taken-over account cannot be emptied at once. */
const bankAccountCoolingOffMs = 24 * 60 * 60 * 1000;
/** A payout whose transfer outcome stayed unclear this long is flagged for finance (once). */
const unclearAfterMs = 60 * 60 * 1000;
const dayMs = 86_400_000;

const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);

export function presentCustomerBankAccount(account: CustomerBankAccount) {
  return {
    object: 'customer_bank_account' as const,
    id: account.id,
    mode: account.mode,
    currency: account.currency,
    bank_name: account.bankName,
    account_number_last4: account.accountNumberLast4,
    account_name: account.accountName,
    payouts_available_from: account.payoutsFrom.toISOString(),
    /** Payouts to it can start now (its 24-hour wait is over). */
    ready: account.payoutsFrom <= new Date(),
    created_at: account.createdAt.toISOString(),
  };
}

export function presentCustomerPayout(payout: CustomerPayout & { bankAccount?: CustomerBankAccount | null }) {
  return {
    object: 'customer_payout' as const,
    id: payout.id,
    mode: payout.mode,
    status: payout.status,
    amount: minor(payout.amountMinor),
    currency: payout.currency,
    bank_account: payout.bankAccount ? { bank_name: payout.bankAccount.bankName, account_number_last4: payout.bankAccount.accountNumberLast4 } : null,
    failure_reason: payout.failureReason,
    created_at: payout.createdAt.toISOString(),
    completed_at: payout.completedAt?.toISOString() ?? null,
  };
}

/**
 * Store customers' P2P money (`customer_withdrawable`, from selling crypto) paid out to their own bank account through
 * BitoCard's transfer provider. Live accounts must be in the customer's verified name and wait 24 hours after they are
 * added; money from P2P sales becomes withdrawable after the country's payout hold (the same days as resellers'
 * earnings), so a sale paid with money that is later reversed can still be put right. The amount moves to
 * `customer_payouts_pending` before the transfer starts, and back only if the bank definitely refused it; an unclear
 * transfer stays pending (finance is told after an hour).
 */
@Injectable()
export class CustomerPayoutsService {
  private readonly logger = new Logger('CustomerPayouts');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly providers: PaymentProviders,
    private readonly email: EmailService,
    private readonly inbox: InboxService,
  ) {}

  private encryption() {
    if (!this.config.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is not configured');
    return new Encryption(this.config.ENCRYPTION_KEY);
  }

  private ref(customerId: string, kind: 'customer_withdrawable' | 'customer_payouts_pending', currency: string) {
    return { kind, currency, customerId };
  }

  // -- Money that can be paid out -------------------------------------------------------------------------------

  /** P2P money now: the balance, what is still inside the payout hold, and what can be paid out. */
  async balance(context: PayoutContext) {
    const country = await this.prisma.country.findUniqueOrThrow({ where: { code: context.country } });
    const accountId = await this.ledger.accountId(context.mode, this.ref(context.customer.id, 'customer_withdrawable', context.currency));
    const account = await this.prisma.ledgerAccount.findUniqueOrThrow({ where: { id: accountId } });
    const held = await this.held(accountId, country.payoutHoldDays, { customerId: context.customer.id, mode: context.mode, currency: context.currency, country: context.country });
    const available = account.balanceMinor > held ? account.balanceMinor - held : 0n;
    return {
      object: 'p2p_cash' as const,
      mode: context.mode,
      currency: context.currency,
      balance: minor(account.balanceMinor),
      held: minor(account.balanceMinor - available),
      available: minor(available),
      hold_days: country.payoutHoldDays,
      /** Money from cross-border P2P sales waits this many days instead, where the market sets a longer hold. */
      cross_border_hold_days: await this.crossBorderHoldDays(context.mode, context.country, context.currency, country.payoutHoldDays),
      minimum: minor(country.minWithdrawalMinor),
    };
  }

  /**
   * Money not withdrawable yet: from P2P sales (and BitoCard Shop Safe pay sales) credited inside the hold, and Safe
   * pay money finance has not approved (the buyer paid from a recent card or mobile money top-up), whenever released.
   */
  /** The market's hold on money from cross-border P2P sales, where it is longer than the country's own. */
  private async crossBorderHoldDays(mode: LedgerMode, country: string, currency: string, holdDays: number, db: Pick<Prisma.TransactionClient, 'cryptoMarketLimit'> = this.prisma) {
    const row = await db.cryptoMarketLimit.findUnique({ where: { mode_market_currency: { mode, market: country, currency } }, select: { crossBorderHoldDays: true } });
    return row?.crossBorderHoldDays && row.crossBorderHoldDays > holdDays ? row.crossBorderHoldDays : holdDays;
  }

  private async held(
    accountId: string,
    holdDays: number,
    owner: { customerId: string; mode: LedgerMode; currency: string; country: string },
    db: Pick<Prisma.TransactionClient, 'ledgerPosting' | 'classifiedOrder' | 'p2pTrade' | 'cryptoMarketLimit'> = this.prisma,
  ) {
    const holdStart = new Date(Date.now() - Math.max(holdDays, 0) * dayMs);
    const recent =
      holdDays > 0
        ? await db.ledgerPosting.aggregate({
            where: { accountId, amountMinor: { lt: 0n }, entry: { type: { in: ['p2p_trade', 'exchange_trade', 'classified_release', 'classified_partial'] }, createdAt: { gt: holdStart } } },
            _sum: { amountMinor: true },
          })
        : { _sum: { amountMinor: 0n } };
    // Released before the hold window (inside it, the money is already counted above).
    const reviewing = await db.classifiedOrder.aggregate({
      where: { sellerId: owner.customerId, mode: owner.mode, currency: owner.currency, payoutReview: { in: ['pending', 'rejected'] }, releasedAt: { lte: holdStart } },
      _sum: { sellerPayoutMinor: true },
    });
    // Money from cross-border P2P sales (a buyer from another country) waits for the market's longer hold: the part
    // older than the country's own hold is counted here (the newer part is already counted above).
    const crossDays = await this.crossBorderHoldDays(owner.mode, owner.country, owner.currency, holdDays, db);
    const crossHeld =
      crossDays > holdDays
        ? await db.p2pTrade.aggregate({
            where: { sellerId: owner.customerId, mode: owner.mode, currency: owner.currency, crossBorder: true, createdAt: { gt: new Date(Date.now() - crossDays * dayMs), lte: holdStart } },
            _sum: { fiatMinor: true },
          })
        : { _sum: { fiatMinor: 0n } };
    return -(recent._sum.amountMinor ?? 0n) + (reviewing._sum.sellerPayoutMinor ?? 0n) + (crossHeld._sum.fiatMinor ?? 0n);
  }

  // -- Banks and accounts ---------------------------------------------------------------------------------------

  async banks(context: PayoutContext) {
    const provider = this.providers.transfers(context.mode, context.country);
    const banks = await provider.listBanks(context.country).catch(error => {
      this.logger.warn({ err: error }, 'Could not list banks');
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'provider_error', 'The bank list is unavailable right now. Try again shortly.');
    });
    return { object: 'list' as const, data: banks };
  }

  async accounts(customerId: string, mode: LedgerMode) {
    const rows = await this.prisma.customerBankAccount.findMany({ where: { customerId, mode, removedAt: null }, orderBy: { createdAt: 'asc' } });
    return { object: 'list' as const, data: rows.map(presentCustomerBankAccount) };
  }

  /** Adds a bank account: the bank confirms it and names its holder, who must be the verified customer (live). */
  async addAccount(context: PayoutContext, input: { bank_code: string; account_number: string }) {
    const { customer, mode } = context;
    if ((await this.prisma.customerBankAccount.count({ where: { customerId: customer.id, mode, removedAt: null } })) >= maxAccounts) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'bank_account_limit_reached', `You can have up to ${maxAccounts} bank accounts. Remove one first.`);
    }
    const bank = (await this.banks(context)).data.find(item => item.code === input.bank_code);
    if (!bank) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Unknown bank. Choose one from the list.', 'bank_code');
    const provider = this.providers.transfers(mode, context.country);
    let accountName: string;
    try {
      ({ accountName } = await provider.resolveAccount({ country: context.country, bankCode: bank.code, accountNumber: input.account_number }));
    } catch (error) {
      if (error instanceof ProviderError && error.definite) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'bank_account_invalid', 'The bank could not find this account. Check the number and bank.', 'account_number');
      }
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'provider_error', 'The bank could not be reached. Try again shortly.');
    }
    // Live payouts go only to an account in the name the identity check verified (never the name the customer typed).
    if (mode === 'live' && !accountNameMatches(accountName, [context.verifiedName])) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'invalid_request_error',
        'account_name_mismatch',
        `This account is in the name of ${accountName}. Payouts can only go to an account in your own verified name.`,
        'account_number',
      );
    }
    const payoutsFrom = new Date(Date.now() + (mode === 'live' ? bankAccountCoolingOffMs : 0));
    const account = await this.prisma.customerBankAccount.create({
      data: {
        customerId: customer.id,
        mode,
        country: context.country,
        currency: context.currency,
        bankCode: bank.code,
        bankName: bank.name,
        accountNumberEncrypted: this.encryption().encrypt(input.account_number),
        accountNumberLast4: input.account_number.slice(-4),
        accountName,
        payoutsFrom,
      },
    });
    const when = payoutsFrom.toUTCString().replace(':00 GMT', ' UTC');
    await this.email
      .send(customerBankAccountAddedEmail(customer.email, { store: customer.store.name, bank: bank.name, last4: account.accountNumberLast4, name: accountName, payoutsFrom: when }))
      .catch(error => this.logger.warn({ err: error, customerId: customer.id }, 'Could not email the bank account notice'));
    await this.inbox.customer({ customerId: customer.id, storeId: customer.storeId }, 'customer.security.bank_account_added', {
      subject: account.id,
      title: 'Bank account added',
      body: `${bank.name} ending ${account.accountNumberLast4} can receive your P2P money from ${when}. If this was not you, remove it and change your password.`,
      link: '/account/crypto/cash-out',
      mode,
    });
    return presentCustomerBankAccount(account);
  }

  async removeAccount(customerId: string, mode: LedgerMode, id: string) {
    const removed = await this.prisma.customerBankAccount.updateMany({ where: { id, customerId, mode, removedAt: null }, data: { removedAt: new Date() } });
    if (!removed.count) throw notFound('bank account');
    return { object: 'customer_bank_account' as const, id, removed: true };
  }

  // -- Payouts --------------------------------------------------------------------------------------------------

  async list(customerId: string, mode: LedgerMode) {
    const rows = await this.prisma.customerPayout.findMany({ where: { customerId, mode }, include: { bankAccount: true }, orderBy: { createdAt: 'desc' }, take: 25 });
    return { object: 'list' as const, data: rows.map(presentCustomerPayout) };
  }

  /** Pays P2P money out to one of the customer's bank accounts: set aside first, then the bank transfer. */
  async create(context: PayoutContext, input: { amount: number; bank_account_id: string }) {
    const { customer, mode, currency } = context;
    const account = await this.prisma.customerBankAccount.findFirst({ where: { id: input.bank_account_id, customerId: customer.id, mode, removedAt: null } });
    if (!account) throw notFound('bank account');
    if (account.payoutsFrom > new Date()) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'bank_account_cooling_off', `Payouts to this account start at ${account.payoutsFrom.toISOString()}.`, 'bank_account_id');
    }
    const country = await this.prisma.country.findUniqueOrThrow({ where: { code: context.country } });
    const amount = BigInt(input.amount);
    if (amount < country.minWithdrawalMinor) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'amount_too_small', `The smallest payout is ${formatMoney(country.minWithdrawalMinor, currency)}.`, 'amount');
    }
    const provider = this.providers.transfers(mode, context.country);
    const id = randomUUID();
    const sourceId = await this.ledger.accountId(mode, this.ref(customer.id, 'customer_withdrawable', currency));
    const pendingId = await this.ledger.accountId(mode, this.ref(customer.id, 'customer_payouts_pending', currency));
    const payout = await this.prisma.$transaction(async tx => {
      const balances = await this.ledger.lockBalances(tx, [sourceId, pendingId]);
      // With the account locked: what is withdrawable now, after the payout hold.
      const held = await this.held(sourceId, country.payoutHoldDays, { customerId: customer.id, mode, currency, country: country.code }, tx);
      const available = (balances.get(sourceId) ?? 0n) - held;
      if (amount > available) {
        throw new ApiError(
          HttpStatus.PAYMENT_REQUIRED,
          'invalid_request_error',
          'insufficient_funds',
          `You can pay out up to ${formatMoney(available > 0n ? available : 0n, currency)} now. Money from P2P and Shop sales can be paid out ${country.payoutHoldDays} days after each sale, and Safe pay money BitoCard is checking once it is approved.`,
          'amount',
        );
      }
      const created = await tx.customerPayout.create({
        data: { id, customerId: customer.id, mode, bankAccountId: account.id, amountMinor: amount, currency, reference: `bc_cpo_${id.replaceAll('-', '')}`, provider: provider.name },
      });
      await this.ledger.write(tx, {
        mode,
        type: 'customer_payout',
        reference: `customer_payout:${id}`,
        description: `Payout to ${account.bankName} ••••${account.accountNumberLast4}`,
        metadata: { payout_id: id },
        postings: [
          { accountId: sourceId, kind: 'customer_withdrawable', amount },
          { accountId: pendingId, kind: 'customer_payouts_pending', amount: -amount },
        ],
      });
      return created;
    });
    let result: TransferResult;
    try {
      result = await provider.transfer({
        reference: payout.reference,
        bankCode: account.bankCode,
        accountNumber: this.encryption().decrypt(account.accountNumberEncrypted),
        amount,
        currency,
        narration: `${customer.store.name} P2P payout`,
      });
    } catch (error) {
      if (error instanceof ProviderError && error.definite) {
        return presentCustomerPayout({ ...(await this.apply(payout, { status: 'failed', providerTransferId: '', fee: 0n, failureReason: 'The bank transfer was refused.' })), bankAccount: account });
      }
      // Unclear: the transfer may still happen, so the money stays set aside (finance is told if it stays unclear).
      this.logger.error({ err: error, payoutId: payout.id }, 'Customer payout outcome unclear');
      return presentCustomerPayout({ ...payout, bankAccount: account });
    }
    // The transfer is made: keep its ID first, so the payments job checks it even if recording the result fails now.
    if (result.providerTransferId) await this.prisma.customerPayout.updateMany({ where: { id: payout.id, status: 'pending' }, data: { status: 'processing', providerTransferId: result.providerTransferId } });
    return presentCustomerPayout({ ...(await this.apply(payout, result)), bankAccount: account });
  }

  /** Applies a transfer result once: paid takes the money out to the bank, failed returns it to the customer's P2P money. */
  async apply(payout: CustomerPayout, result: TransferResult) {
    const transferId = result.providerTransferId || payout.providerTransferId;
    if (result.status === 'pending') {
      await this.prisma.customerPayout.updateMany({ where: { id: payout.id, status: 'pending' }, data: { status: 'processing', providerTransferId: transferId } });
      return this.prisma.customerPayout.findUniqueOrThrow({ where: { id: payout.id } });
    }
    const pending = this.ref(payout.customerId, 'customer_payouts_pending', payout.currency);
    const fee = result.fee > 0n ? result.fee : 0n;
    const entry = await this.ledger.prepare(
      result.status === 'paid'
        ? {
            mode: payout.mode,
            type: 'customer_payout',
            reference: `customer_payout_paid:${payout.id}`,
            description: 'Payout paid',
            metadata: { payout_id: payout.id, provider_transfer_id: transferId },
            lines: [
              { account: pending, debit: payout.amountMinor },
              ...(fee > 0n ? [{ account: { kind: 'processing_fees' as const, currency: payout.currency, provider: payout.provider }, debit: fee }] : []),
              { account: { kind: 'provider_balance' as const, currency: payout.currency, provider: payout.provider }, credit: payout.amountMinor + fee },
            ],
          }
        : {
            mode: payout.mode,
            type: 'customer_payout_reversal',
            reference: `customer_payout_failed:${payout.id}`,
            description: 'Payout failed: returned to your P2P money',
            metadata: { payout_id: payout.id, reason: result.failureReason },
            lines: [
              { account: pending, debit: payout.amountMinor },
              { account: this.ref(payout.customerId, 'customer_withdrawable', payout.currency), credit: payout.amountMinor },
            ],
          },
    );
    const changed = await this.prisma.$transaction(async tx => {
      const claimed = await tx.customerPayout.updateMany({
        where: { id: payout.id, status: { in: ['pending', 'processing'] } },
        data: { status: result.status, providerTransferId: transferId || null, failureReason: result.status === 'failed' ? (result.failureReason ?? 'The transfer failed.') : null, completedAt: new Date() },
      });
      if (claimed.count === 1) await this.ledger.write(tx, entry);
      return claimed.count === 1;
    });
    const updated = await this.prisma.customerPayout.findUniqueOrThrow({ where: { id: payout.id }, include: { bankAccount: true, customer: { select: { storeId: true } } } });
    if (changed) {
      const amount = formatMoney(updated.amountMinor, updated.currency);
      const paid = updated.status === 'paid';
      await this.inbox.customer({ customerId: updated.customerId, storeId: updated.customer.storeId }, paid ? 'customer.payout.paid' : 'customer.payout.failed', {
        subject: updated.id,
        title: paid ? `${amount} sent to your bank` : `${amount} payout failed`,
        body: paid
          ? `Your P2P money was paid to the account ending ${updated.bankAccount.accountNumberLast4}.`
          : `The payout to the account ending ${updated.bankAccount.accountNumberLast4} failed: ${(updated.failureReason ?? 'the bank refused it').replace(/\.+$/, '')}. The money is back in your P2P balance.`,
        link: '/account/crypto/cash-out',
        mode: updated.mode,
      });
    }
    return updated;
  }

  /** A transfer notification for one of these payouts (re-read from the provider): true when it named one. */
  async refreshByTransfer(providerName: string, transferId: string, result: TransferResult) {
    const payout = await this.prisma.customerPayout.findFirst({
      where: { provider: providerName, OR: [{ providerTransferId: transferId }, ...(result.reference ? [{ reference: result.reference }] : [])] },
    });
    if (!payout) return null;
    return (await this.apply(payout, result)).status;
  }

  /** The `payments` job's part: live payouts in progress checked with the provider; unclear ones flagged for finance once. */
  async job() {
    const processing = await this.prisma.customerPayout.findMany({
      where: { status: 'processing', mode: 'live', providerTransferId: { not: null }, createdAt: { lt: new Date(Date.now() - 60_000) } },
      take: 100,
    });
    let completed = 0;
    for (const payout of processing) {
      const provider = this.providers.transfersByName(payout.provider);
      if (!provider || !payout.providerTransferId) continue;
      try {
        if ((await this.apply(payout, await provider.transferStatus(payout.providerTransferId))).status !== 'processing') completed += 1;
      } catch (error) {
        this.logger.warn({ err: error, payoutId: payout.id }, 'Customer payout status check failed; will retry');
      }
    }
    const unclear = await this.prisma.customerPayout.findMany({ where: { status: 'pending', needsReviewAt: null, createdAt: { lt: new Date(Date.now() - unclearAfterMs) } }, take: 100 });
    for (const payout of unclear) {
      const flagged = await this.prisma.customerPayout.updateMany({ where: { id: payout.id, needsReviewAt: null }, data: { needsReviewAt: new Date() } });
      if (!flagged.count) continue;
      await this.inbox.admins('admin.customer_payout.unclear', {
        subject: payout.id,
        title: `${formatMoney(payout.amountMinor, payout.currency)} customer payout unclear`,
        body: `The bank transfer ${payout.reference} (${payout.provider}) has no outcome after an hour. Check it with the provider; the money stays set aside.`,
        link: `/crypto/customers/${payout.customerId}`,
        mode: payout.mode,
      });
    }
    return { checked: processing.length, completed, flagged: unclear.length };
  }

  async simulate(customerId: string, mode: LedgerMode, id: string, outcome: 'paid' | 'failed') {
    if (mode !== 'test') throw testModeOnly();
    const payout = await this.prisma.customerPayout.findFirst({ where: { id, customerId, mode: 'test' }, include: { bankAccount: true } });
    if (!payout) throw notFound('payout');
    const result: TransferResult = { status: outcome, providerTransferId: payout.providerTransferId ?? `sandbox_${payout.reference}`, fee: 0n, failureReason: outcome === 'failed' ? 'Simulated failure.' : undefined };
    return presentCustomerPayout({ ...(await this.apply(payout, result)), bankAccount: payout.bankAccount });
  }

  /** Admin: customers' payouts, newest first. */
  async adminList(query: { mode?: LedgerMode; status?: string; customer_id?: string }) {
    const rows = await this.prisma.customerPayout.findMany({
      where: { ...(query.mode ? { mode: query.mode } : {}), ...(query.status ? { status: query.status as CustomerPayout['status'] } : {}), ...(query.customer_id ? { customerId: query.customer_id } : {}) },
      include: { bankAccount: true, customer: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      object: 'list' as const,
      data: rows.map(row => ({
        ...presentCustomerPayout(row),
        customer: { id: row.customerId, email: row.customer.email },
        account_name: row.bankAccount.accountName,
        reference: row.reference,
        provider: row.provider,
        needs_review: row.needsReviewAt !== null,
      })),
    };
  }
}
