import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { houseStoreId } from '../checkout/house-ids.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type PosCollection, type PosCollectionAccount, type PosTransferRequest } from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { formatMoney } from '../notifications/templates.js';
import { PaymentProviders } from '../payments/payment-providers.js';
import { PaymentsService } from '../payments/payments.service.js';
import { ProviderError } from '../payments/provider-error.js';
import type { ChargeResult } from '../payments/providers.js';
import { CustomerCashService } from '../payouts/customer-cash.js';
import { CustomerPayoutsService } from '../payouts/customer-payouts.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  collectionClaimMs,
  collectionFee,
  collectionNumber,
  collectionReference,
  isWorkingDay,
  marketZone,
  nextWorkingDay,
  settlementNumber,
  transferNumber,
  transferRequestMs,
  zonedDay,
  zonedDayStart,
} from './collection-rules.js';
import { PosCustomersService } from './customers.service.js';
import { freePlan } from './plans.js';
import { ownerBy, type PosBy, type PosSellOptions } from './actor.js';
import { PosSalesService, type SaleInput } from './sales.service.js';

export type TransferRequestInput = SaleInput & { transfer_amount: number };

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `There is no such ${what} on your Udozo POS account.`);
/** Refusals of the basket itself: by the time the money came, the shop's stock or prices moved. */
const basketCodes = new Set(['stock_short', 'price_changed', 'product_unavailable', 'plan_limit', 'payments_mismatch', 'credit_limit_reached']);
/** What the stored basket holds: the sale as the till sent it, less the till and its transfer part. */
type Basket = Omit<SaleInput, 'till_id'>;
type Account = Prisma.PosAccountGetPayload<{ include: { plan: true } }>;
const customerInclude = { store: { include: { reseller: { select: { house: true } } } }, market: true } satisfies Prisma.CustomerInclude;
const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);
const text = (value: string | null | undefined, max: number) => (value?.trim() ? value.trim().slice(0, max) : null);

/**
 * Udozo POS collection accounts and next-day settlement (docs/UDOZO_POS_PLAN.md, milestone 4). An owner on a paid plan
 * asks for a bank account number per till, opened by Udozo's gateways (Flutterwave, then Monnify in Nigeria; the
 * sandbox in test mode) with our reference (`bc_rp_<mode>_<id>`), as reserved accounts are. A transfer into it reaches
 * us through the gateway's notification or the payments job's sweep, is always re-read from the gateway (never trusted
 * from the body) by PaymentsService, and handed here: credited once per gateway transaction to the owner's
 * `pos_collected` less Udozo's fee (`pos_collection:<provider>:<transaction>`), then used to pay the sale waiting at
 * that till for exactly that amount. Any other transfer waits as unmatched, for the owner to attach to a sale or keep:
 * the money is theirs and settles either way. Each working day (the market's own) the `pos` job settles what came in
 * before the day began: one entry moves it to the owner's withdrawable balance (`pos_settlement:<account>:<day>`, so a
 * day is settled once) and a customer payout sends it to their chosen bank account, through the same machinery as every
 * Udozo payout (a definite failure leaves it in their Udozo payouts, an unclear one is chased by the payments job).
 */
@Injectable()
export class PosCollectionsService implements OnModuleInit {
  private readonly logger = new Logger('PosCollections');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: PosSalesService,
    private readonly customers: PosCustomersService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly inbox: InboxService,
    private readonly providers: PaymentProviders,
    private readonly payments: PaymentsService,
    private readonly cash: CustomerCashService,
    private readonly payouts: CustomerPayoutsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.payments.usePosDeposits((provider, result) => this.deposit(provider, result));
  }

  // ---- The owner's collection accounts ----

  /** Where the owner stands: whether collection accounts are open to them, their settlement account, and each till's account. */
  async overview(owner: CustomerWithStore) {
    const account = await this.sales.account(owner);
    const [open, tills, rows, bankAccounts, balance, unmatched, settlements] = await Promise.all([
      this.settings.isOnForCountry('pos_collections', account.country),
      this.prisma.posTill.findMany({ where: { shop: { accountId: account.id } }, include: { shop: { select: { id: true, name: true } } }, orderBy: [{ shop: { position: 'asc' } }, { position: 'asc' }] }),
      this.prisma.posCollectionAccount.findMany({ where: { accountId: account.id, status: { in: ['opening', 'active'] } } }),
      this.prisma.customerBankAccount.findMany({ where: { customerId: owner.id, mode: account.mode, removedAt: null }, orderBy: { createdAt: 'asc' } }),
      this.balance(owner.id, account.mode, account.currency),
      this.prisma.posCollection.count({ where: { accountId: account.id, status: 'unmatched' } }),
      this.prisma.posSettlement.findFirst({ where: { accountId: account.id }, orderBy: { day: 'desc' }, select: { day: true } }),
    ]);
    const byTill = new Map(rows.map(row => [row.tillId, row]));
    const blocked = this.blocked(account, open, account.settlementBankAccountId);
    const today = zonedDay(new Date(), marketZone(account.country));
    return {
      object: 'pos_collections' as const,
      /** `pos_collections` is on in the owner's country. */
      open,
      /** Why no new account can be opened now (null: it can): `unavailable`, `plan` or `settlement_account`. */
      blocked,
      currency: account.currency,
      mode: account.mode,
      /** Opening one needs the owner's BVN (Nigeria, live): the banks ask for it. */
      bvn_required: account.mode === 'live' && account.country === 'NG',
      /** Collected and not yet settled (less Udozo's fee). */
      collected: Number(balance),
      unmatched,
      /** The next working day collections settle on. */
      next_settlement: isWorkingDay(today) && (!settlements || settlements.day.toISOString().slice(0, 10) !== today) ? today : nextWorkingDay(today),
      held: account.settlementHeldAt ? { at: account.settlementHeldAt.toISOString(), reason: account.settlementHoldReason } : null,
      settlement_bank_account_id: account.settlementBankAccountId,
      /** The owner's own payout accounts on udozo.com, in the account's mode. */
      bank_accounts: bankAccounts.map(item => ({ id: item.id, bank_name: item.bankName, last4: item.accountNumberLast4, account_name: item.accountName, usable_from: item.payoutsFrom.toISOString() })),
      tills: tills.map(till => ({ id: till.id, name: till.name, shop: { id: till.shop.id, name: till.shop.name }, collection_account: byTill.has(till.id) ? this.presentAccount(byTill.get(till.id)!) : null })),
    };
  }

  private blocked(account: Account, open: boolean, settlementAccount: string | null) {
    if (!open) return 'unavailable' as const;
    if (account.planCode === freePlan) return 'plan' as const;
    if (!settlementAccount) return 'settlement_account' as const;
    return null;
  }

  private async balance(customerId: string, mode: Account['mode'], currency: string) {
    const row = await this.prisma.ledgerAccount.findFirst({ where: { kind: 'pos_collected', customerId, mode, currency }, select: { balanceMinor: true } });
    return row?.balanceMinor ?? 0n;
  }

  /** Chooses where collections are paid: one of the owner's own udozo.com payout accounts (null: none, collections stay in their Udozo payouts). */
  async setSettlementAccount(owner: CustomerWithStore, bankAccountId: string | null) {
    const account = await this.sales.account(owner);
    if (bankAccountId) {
      const found = await this.prisma.customerBankAccount.findFirst({ where: { id: bankAccountId, customerId: owner.id, mode: account.mode, removedAt: null }, select: { id: true } });
      if (!found) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'Add this bank account under Payouts on udozo.com first.', 'bank_account_id');
    }
    await this.prisma.posAccount.update({ where: { id: account.id }, data: { settlementBankAccountId: bankAccountId } });
    return this.overview(owner);
  }

  /**
   * Opens a till's collection account: a paid plan, `pos_collections` on in the country, a settlement account chosen,
   * and live, the checks a payout needs (and in Nigeria the BVN the gateways ask for, passed on and never kept). The
   * gateways are asked in turn under one reference; a clear refusal tries the next, an unclear answer stops and keeps
   * the account opening (a transfer that still arrives is credited by its reference). Asked twice at once, one asks.
   */
  async openAccount(owner: CustomerWithStore, tillId: string, input: { bvn?: string | null }) {
    const account = await this.sales.account(owner);
    const till = await this.sales.till(account.id, tillId);
    const open = await this.settings.isOnForCountry('pos_collections', account.country);
    const blocked = this.blocked(account, open, account.settlementBankAccountId);
    if (blocked === 'unavailable') throw conflict('pos_collections_unavailable', 'Udozo collection accounts are not open in your country yet.');
    if (blocked === 'plan') throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'plan_feature_required', 'Collection accounts come with Premium and Multi-shop. Change plan to ask for one.');
    if (blocked === 'settlement_account') throw conflict('settlement_account_required', 'Choose the bank account your collections are paid to first.', 'settlement_bank_account_id');
    const bvn = input.bvn?.replace(/\s/g, '') || null;
    if (account.mode === 'live') {
      // The same checks as paying money out: the settlement goes to their bank.
      await this.cash.requireCashOut(owner);
      if (account.country === 'NG' && !bvn) throw invalid('parameter_missing', 'Give your BVN: the banks need it to open the account. Udozo passes it on and never keeps it.', 'bvn');
    }
    if (bvn && !/^\d{11}$/.test(bvn)) throw invalid('parameter_invalid', 'A BVN is 11 digits.', 'bvn');
    const providers = this.providers.reservedAccounts(account.mode, account.country, account.currency);

    let row = await this.prisma.posCollectionAccount.findFirst({ where: { tillId: till.id, status: { in: ['opening', 'active'] } } });
    if (row?.status === 'active') return this.presentAccount(row);
    if (!row) {
      const id = randomUUID();
      try {
        row = await this.prisma.posCollectionAccount.create({ data: { id, accountId: account.id, shopId: till.shopId, tillId: till.id, mode: account.mode, currency: account.currency, reference: collectionReference(account.mode, id) } });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        row = await this.prisma.posCollectionAccount.findFirstOrThrow({ where: { tillId: till.id, status: { in: ['opening', 'active'] } } });
        if (row.status === 'active') return this.presentAccount(row);
      }
    }
    const now = new Date();
    const claimed = await this.prisma.posCollectionAccount.updateMany({
      where: { id: row.id, status: 'opening', OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - collectionClaimMs) } }] },
      data: { claimedAt: now, attempts: { increment: 1 } },
    });
    if (!claimed.count) throw conflict('collection_account_in_progress', 'This till’s account is being opened. Look again in a minute.');

    const ask = {
      reference: row.reference,
      currency: account.currency,
      email: owner.email,
      name: text(till.shop.name, 60) ?? owner.name,
      ...(bvn ? { bvn } : {}),
      ...(owner.firstName ? { firstName: owner.firstName } : {}),
      ...(owner.lastName ? { lastName: owner.lastName } : {}),
      ...(owner.phone && owner.phoneVerifiedAt ? { phone: owner.phone } : {}),
    };
    let lastError: string | null = null;
    for (const provider of providers) {
      try {
        const [details] = await provider.createReservedAccount(ask);
        if (!details) throw new ProviderError(provider.name, 'The bank gave no account number.', false);
        const opened = await this.prisma.posCollectionAccount.update({
          where: { id: row.id },
          data: { status: 'active', provider: provider.name, providerAccountId: details.providerAccountId ?? null, bankName: details.bankName.slice(0, 120), accountNumber: details.accountNumber.slice(0, 20), accountName: details.accountName.slice(0, 120), openedAt: new Date(), claimedAt: null, lastError: null },
        });
        return this.presentAccount(opened);
      } catch (error) {
        lastError = (error instanceof Error ? error.message : 'The bank could not be reached.').slice(0, 300);
        if (error instanceof ProviderError && error.definite) continue;
        // Unclear: the bank may have opened it, so nothing else is asked; a transfer to it is credited by its reference.
        await this.prisma.posCollectionAccount.update({ where: { id: row.id }, data: { claimedAt: null, lastError } });
        this.logger.warn({ err: error, collectionAccountId: row.id, provider: provider.name }, 'Collection account outcome unclear');
        throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'collection_account_pending', 'The bank has not answered yet. Try again in a minute.');
      }
    }
    await this.prisma.posCollectionAccount.update({ where: { id: row.id }, data: { status: 'refused', claimedAt: null, lastError } });
    throw conflict('collection_account_refused', 'The banks could not open an account for this till. Check your details and try again, or ask Udozo for help.');
  }

  /** Closes a till's account: no new sales wait on it. A transfer still arriving is credited and settled, never lost. */
  async closeAccount(owner: CustomerWithStore, id: string) {
    const account = await this.sales.account(owner);
    const row = await this.prisma.posCollectionAccount.findFirst({ where: { id, accountId: account.id } });
    if (!row) throw notFound('collection account');
    await this.prisma.$transaction([
      this.prisma.posCollectionAccount.updateMany({ where: { id, status: { in: ['opening', 'active'] } }, data: { status: 'closed', closedAt: new Date(), claimedAt: null } }),
      this.prisma.posTransferRequest.updateMany({ where: { collectionAccountId: id, status: 'waiting' }, data: { status: 'cancelled' } }),
    ]);
    return this.presentAccount(await this.prisma.posCollectionAccount.findUniqueOrThrow({ where: { id } }));
  }

  /** The sandbox only: a made-up transfer into the account, credited as a real one is. */
  async simulate(owner: CustomerWithStore, id: string, input: { amount: number; payer_name?: string | null }) {
    const account = await this.sales.account(owner);
    if (account.mode !== 'test') throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'test_mode_only', 'Only sandbox accounts take made-up transfers.');
    const row = await this.prisma.posCollectionAccount.findFirst({ where: { id, accountId: account.id, status: 'active' } });
    if (!row) throw notFound('collection account');
    if (!Number.isSafeInteger(input.amount) || input.amount < 1) throw invalid('parameter_invalid', 'Give the amount in minor units.', 'amount');
    const transaction = randomUUID();
    await this.payments.recordDeposit('sandbox', {
      status: 'succeeded',
      providerTransactionId: transaction,
      reference: row.reference,
      amount: BigInt(input.amount),
      currency: row.currency,
      fee: 0n,
      ...(text(input.payer_name, 120) ? { payerName: text(input.payer_name, 120)! } : {}),
    });
    const collection = await this.prisma.posCollection.findUnique({ where: { provider_providerTransactionId: { provider: 'sandbox', providerTransactionId: transaction } }, include: collectionInclude });
    if (!collection) throw conflict('collection_unrecorded', 'The test transfer was not recorded.');
    return this.presentCollection(collection);
  }

  // ---- The till ----

  /**
   * The till asks for the rest of a basket by transfer into its collection account: checked as a sale would be, nothing
   * taken. The till shows the bank, number and name; the transfer for exactly this amount makes the sale. Asking again
   * at the same till replaces the request waiting there, so a transfer only ever pays the basket on the counter.
   */
  async ask(owner: CustomerWithStore, input: TransferRequestInput, options: PosSellOptions = {}) {
    const account = await this.sales.account(owner);
    const till = await this.sales.till(account.id, input.till_id);
    this.sales.checkShape(input);
    if (!Number.isSafeInteger(input.transfer_amount) || input.transfer_amount < 1) throw invalid('parameter_invalid', 'Say how much is paid by transfer.', 'transfer_amount');
    const amount = BigInt(input.transfer_amount);
    const collection = await this.prisma.posCollectionAccount.findFirst({ where: { tillId: till.id, status: 'active' } });
    if (!collection) throw conflict('collection_account_missing', 'This till has no Udozo collection account. Ask for one under Payments, or take another payment method.');
    if (await this.prisma.posSale.findUnique({ where: { accountId_clientSaleId: { accountId: account.id, clientSaleId: input.client_sale_id } }, select: { id: true } })) {
      throw conflict('sale_exists', 'This basket is already a sale. Start a new sale.', 'client_sale_id');
    }
    const built = await this.prisma.$transaction(tx => this.sales.build(tx, { account, till, ownerId: owner.id, input, transfer: amount, discount: options.discount }));
    const by = options.by ?? ownerBy(owner);
    const basket: Basket = {
      client_sale_id: input.client_sale_id,
      lines: input.lines.map(line => ({ listing_id: line.listing_id, quantity: line.quantity, ...(line.discount ? { discount: line.discount } : {}) })),
      ...(input.discount ? { discount: input.discount } : {}),
      payments: input.payments,
      expected_total: input.expected_total,
      ...(input.note ? { note: input.note } : {}),
      ...(input.client_created_at ? { client_created_at: input.client_created_at } : {}),
    };
    const now = new Date();
    const row = await this.prisma.$transaction(async tx => {
      await tx.posTransferRequest.updateMany({ where: { tillId: till.id, status: 'waiting' }, data: { status: 'cancelled' } });
      return tx.posTransferRequest.create({
        data: {
          accountId: account.id,
          shopId: till.shopId,
          tillId: till.id,
          collectionAccountId: collection.id,
          clientSaleId: input.client_sale_id,
          mode: account.mode,
          currency: account.currency,
          amountMinor: amount,
          totalMinor: built.totals.total,
          basket: basket as unknown as Prisma.InputJsonValue,
          soldByCustomerId: by.customerId,
          soldByName: by.name,
          soldByStaffId: by.staffId,
          customerId: input.customer_id ?? null,
          expiresAt: new Date(now.getTime() + transferRequestMs),
        },
      });
    });
    return this.presentRequest(row, collection);
  }

  async request(owner: CustomerWithStore, id: string) {
    const account = await this.sales.account(owner);
    const row = await this.prisma.posTransferRequest.findFirst({ where: { id, accountId: account.id }, include: { collectionAccount: true } });
    if (!row) throw notFound('transfer request');
    return this.presentRequest(await this.expire(row), row.collectionAccount);
  }

  async cancel(owner: CustomerWithStore, id: string) {
    const account = await this.sales.account(owner);
    await this.prisma.posTransferRequest.updateMany({ where: { id, accountId: account.id, status: 'waiting' }, data: { status: 'cancelled' } });
    return this.request(owner, id);
  }

  private async expire<T extends PosTransferRequest>(row: T): Promise<T> {
    if (row.status !== 'waiting' || row.expiresAt > new Date()) return row;
    await this.prisma.posTransferRequest.updateMany({ where: { id: row.id, status: 'waiting' }, data: { status: 'expired' } });
    return { ...row, status: 'expired' };
  }

  // ---- Transfers coming in ----

  /**
   * A confirmed transfer (already re-read from the gateway by PaymentsService) into a collection account: credited
   * once per gateway transaction, then used for the sale waiting at its till. Null for a reference that is not one of
   * ours, so the payments code treats it as unknown; a transfer in another currency is never credited here.
   */
  async deposit(provider: string, result: ChargeResult): Promise<{ credited: boolean; reason?: string } | null> {
    const target = await this.prisma.posCollectionAccount.findUnique({ where: { reference: result.reference }, include: { account: { select: { id: true, customerId: true, country: true } }, till: { select: { name: true } } } });
    if (!target || result.currency !== target.currency) return null;
    // Sandbox money never reaches a live account, nor a gateway's a sandbox one.
    if ((target.mode === 'test') !== (provider === 'sandbox')) return { credited: false, reason: 'wrong_mode' };
    if (result.amount <= 0n) return { credited: false, reason: 'no_amount' };
    const existing = await this.prisma.posCollection.findUnique({ where: { provider_providerTransactionId: { provider, providerTransactionId: result.providerTransactionId } }, select: { id: true } });
    if (existing) return { credited: false, reason: 'duplicate' };

    const settings = await this.prisma.posMarketSettings.findUnique({ where: { country: target.account.country } });
    const fee = collectionFee(result.amount, result.fee, settings);
    const id = randomUUID();
    const lines = [
      ...(result.amount - fee.gateway > 0n ? [{ account: { kind: 'provider_balance' as const, currency: target.currency, provider }, debit: result.amount - fee.gateway }] : []),
      ...(fee.gateway > 0n ? [{ account: { kind: 'processing_fees' as const, currency: target.currency, provider }, debit: fee.gateway }] : []),
      ...(fee.collected > 0n ? [{ account: { kind: 'pos_collected' as const, currency: target.currency, customerId: target.account.customerId }, credit: fee.collected }] : []),
      ...(fee.fee > 0n ? [{ account: { kind: 'pos_revenue' as const, currency: target.currency }, credit: fee.fee }] : []),
    ];
    const entry = await this.ledger.prepare({
      mode: target.mode,
      type: 'pos_collection',
      reference: `pos_collection:${provider}:${result.providerTransactionId}`,
      description: `Transfer into ${target.bankName ?? 'a Udozo POS'} ${target.accountNumber ?? 'collection account'}`,
      metadata: { pos_collection_id: id, provider, provider_transaction_id: result.providerTransactionId },
      lines,
    });
    try {
      await this.prisma.$transaction(async tx => {
        await tx.posCollection.create({
          data: {
            id,
            accountId: target.accountId,
            collectionAccountId: target.id,
            shopId: target.shopId,
            tillId: target.tillId,
            mode: target.mode,
            currency: target.currency,
            provider,
            providerTransactionId: result.providerTransactionId,
            amountMinor: result.amount,
            gatewayFeeMinor: fee.gateway,
            feeMinor: fee.fee,
            collectedMinor: fee.collected,
            payerName: text(result.payerName, 120),
          },
        });
        await this.ledger.write(tx, entry);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { credited: false, reason: 'duplicate' };
      throw error;
    }

    const matched = await this.match(id);
    if (!matched) {
      void this.inbox
        .customer({ customerId: target.account.customerId, storeId: houseStoreId }, 'customer.pos.collection', {
          subject: `pos_collection:${id}`,
          title: `${formatMoney(result.amount, target.currency)} came into ${target.till?.name ?? 'a till'}'s account`,
          body: 'It matched no sale waiting at the till. Attach it to the sale it was for, or keep it: it is paid to your bank with the day’s collections either way.',
          link: '/app/collections',
          mode: target.mode,
        })
        .catch(() => undefined);
    }
    return { credited: true };
  }

  /** Pays the sale waiting at the collection's till for exactly its amount, if there is one. */
  private async match(collectionId: string) {
    const collection = await this.prisma.posCollection.findUniqueOrThrow({ where: { id: collectionId } });
    if (collection.status !== 'unmatched' || !collection.collectionAccountId) return false;
    const request = await this.prisma.posTransferRequest.findFirst({ where: { collectionAccountId: collection.collectionAccountId, status: 'waiting', amountMinor: collection.amountMinor, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'asc' } });
    if (!request) return false;
    return this.pay(request, collection, null);
  }

  /**
   * The request's basket made into the sale, paid in part by the collection, in one transaction (both claimed first,
   * so neither pays twice). A basket that changed at the shop meanwhile fails the request; the money stays with the
   * owner as unmatched, never lost.
   */
  private async pay(request: PosTransferRequest, collection: PosCollection, decidedBy: string | null) {
    if (!request.tillId) {
      await this.prisma.posTransferRequest.updateMany({ where: { id: request.id, status: { in: ['waiting', 'expired'] } }, data: { status: 'failed', failure: 'The till was removed.' } });
      return false;
    }
    const account = await this.prisma.posAccount.findUniqueOrThrow({ where: { id: request.accountId }, include: { plan: true } });
    const till = await this.sales.till(account.id, request.tillId);
    const input: SaleInput = { ...(request.basket as unknown as Basket), till_id: request.tillId };
    const number = transferNumber(request.number);
    const now = new Date();
    try {
      await this.prisma.$transaction(async tx => {
        const claimedRequest = await tx.posTransferRequest.updateMany({ where: { id: request.id, status: { in: ['waiting', 'expired'] } }, data: { status: 'paid', paidAt: now } });
        const claimedCollection = await tx.posCollection.updateMany({ where: { id: collection.id, status: 'unmatched' }, data: { status: 'matched', transferRequestId: request.id, decidedByName: decidedBy } });
        if (!claimedRequest.count || !claimedCollection.count) throw conflict('transfer_closed', 'This transfer or sale was settled already.');
        const built = await this.sales.build(tx, { account, till, ownerId: account.customerId, input, transfer: request.amountMinor });
        const saleId = await this.sales.record(tx, {
          account,
          till,
          soldBy: { customerId: request.soldByCustomerId, staffId: request.soldByStaffId, name: request.soldByName },
          input,
          built,
          now,
          transferRequest: { id: request.id, reference: collection.payerName ? `${number} · ${collection.payerName}` : number },
        });
        await tx.posTransferRequest.update({ where: { id: request.id }, data: { saleId } });
        await tx.posCollection.update({ where: { id: collection.id }, data: { saleId } });
      });
      return true;
    } catch (error) {
      if ((error instanceof ApiError && basketCodes.has(error.code)) || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        const why = error instanceof ApiError ? error.message : 'This basket is already a sale.';
        await this.prisma.posTransferRequest.updateMany({ where: { id: request.id, status: { in: ['waiting', 'expired'] } }, data: { status: 'failed', failure: why.slice(0, 300) } });
        return false;
      }
      if (error instanceof ApiError && error.code === 'transfer_closed') return false;
      throw error;
    }
  }

  // ---- The owner's collections ----

  async collections(owner: CustomerWithStore, filter: { status?: 'matched' | 'unmatched' | 'kept'; limit?: number; offset?: number }) {
    const account = await this.sales.account(owner);
    const where: Prisma.PosCollectionWhereInput = { accountId: account.id, ...(filter.status ? { status: filter.status } : {}) };
    const take = filter.limit ?? 25;
    const offset = filter.offset ?? 0;
    const [rows, total] = await Promise.all([
      this.prisma.posCollection.findMany({ where, include: collectionInclude, orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }], skip: offset, take }),
      this.prisma.posCollection.count({ where }),
    ]);
    // What an unmatched transfer could be attached to: the sales waiting (or run out of time) for that amount.
    const amounts = [...new Set(rows.filter(row => row.status === 'unmatched').map(row => row.amountMinor))];
    const waiting = amounts.length
      ? await this.prisma.posTransferRequest.findMany({ where: { accountId: account.id, status: { in: ['waiting', 'expired'] }, amountMinor: { in: amounts }, createdAt: { gt: new Date(Date.now() - 2 * 86_400_000) } }, include: { till: { select: { name: true } } }, orderBy: { createdAt: 'desc' } })
      : [];
    return {
      object: 'list' as const,
      currency: account.currency,
      total,
      has_more: offset + take < total,
      data: rows.map(row => ({
        ...this.presentCollection(row),
        attachable:
          row.status === 'unmatched'
            ? waiting.filter(item => item.amountMinor === row.amountMinor).map(item => ({ id: item.id, number: transferNumber(item.number), till: item.till?.name ?? null, status: item.status, created_at: item.createdAt.toISOString() }))
            : [],
      })),
    };
  }

  /** Attaches an unmatched transfer to the sale it was for (waiting, or run out of time), making the sale. */
  async attach(owner: CustomerWithStore, id: string, requestId: string, by: PosBy = ownerBy(owner)) {
    const account = await this.sales.account(owner);
    const collection = await this.prisma.posCollection.findFirst({ where: { id, accountId: account.id } });
    if (!collection) throw notFound('transfer');
    if (collection.status !== 'unmatched') throw conflict('collection_decided', 'This transfer is settled already.');
    const request = await this.prisma.posTransferRequest.findFirst({ where: { id: requestId, accountId: account.id } });
    if (!request) throw notFound('transfer request');
    if (!['waiting', 'expired'].includes(request.status)) throw conflict('transfer_closed', 'That sale was paid or cancelled already. Ring it up again, then attach the transfer.');
    if (request.amountMinor !== collection.amountMinor) throw conflict('amount_mismatch', `The transfer is ${formatMoney(collection.amountMinor, collection.currency)} and the sale asked ${formatMoney(request.amountMinor, request.currency)}.`, 'transfer_request_id');
    const paid = await this.pay(request, collection, by.name);
    if (!paid) {
      const after = await this.prisma.posTransferRequest.findUniqueOrThrow({ where: { id: request.id } });
      throw conflict('basket_changed', after.failure ?? 'The sale could not be made. Ring it up again, then keep the transfer.');
    }
    return this.presentCollection(await this.prisma.posCollection.findUniqueOrThrow({ where: { id }, include: collectionInclude }));
  }

  /** The owner says an unmatched transfer is for no sale: it is settled all the same (refunding the payer is the shop's). */
  async keep(owner: CustomerWithStore, id: string, note: string | null | undefined, by: PosBy = ownerBy(owner)) {
    const account = await this.sales.account(owner);
    const updated = await this.prisma.posCollection.updateMany({ where: { id, accountId: account.id, status: 'unmatched' }, data: { status: 'kept', note: text(note, 300), decidedByName: by.name } });
    if (!updated.count) {
      if (!(await this.prisma.posCollection.findFirst({ where: { id, accountId: account.id }, select: { id: true } }))) throw notFound('transfer');
      throw conflict('collection_decided', 'This transfer is settled already.');
    }
    return this.presentCollection(await this.prisma.posCollection.findUniqueOrThrow({ where: { id }, include: collectionInclude }));
  }

  async settlementList(owner: CustomerWithStore, filter: { limit?: number; offset?: number }) {
    const account = await this.sales.account(owner);
    const take = filter.limit ?? 25;
    const offset = filter.offset ?? 0;
    const [rows, total] = await Promise.all([
      this.prisma.posSettlement.findMany({ where: { accountId: account.id }, include: settlementInclude, orderBy: [{ day: 'desc' }], skip: offset, take }),
      this.prisma.posSettlement.count({ where: { accountId: account.id } }),
    ]);
    return { object: 'list' as const, currency: account.currency, total, has_more: offset + take < total, data: rows.map(row => this.presentSettlement(row)) };
  }

  /** One settlement with every transfer in it: the statement. */
  async settlement(owner: CustomerWithStore, id: string) {
    const account = await this.sales.account(owner);
    const row = await this.prisma.posSettlement.findFirst({ where: { id, accountId: account.id }, include: { ...settlementInclude, items: { include: collectionInclude, orderBy: { receivedAt: 'asc' } } } });
    if (!row) throw notFound('settlement');
    return { ...this.presentSettlement(row), items: row.items.map(item => this.presentCollection(item)) };
  }

  // ---- Settlement ----

  /**
   * The `pos` job: for each owner with unsettled collections, on a working day of their market, settles what came in
   * before that day began. One settlement per owner and day, never twice: its collections are claimed and its entry
   * written in one transaction; the payout to their bank follows, and anything stopping it (a hold, no bank account,
   * a check a payout needs, an amount below the market's minimum) leaves the money in their Udozo payouts, with why.
   */
  async run(now = new Date()) {
    const owners = await this.prisma.posCollection.groupBy({ by: ['accountId'], where: { settlementId: null } });
    let settled = 0;
    let kept = 0;
    let held = 0;
    for (const { accountId } of owners) {
      const account = await this.prisma.posAccount.findUnique({ where: { id: accountId } });
      if (!account) continue;
      if (account.settlementHeldAt) {
        held++;
        continue;
      }
      const zone = marketZone(account.country);
      const day = zonedDay(now, zone);
      if (!isWorkingDay(day)) continue;
      try {
        const outcome = await this.settle(account, day, zonedDayStart(day, zone));
        if (outcome === 'paying') settled++;
        else if (outcome === 'kept') kept++;
      } catch (error) {
        this.logger.error({ err: error, accountId }, 'POS settlement failed; tried again next run');
      }
    }
    return { settled, kept, held };
  }

  private async settle(account: { id: string; customerId: string; mode: Account['mode']; currency: string; country: string; settlementBankAccountId: string | null }, day: string, before: Date) {
    const rows = await this.prisma.posCollection.findMany({ where: { accountId: account.id, settlementId: null, receivedAt: { lt: before } }, select: { id: true, amountMinor: true, feeMinor: true, collectedMinor: true } });
    if (!rows.length) return null;
    const gross = rows.reduce((sum, row) => sum + row.amountMinor, 0n);
    const fees = rows.reduce((sum, row) => sum + row.feeMinor, 0n);
    const amount = rows.reduce((sum, row) => sum + row.collectedMinor, 0n);
    const id = randomUUID();
    const entry =
      amount > 0n
        ? await this.ledger.prepare({
            mode: account.mode,
            type: 'pos_settlement',
            reference: `pos_settlement:${account.id}:${day}`,
            description: `Udozo POS collections settled on ${day}`,
            metadata: { pos_settlement_id: id },
            lines: [
              { account: { kind: 'pos_collected', currency: account.currency, customerId: account.customerId }, debit: amount },
              { account: { kind: 'customer_withdrawable', currency: account.currency, customerId: account.customerId }, credit: amount },
            ],
          })
        : null;
    try {
      await this.prisma.$transaction(async tx => {
        await tx.posSettlement.create({ data: { id, accountId: account.id, mode: account.mode, currency: account.currency, day: new Date(`${day}T00:00:00Z`), collections: rows.length, grossMinor: gross, feesMinor: fees, amountMinor: amount, status: 'kept' } });
        const claimed = await tx.posCollection.updateMany({ where: { id: { in: rows.map(row => row.id) }, settlementId: null }, data: { settlementId: id } });
        if (claimed.count !== rows.length) throw conflict('settlement_raced', 'Another run settled these.');
        if (entry) await this.ledger.write(tx, entry);
      });
    } catch (error) {
      // Settled already today (or by another run at once): nothing more.
      if ((error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') || (error instanceof ApiError && error.code === 'settlement_raced')) return null;
      throw error;
    }

    const keptReason = await this.payOut(account, id, amount);
    const total = formatMoney(amount, account.currency);
    void this.inbox
      .customer({ customerId: account.customerId, storeId: houseStoreId }, 'customer.pos.settlement', {
        subject: `pos_settlement:${id}`,
        title: keptReason ? `${total} of your collections is in your Udozo payouts` : `${total} of your collections is on its way to your bank`,
        body: keptReason ? `${keptReason} Pay it out from Payouts on udozo.com.` : `${rows.length} ${rows.length === 1 ? 'transfer' : 'transfers'} into your tills’ accounts, less Udozo’s fee.`,
        link: `/app/collections/settlements/${id}`,
        mode: account.mode,
      })
      .catch(() => undefined);
    if (keptReason && amount > 0n && account.mode === 'live') {
      void this.inbox
        .admins('admin.pos.settlement_kept', { subject: `pos_settlement:${id}`, title: `A Udozo POS settlement of ${total} was not paid out`, body: keptReason, link: `/pos/collections` })
        .catch(() => undefined);
    }
    return keptReason ? ('kept' as const) : ('paying' as const);
  }

  /** Sends a settled amount to the owner's bank as a customer payout; returns why not, leaving it in their Udozo payouts. */
  private async payOut(account: { id: string; customerId: string; settlementBankAccountId: string | null }, settlementId: string, amount: bigint): Promise<string | null> {
    let reason: string | null = null;
    let payoutId: string | null = null;
    if (amount <= 0n) reason = 'Udozo’s fees took the whole amount.';
    else if (!account.settlementBankAccountId) reason = 'No bank account is chosen for your collections.';
    else {
      try {
        const owner = await this.prisma.customer.findUniqueOrThrow({ where: { id: account.customerId }, include: customerInclude });
        const context = await this.cash.requireCashOut(owner as CustomerWithStore);
        const payout = await this.payouts.create(context, { amount: Number(amount), bank_account_id: account.settlementBankAccountId });
        payoutId = payout.id;
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        reason = error.message;
      }
    }
    await this.prisma.posSettlement.update({ where: { id: settlementId }, data: payoutId ? { status: 'paying', payoutId, bankAccountId: account.settlementBankAccountId } : { status: 'kept', keptReason: reason?.slice(0, 300) ?? null } });
    return payoutId ? null : reason;
  }

  // ---- Udozo's admins ----

  async adminCollections(filter: { account?: string; status?: string; limit?: number; offset?: number }) {
    const where: Prisma.PosCollectionWhereInput = { ...(filter.account ? { accountId: filter.account } : {}), ...(filter.status ? { status: filter.status } : {}) };
    const take = filter.limit ?? 50;
    const offset = filter.offset ?? 0;
    const [rows, total, sums] = await Promise.all([
      this.prisma.posCollection.findMany({ where, include: { ...collectionInclude, account: { select: { id: true, shops: { select: { name: true }, orderBy: { position: 'asc' }, take: 1 } } } }, orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }], skip: offset, take }),
      this.prisma.posCollection.count({ where }),
      this.prisma.posCollection.groupBy({ by: ['currency', 'mode'], where, _sum: { amountMinor: true, feeMinor: true } }),
    ]);
    return {
      object: 'list' as const,
      total,
      has_more: offset + take < total,
      totals: sums.map(sum => ({ currency: sum.currency, mode: sum.mode, amount: Number(sum._sum.amountMinor ?? 0n), fees: Number(sum._sum.feeMinor ?? 0n) })),
      data: rows.map(row => ({ ...this.presentCollection(row), account: { id: row.account.id, shop: row.account.shops[0]?.name ?? null } })),
    };
  }

  async adminAccount(accountId: string) {
    const account = await this.prisma.posAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'There is no such POS account.');
    const [accounts, settlements, balance, unmatched] = await Promise.all([
      this.prisma.posCollectionAccount.findMany({ where: { accountId }, include: { till: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.posSettlement.findMany({ where: { accountId }, include: settlementInclude, orderBy: { day: 'desc' }, take: 30 }),
      this.balance(account.customerId, account.mode, account.currency),
      this.prisma.posCollection.count({ where: { accountId, status: 'unmatched' } }),
    ]);
    return {
      object: 'pos_account_collections' as const,
      currency: account.currency,
      collected: Number(balance),
      unmatched,
      held: account.settlementHeldAt ? { at: account.settlementHeldAt.toISOString(), reason: account.settlementHoldReason, by: account.settlementHeldBy } : null,
      accounts: accounts.map(row => ({ ...this.presentAccount(row), till: row.till?.name ?? null, attempts: row.attempts, last_error: row.lastError })),
      settlements: settlements.map(row => this.presentSettlement(row)),
    };
  }

  /** Holds or releases an owner's settlements (fraud, a dispute): collections keep coming in, nothing is paid out while held. */
  async hold(adminId: string | null, accountId: string, input: { held: boolean; reason: string }) {
    const admin = { id: adminId, name: (adminId ? (await this.prisma.user.findUnique({ where: { id: adminId }, select: { name: true } }))?.name : null) ?? 'Udozo' };
    const before = await this.prisma.posAccount.findUnique({ where: { id: accountId }, select: { settlementHeldAt: true, settlementHoldReason: true } });
    if (!before) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'There is no such POS account.');
    const reason = text(input.reason, 300);
    if (!reason) throw invalid('parameter_missing', 'Say why.', 'reason');
    const after = input.held ? { settlementHeldAt: new Date(), settlementHoldReason: reason, settlementHeldBy: admin.name.slice(0, 120) } : { settlementHeldAt: null, settlementHoldReason: null, settlementHeldBy: null };
    await this.prisma.posAccount.update({ where: { id: accountId }, data: after });
    await this.audit.record({ actorId: admin.id, action: input.held ? 'pos.settlements_held' : 'pos.settlements_released', targetType: 'pos_account', targetId: accountId, before, after: { ...after, reason } });
    return this.adminAccount(accountId);
  }

  async marketSettings() {
    const [countries, rows] = await Promise.all([this.prisma.country.findMany({ select: { code: true, name: true, currency: true }, orderBy: { name: 'asc' } }), this.prisma.posMarketSettings.findMany()]);
    const byCountry = new Map(rows.map(row => [row.country, row]));
    return {
      object: 'list' as const,
      data: countries.map(country => {
        const row = byCountry.get(country.code);
        return { country: country.code, name: country.name, currency: country.currency, collection_fee_bps: row?.collectionFeeBps ?? 0, collection_fee_min: Number(row?.collectionFeeMinMinor ?? 0n), collection_fee_cap: row?.collectionFeeCapMinor === null || row?.collectionFeeCapMinor === undefined ? null : Number(row.collectionFeeCapMinor) };
      }),
    };
  }

  async setMarketSettings(adminId: string | null, country: string, input: { collection_fee_bps: number; collection_fee_min: number; collection_fee_cap: number | null }) {
    if (!(await this.prisma.country.findUnique({ where: { code: country }, select: { code: true } }))) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'There is no such market.');
    if (input.collection_fee_cap !== null && input.collection_fee_cap < input.collection_fee_min) throw invalid('parameter_invalid', 'The cap must be at least the minimum.', 'collection_fee_cap');
    const before = await this.prisma.posMarketSettings.findUnique({ where: { country } });
    const data = { collectionFeeBps: input.collection_fee_bps, collectionFeeMinMinor: BigInt(input.collection_fee_min), collectionFeeCapMinor: input.collection_fee_cap === null ? null : BigInt(input.collection_fee_cap) };
    await this.prisma.posMarketSettings.upsert({ where: { country }, create: { country, ...data }, update: data });
    await this.audit.record({
      actorId: adminId,
      action: 'pos.collection_fee_changed',
      targetType: 'pos_market',
      targetId: country,
      before: before ? { collection_fee_bps: before.collectionFeeBps, collection_fee_min: Number(before.collectionFeeMinMinor), collection_fee_cap: before.collectionFeeCapMinor === null ? null : Number(before.collectionFeeCapMinor) } : null,
      after: input,
    });
    return this.marketSettings();
  }

  // ---- Presenting ----

  private presentAccount(row: PosCollectionAccount) {
    return {
      object: 'pos_collection_account' as const,
      id: row.id,
      status: row.status,
      till_id: row.tillId,
      bank_name: row.bankName,
      account_number: row.accountNumber,
      account_name: row.accountName,
      currency: row.currency,
      opened_at: iso(row.openedAt),
      closed_at: iso(row.closedAt),
      created_at: row.createdAt.toISOString(),
    };
  }

  private presentRequest(row: PosTransferRequest, collection: PosCollectionAccount) {
    return {
      object: 'pos_transfer_request' as const,
      id: row.id,
      number: transferNumber(row.number),
      status: row.status,
      currency: row.currency,
      amount: Number(row.amountMinor),
      total: Number(row.totalMinor),
      client_sale_id: row.clientSaleId,
      /** Where the buyer sends it: the till's collection account. */
      pay_to: { bank_name: collection.bankName, account_number: collection.accountNumber, account_name: collection.accountName },
      failure: row.failure,
      expires_at: row.expiresAt.toISOString(),
      paid_at: iso(row.paidAt),
      sale_id: row.saleId,
    };
  }

  private presentCollection(row: CollectionRow) {
    return {
      object: 'pos_collection' as const,
      id: row.id,
      number: collectionNumber(row.number),
      status: row.status,
      mode: row.mode,
      currency: row.currency,
      amount: Number(row.amountMinor),
      fee: Number(row.feeMinor),
      collected: Number(row.collectedMinor),
      payer_name: row.payerName,
      till: row.till ? { id: row.tillId, name: row.till.name } : null,
      sale: row.sale ? { id: row.sale.id, number: row.sale.number } : null,
      settlement: row.settlement ? { id: row.settlement.id, number: settlementNumber(row.settlement.number) } : null,
      note: row.note,
      decided_by: row.decidedByName,
      received_at: row.receivedAt.toISOString(),
    };
  }

  private presentSettlement(row: SettlementRow) {
    return {
      object: 'pos_settlement' as const,
      id: row.id,
      number: settlementNumber(row.number),
      day: row.day.toISOString().slice(0, 10),
      mode: row.mode,
      currency: row.currency,
      collections: row.collections,
      gross: Number(row.grossMinor),
      fees: Number(row.feesMinor),
      amount: Number(row.amountMinor),
      /** `paying` (sent to the bank: the payout says where it stands) or `kept` (in their Udozo payouts, with why). */
      status: row.status,
      kept_reason: row.keptReason,
      bank_account: row.bankAccount ? { bank_name: row.bankAccount.bankName, last4: row.bankAccount.accountNumberLast4 } : null,
      payout: row.payout ? { id: row.payout.id, status: row.payout.status, completed_at: iso(row.payout.completedAt) } : null,
      created_at: row.createdAt.toISOString(),
    };
  }
}

const collectionInclude = { till: { select: { name: true } }, sale: { select: { id: true, number: true } }, settlement: { select: { id: true, number: true } } } satisfies Prisma.PosCollectionInclude;
type CollectionRow = Prisma.PosCollectionGetPayload<{ include: typeof collectionInclude }>;
const settlementInclude = { bankAccount: { select: { bankName: true, accountNumberLast4: true } }, payout: { select: { id: true, status: true, completedAt: true } } } satisfies Prisma.PosSettlementInclude;
type SettlementRow = Prisma.PosSettlementGetPayload<{ include: typeof settlementInclude }>;
