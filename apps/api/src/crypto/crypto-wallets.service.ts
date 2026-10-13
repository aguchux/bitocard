import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { StoreSellers } from '../checkout/store-sellers.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AccountKind, CryptoAsset, CryptoFreeze, LedgerMode, Reseller } from '../generated/prisma/client.js';
import { IdentityService } from '../identity/identity.service.js';
import { type AccountRef, LedgerService } from '../ledger/ledger.service.js';
import { minor } from '../ledger/mode.js';
import { testModeOnly } from '../payments/payments.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { fromUnits, toUnits } from './amounts.js';

export const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
export const assetUnavailable = (param = 'asset') => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'asset_unavailable', 'This asset is not available.', param);
export const cryptoFrozen = () =>
  new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'crypto_account_frozen', 'Your crypto account is frozen. Contact support to find out why.');

/** Who a customer is in the crypto market: their store's mode, the seller behind it and their country's currency. */
export type CryptoContext = { customer: CustomerWithStore; mode: LedgerMode; seller: Reseller; country: string; currency: string };

const cryptoKinds = ['crypto_wallet', 'crypto_locked', 'crypto_frozen', 'crypto_withdrawing'] as const satisfies AccountKind[];
const fiatKinds = ['customer_withdrawable', 'p2p_fiat_locked', 'customer_wallet'] as const satisfies AccountKind[];

export function presentFreeze(freeze: CryptoFreeze, asset: Pick<CryptoAsset, 'decimals'>) {
  return {
    object: 'crypto_freeze' as const,
    id: freeze.id,
    mode: freeze.mode,
    asset: freeze.asset,
    amount: fromUnits(freeze.amount, asset.decimals),
    reason: freeze.reason,
    status: freeze.status,
    resolve_note: freeze.resolveNote,
    created_at: freeze.createdAt.toISOString(),
    resolved_at: freeze.resolvedAt?.toISOString() ?? null,
  };
}

/**
 * Customers' crypto wallets: one ledger account per asset for what they can spend (`crypto_wallet`), what is locked
 * in the market (`crypto_locked`) and what an admin froze (`crypto_frozen`), all in the asset's base units and never
 * below zero. BitoCard's side is `crypto_custody` (what it holds for them). Their P2P sale money is
 * `customer_withdrawable` in their country's currency. Gated by the `crypto_wallets` switch (store's seller, then
 * country, then global; off by default) and, live, by the customer's identity check.
 */
@Injectable()
export class CryptoWalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly stores: StoreSellers,
    private readonly settings: SettingsService,
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
  ) {}

  // -- Assets ---------------------------------------------------------------------------------------------------

  async assets(all = false) {
    return this.prisma.cryptoAsset.findMany({ where: all ? {} : { enabled: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
  }

  /** An enabled asset by code (any case). */
  async asset(code: string, param = 'asset') {
    const asset = await this.prisma.cryptoAsset.findUnique({ where: { code: code.toUpperCase() } });
    if (!asset?.enabled) throw assetUnavailable(param);
    return asset;
  }

  // -- Who may use crypto ---------------------------------------------------------------------------------------

  async context(customer: CustomerWithStore): Promise<CryptoContext> {
    const seller = await this.stores.sellerFor(customer);
    const market = await this.prisma.country.findUniqueOrThrow({ where: { code: seller.country! }, select: { code: true, currency: true } });
    return { customer, mode: this.stores.mode(customer.store), seller, country: market.code, currency: market.currency };
  }

  enabled(seller: Pick<Reseller, 'id'>) {
    return this.settings.isOn('crypto_wallets', seller.id);
  }

  /** Live crypto needs the customer's identity check (BVN in Nigeria, Didit elsewhere); the sandbox does not. */
  async verified(context: CryptoContext) {
    return context.mode === 'test' || this.identity.isCustomerVerified(context.seller.id, context.mode, context.customer.id);
  }

  /** The checks before any crypto action: email confirmed, crypto on for the store, identity checked live, not frozen. */
  async require(customer: CustomerWithStore) {
    if (!customer.emailVerifiedAt) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'email_not_verified', 'Confirm your email first: enter the code we emailed you.');
    }
    const context = await this.context(customer);
    if (!(await this.enabled(context.seller))) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'crypto_not_enabled', 'Crypto is not available in your country yet.');
    }
    const fresh = await this.prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, select: { cryptoFrozenAt: true } });
    if (fresh.cryptoFrozenAt) throw cryptoFrozen();
    if (!(await this.verified(context))) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'customer_verification_required', 'Verify your identity before using crypto.');
    }
    return context;
  }

  /**
   * The checks before paying P2P money out to a bank: email confirmed, identity checked (live) and not frozen. Not the
   * crypto switches: money a customer already has can always be paid out, even after crypto is switched off.
   */
  async requireCashOut(customer: CustomerWithStore) {
    if (!customer.emailVerifiedAt) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'email_not_verified', 'Confirm your email first: enter the code we emailed you.');
    }
    const context = await this.context(customer);
    const fresh = await this.prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, select: { cryptoFrozenAt: true } });
    if (fresh.cryptoFrozenAt) throw cryptoFrozen();
    if (!(await this.verified(context))) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'customer_verification_required', 'Verify your identity before paying money out.');
    }
    const verifiedName = context.mode === 'live' ? await this.identity.customerVerifiedName(context.seller.id, context.mode, customer.id) : null;
    return { customer, mode: context.mode, sellerId: context.seller.id, country: context.country, currency: context.currency, verifiedName };
  }

  // -- Balances -------------------------------------------------------------------------------------------------

  ref(customerId: string, kind: AccountKind, currency: string): AccountRef {
    return { kind, currency, customerId };
  }

  /** Every crypto and P2P cash balance the customer has in a mode, by kind and currency. */
  private async accounts(customerId: string, mode: LedgerMode) {
    const rows = await this.prisma.ledgerAccount.findMany({ where: { customerId, mode, kind: { in: [...cryptoKinds, ...fiatKinds] } }, select: { kind: true, currency: true, balanceMinor: true } });
    return (kind: AccountKind, currency: string) => rows.find(row => row.kind === kind && row.currency === currency)?.balanceMinor ?? 0n;
  }

  private async assetBalances(customerId: string, mode: LedgerMode, assets: CryptoAsset[]) {
    const balance = await this.accounts(customerId, mode);
    return assets.map(asset => {
      const available = balance('crypto_wallet', asset.code);
      const locked = balance('crypto_locked', asset.code);
      const frozen = balance('crypto_frozen', asset.code);
      const withdrawing = balance('crypto_withdrawing', asset.code);
      return {
        object: 'crypto_balance' as const,
        asset: asset.code,
        name: asset.name,
        decimals: asset.decimals,
        available: fromUnits(available, asset.decimals),
        locked: fromUnits(locked, asset.decimals),
        frozen: fromUnits(frozen, asset.decimals),
        /** On its way out in on-chain withdrawals (amount and fee), until each is sent or returned. */
        withdrawing: fromUnits(withdrawing, asset.decimals),
        total: fromUnits(available + locked + frozen + withdrawing, asset.decimals),
      };
    });
  }

  /** The customer's crypto wallets and P2P cash, with what they can do now. */
  async overview(customer: CustomerWithStore) {
    const context = await this.context(customer);
    const [enabled, p2p, verified, fresh, assets] = await Promise.all([
      this.enabled(context.seller),
      this.settings.isOn('p2p_trading', context.seller.id),
      this.verified(context),
      this.prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, select: { cryptoFrozenAt: true } }),
      this.assets(),
    ]);
    const balance = await this.accounts(customer.id, context.mode);
    return {
      object: 'crypto_wallets' as const,
      mode: context.mode,
      country: context.country,
      currency: context.currency,
      enabled,
      p2p_enabled: enabled && p2p,
      verified,
      frozen: Boolean(fresh.cryptoFrozenAt),
      assets: await this.assetBalances(customer.id, context.mode, assets),
      /** Money in the customer's country currency for P2P: sale proceeds (withdrawable), the wallet (top-ups) and what buy ads lock. */
      cash: {
        currency: context.currency,
        proceeds: minor(balance('customer_withdrawable', context.currency)),
        wallet: minor(balance('customer_wallet', context.currency)),
        locked: minor(balance('p2p_fiat_locked', context.currency)),
      },
    };
  }

  /** Sandbox stores only: test crypto into the customer's wallet (in place of an on-chain deposit). */
  async testDeposit(customer: CustomerWithStore, input: { asset: string; amount: string }) {
    const context = await this.require(customer);
    if (context.mode !== 'test') throw testModeOnly();
    const asset = await this.asset(input.asset);
    const amount = toUnits(input.amount, asset.decimals);
    if (amount <= 0n) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Enter an amount above zero.', 'amount');
    await this.credit(customer.id, 'test', asset, amount, `crypto_test_deposit:${randomUUID()}`, `Test ${asset.code} deposit`);
    return (await this.assetBalances(customer.id, 'test', [asset]))[0];
  }

  /** Crypto BitoCard holds for the customer, into their wallet. */
  private credit(customerId: string, mode: LedgerMode, asset: CryptoAsset, amount: bigint, reference: string, description: string) {
    return this.ledger.post({
      mode,
      type: 'crypto_deposit',
      reference,
      description,
      metadata: { asset: asset.code },
      lines: [
        { account: { kind: 'crypto_custody', currency: asset.code }, debit: amount },
        { account: this.ref(customerId, 'crypto_wallet', asset.code), credit: amount },
      ],
    });
  }

  /** What moved in and out of the customer's crypto wallets (this store's mode), newest first. */
  async transactions(customer: CustomerWithStore, query: { asset?: string; limit?: number; starting_after?: string }) {
    const limit = query.limit ?? 25;
    const mode = this.stores.mode(customer.store);
    const assets = new Map((await this.assets(true)).map(asset => [asset.code, asset]));
    const postings = await this.prisma.ledgerPosting.findMany({
      where: { account: { kind: { in: [...cryptoKinds] }, customerId: customer.id, mode, ...(query.asset ? { currency: query.asset.toUpperCase() } : {}) } },
      include: { entry: true, account: true },
      orderBy: [{ entry: { createdAt: 'desc' } }, { id: 'desc' }],
      take: limit + 1,
      ...(query.starting_after ? { cursor: { id: query.starting_after }, skip: 1 } : {}),
    });
    return {
      object: 'list' as const,
      data: postings.slice(0, limit).map(posting => {
        const decimals = assets.get(posting.account.currency)?.decimals ?? 8;
        const meta = (posting.entry.metadata ?? {}) as { trade_id?: string; ad_id?: string };
        return {
          object: 'crypto_transaction' as const,
          id: posting.id,
          type: posting.entry.type,
          /** available, locked, frozen or withdrawing: which part of the wallet moved. */
          balance: posting.account.kind.replace('crypto_', '').replace('wallet', 'available'),
          description: posting.entry.description,
          asset: posting.account.currency,
          // Customer accounts grow with credits (negative postings).
          amount: fromUnits(-posting.amountMinor, decimals),
          trade_id: meta.trade_id ?? null,
          ad_id: meta.ad_id ?? null,
          created_at: posting.entry.createdAt.toISOString(),
        };
      }),
      has_more: postings.length > limit,
    };
  }

  // -- Admin ----------------------------------------------------------------------------------------------------

  async setAsset(adminId: string | null, code: string, input: { enabled?: boolean; p2p_fee_bps?: number; withdrawal_daily_limit?: string; withdrawal_review_from?: string }) {
    const before = await this.prisma.cryptoAsset.findUnique({ where: { code: code.toUpperCase() } });
    if (!before) throw notFound('asset');
    for (const key of ['withdrawal_daily_limit', 'withdrawal_review_from'] as const) if (input[key] !== undefined) toUnits(input[key]!, before.decimals, key);
    const after = await this.prisma.cryptoAsset.update({
      where: { code: before.code },
      data: { ...(input.enabled !== undefined ? { enabled: input.enabled } : {}), ...(input.p2p_fee_bps !== undefined ? { p2pFeeBps: input.p2p_fee_bps } : {}),
        ...(input.withdrawal_daily_limit !== undefined ? { withdrawalDailyLimit: input.withdrawal_daily_limit } : {}),
        ...(input.withdrawal_review_from !== undefined ? { withdrawalReviewFrom: input.withdrawal_review_from } : {}),
      },
    });
    await this.audit.record({ actorId: adminId, action: 'crypto.asset_changed', targetType: 'crypto_asset', targetId: after.code, before: presentAsset(before), after: presentAsset(after) });
    return presentAsset(after);
  }

  /** Customers of every store, by email or ID, with their crypto account state. */
  async search(q: string | undefined) {
    const words = q?.trim().toLowerCase();
    const customers = await this.prisma.customer.findMany({
      where: words ? (/^[0-9a-f-]{36}$/.test(words) ? { id: words } : { email: { contains: words } }) : { ledgerAccounts: { some: { kind: { in: [...cryptoKinds] } } } },
      include: { store: { select: { name: true, subdomain: true } }, p2pProfile: true },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    return { object: 'list' as const, data: customers.map(c => this.presentCustomer(c)) };
  }

  private presentCustomer(c: { id: string; email: string; name: string; country: string | null; cryptoFrozenAt: Date | null; cryptoFrozenReason: string | null; store: { name: string; subdomain: string }; p2pProfile: { nickname: string } | null }) {
    return {
      object: 'crypto_customer' as const,
      id: c.id,
      email: c.email,
      name: c.name,
      country: c.country,
      store: { name: c.store.name, subdomain: c.store.subdomain },
      nickname: c.p2pProfile?.nickname ?? null,
      frozen: Boolean(c.cryptoFrozenAt),
      frozen_reason: c.cryptoFrozenReason,
      frozen_at: c.cryptoFrozenAt?.toISOString() ?? null,
    };
  }

  /** One customer's crypto: balances in both modes, cash, freezes. */
  async adminCustomer(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id }, include: { store: { select: { name: true, subdomain: true } }, p2pProfile: true } });
    if (!customer) throw notFound('customer');
    const assets = await this.assets(true);
    const byCode = new Map(assets.map(asset => [asset.code, asset]));
    const freezes = await this.prisma.cryptoFreeze.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
    const cash = await this.prisma.ledgerAccount.findMany({ where: { customerId: id, kind: { in: [...fiatKinds] } }, orderBy: [{ mode: 'desc' }, { currency: 'asc' }] });
    return {
      ...this.presentCustomer(customer),
      balances: {
        live: await this.assetBalances(id, 'live', assets),
        test: await this.assetBalances(id, 'test', assets),
      },
      cash: cash.map(account => ({ mode: account.mode, kind: account.kind, currency: account.currency, balance: minor(account.balanceMinor) })),
      freezes: freezes.map(freeze => presentFreeze(freeze, byCode.get(freeze.asset) ?? { decimals: 8 })),
    };
  }

  /** Test mode only: an admin credits test crypto (live crypto only ever arrives on chain). */
  async adminCredit(adminId: string | null, customerId: string, input: { asset: string; amount: string; reason: string }) {
    await this.customerOrThrow(customerId);
    const asset = await this.asset(input.asset);
    const amount = toUnits(input.amount, asset.decimals);
    if (amount <= 0n) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Enter an amount above zero.', 'amount');
    const reference = `crypto_admin_credit:${randomUUID()}`;
    await this.credit(customerId, 'test', asset, amount, reference, `Test ${asset.code} from BitoCard`);
    await this.audit.record({ actorId: adminId, action: 'crypto.test_credited', targetType: 'customer', targetId: customerId, after: { asset: asset.code, amount: input.amount, reason: input.reason } });
    return this.adminCustomer(customerId);
  }

  private async customerOrThrow(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id }, select: { id: true, storeId: true } });
    if (!customer) throw notFound('customer');
    return customer;
  }

  /** Freezes an amount of the customer's available crypto: nobody can move it until it is released or seized. */
  async freeze(adminId: string | null, customerId: string, input: { asset: string; amount: string; reason: string; mode: LedgerMode }) {
    const customer = await this.customerOrThrow(customerId);
    const asset = await this.prisma.cryptoAsset.findUnique({ where: { code: input.asset.toUpperCase() } });
    if (!asset) throw assetUnavailable();
    const amount = toUnits(input.amount, asset.decimals);
    if (amount <= 0n) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Enter an amount above zero.', 'amount');
    const walletId = await this.ledger.accountId(input.mode, this.ref(customerId, 'crypto_wallet', asset.code));
    const frozenId = await this.ledger.accountId(input.mode, this.ref(customerId, 'crypto_frozen', asset.code));
    const freeze = await this.prisma.$transaction(async tx => {
      await this.ledger.lockBalances(tx, [walletId, frozenId]);
      const created = await tx.cryptoFreeze.create({ data: { customerId, mode: input.mode, asset: asset.code, amount, reason: input.reason, frozenBy: adminId } });
      await this.ledger.write(tx, {
        mode: input.mode,
        type: 'crypto_freeze',
        reference: `crypto_freeze:${created.id}`,
        description: `${asset.code} frozen by BitoCard`,
        metadata: { freeze_id: created.id },
        postings: [
          { accountId: walletId, kind: 'crypto_wallet', amount },
          { accountId: frozenId, kind: 'crypto_frozen', amount: -amount },
        ],
      });
      return created;
    });
    await this.audit.record({ actorId: adminId, action: 'crypto.frozen', targetType: 'customer', targetId: customerId, after: { freeze_id: freeze.id, asset: asset.code, amount: input.amount, mode: input.mode, reason: input.reason } });
    await this.inbox.customer({ customerId, storeId: customer.storeId }, 'customer.crypto.frozen', {
      title: `${fromUnits(amount, asset.decimals)} ${asset.code} frozen`,
      body: 'BitoCard froze part of your crypto while it looks into your account. Contact support to find out more.',
      link: '/account/crypto',
      mode: input.mode,
      subject: freeze.id,
    });
    return presentFreeze(freeze, asset);
  }

  /** Releases a freeze back to the customer's wallet, or (finance) seizes it to BitoCard's adjustments. Once. */
  async resolveFreeze(adminId: string | null, freezeId: string, outcome: 'released' | 'seized', note: string) {
    const freeze = await this.prisma.cryptoFreeze.findUnique({ where: { id: freezeId } });
    if (!freeze) throw notFound('freeze');
    const asset = await this.prisma.cryptoAsset.findUniqueOrThrow({ where: { code: freeze.asset } });
    if (freeze.status !== 'frozen') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'freeze_resolved', 'This freeze was already released or seized.');
    const frozenId = await this.ledger.accountId(freeze.mode, this.ref(freeze.customerId, 'crypto_frozen', asset.code));
    const toId =
      outcome === 'released'
        ? await this.ledger.accountId(freeze.mode, this.ref(freeze.customerId, 'crypto_wallet', asset.code))
        : await this.ledger.accountId(freeze.mode, { kind: 'adjustments', currency: asset.code });
    const resolved = await this.prisma.$transaction(async tx => {
      const claimed = await tx.cryptoFreeze.updateMany({ where: { id: freeze.id, status: 'frozen' }, data: { status: outcome, resolvedBy: adminId, resolveNote: note, resolvedAt: new Date() } });
      if (claimed.count !== 1) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'freeze_resolved', 'This freeze was already released or seized.');
      await this.ledger.write(tx, {
        mode: freeze.mode,
        type: outcome === 'released' ? 'crypto_unfreeze' : 'crypto_seizure',
        reference: `crypto_freeze:${freeze.id}:${outcome}`,
        description: outcome === 'released' ? `${asset.code} unfrozen by BitoCard` : `${asset.code} seized by BitoCard`,
        metadata: { freeze_id: freeze.id },
        postings: [
          { accountId: frozenId, kind: 'crypto_frozen', amount: freeze.amount },
          { accountId: toId, kind: outcome === 'released' ? 'crypto_wallet' : 'adjustments', amount: -freeze.amount },
        ],
      });
      return tx.cryptoFreeze.findUniqueOrThrow({ where: { id: freeze.id } });
    });
    await this.audit.record({ actorId: adminId, action: outcome === 'released' ? 'crypto.unfrozen' : 'crypto.seized', targetType: 'customer', targetId: freeze.customerId, before: { freeze_id: freeze.id, status: 'frozen' }, after: { status: outcome, note } });
    return presentFreeze(resolved, asset);
  }

  /** Freezes or unfreezes the whole crypto account: no new ads, trades or withdrawals, and their ads leave the market. */
  async setAccountFrozen(adminId: string | null, customerId: string, input: { frozen: boolean; reason: string }) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, storeId: true, cryptoFrozenAt: true, cryptoFrozenReason: true } });
    if (!customer) throw notFound('customer');
    await this.prisma.customer.update({ where: { id: customerId }, data: input.frozen ? { cryptoFrozenAt: customer.cryptoFrozenAt ?? new Date(), cryptoFrozenReason: input.reason } : { cryptoFrozenAt: null, cryptoFrozenReason: null } });
    await this.audit.record({
      actorId: adminId,
      action: input.frozen ? 'crypto.account_frozen' : 'crypto.account_unfrozen',
      targetType: 'customer',
      targetId: customerId,
      before: { frozen: Boolean(customer.cryptoFrozenAt), reason: customer.cryptoFrozenReason },
      after: { frozen: input.frozen, reason: input.reason },
    });
    if (input.frozen && !customer.cryptoFrozenAt) {
      await this.inbox.customer({ customerId, storeId: customer.storeId }, 'customer.crypto.frozen', {
        title: 'Crypto account frozen',
        body: 'BitoCard froze your crypto account while it looks into it. Contact support to find out more.',
        link: '/account/crypto',
        subject: `account:${Date.now()}`,
      });
    }
    return this.adminCustomer(customerId);
  }
}

export function presentAsset(asset: CryptoAsset) {
  return {
    object: 'crypto_asset' as const,
    code: asset.code,
    name: asset.name,
    decimals: asset.decimals,
    enabled: asset.enabled,
    p2p_fee_bps: asset.p2pFeeBps,
    withdrawal_daily_limit: asset.withdrawalDailyLimit,
    withdrawal_review_from: asset.withdrawalReviewFrom,
  };
}
