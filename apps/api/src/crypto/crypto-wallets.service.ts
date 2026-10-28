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
import { testModeOnly } from '../payments/payments.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { fromUnits, toUnits } from './amounts.js';

export const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
export const assetUnavailable = (param = 'asset') => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'asset_unavailable', 'This asset is not available.', param);
export const cryptoFrozen = () =>
  new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'crypto_account_frozen', 'Your crypto account is frozen. Contact support to find out why.');

/**
 * The trading declaration's version (its date, the date of Afrippa's terms it accepts): bump it when everyone must
 * declare again, as when the terms, P2P rules or risk warnings change. Every account declares, once per version, that
 * it is 18 or over and not a citizen or resident of the United States or the United Kingdom, and accepts those
 * documents (on afrippa.com, `documents`), before trading. Each acceptance is kept (`crypto_declarations`).
 */
export const cryptoDeclarationVersion = '2026-10-28';
export const cryptoDeclarationText =
  "I am 18 or over, I am not a citizen or a resident of the United States or the United Kingdom, and I accept Afrippa's terms of use, P2P trading rules and risk warnings.";
/** The documents the declaration accepts, on afrippa.com. */
export const cryptoDeclarationDocuments = [
  { title: 'Terms of use', path: '/legal/terms' },
  { title: 'P2P trading rules', path: '/legal/p2p-rules' },
  { title: 'Risk warnings', path: '/legal/risks' },
] as const;

/** Who a customer is in the crypto market: their store's mode, the seller behind it and their country's currency. */
export type CryptoContext = { customer: CustomerWithStore; mode: LedgerMode; seller: Reseller; country: string; currency: string };

/** An Afrippa trader: a customer of an Afrippa store (docs/CRYPTO_SPINOFF_PLAN.md), whose market is their own country. */
export const isTrader = (customer: Pick<CustomerWithStore, 'store'>) => customer.store.platform === 'afrippa';

const cryptoKinds = ['crypto_wallet', 'crypto_locked', 'crypto_frozen', 'crypto_withdrawing'] as const satisfies AccountKind[];

/** BitoCard's crypto fees per mode and asset are spread over this many accounts (`crypto_fees`; totals are their sum). */
export const cryptoFeeShards = 16;

/**
 * One of BitoCard's crypto fee accounts, picked at random: every trade and withdrawal credits a fee, and one shared
 * row would make every trade of an asset, in every market, wait for the one before.
 */
export const cryptoFeesRef = (asset: string) => ({ kind: 'crypto_fees' as const, currency: asset, shard: Math.floor(Math.random() * cryptoFeeShards) });

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
 * below zero. BitoCard's side is `crypto_custody` (what it holds for them). Afrippa holds no money: traders pay each
 * other directly (P2P money and the instant exchange are retired). Gated by the `crypto_wallets` switch (store's seller, then
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

  /** An enabled asset by code (any case); `held` also finds a switched-off one, for moving out what customers hold. */
  async asset(code: string, param = 'asset', held = false) {
    const asset = await this.prisma.cryptoAsset.findUnique({ where: { code: code.toUpperCase() } });
    if (!asset || (!asset.enabled && !held)) throw assetUnavailable(param);
    return asset;
  }

  // -- Who may use crypto ---------------------------------------------------------------------------------------

  /**
   * The customer's mode, seller and currency, whether or not their store is open now: what they already hold (balances,
   * closing ads, withdrawing, cashing out) stays theirs when a reseller's store is unpublished, suspended or unverified.
   * New business (`require`) also needs the store open.
   */
  async context(customer: CustomerWithStore): Promise<CryptoContext> {
    if (isTrader(customer)) {
      // Afrippa's traders: their market is the country fixed at sign-up, under Afrippa's operator account.
      if (!customer.country) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'country_required', 'Choose your country first.', 'country');
      const [seller, market] = await Promise.all([
        this.prisma.reseller.findUniqueOrThrow({ where: { id: customer.store.resellerId } }),
        this.prisma.country.findUniqueOrThrow({ where: { code: customer.country }, select: { code: true, currency: true } }),
      ]);
      return { customer, mode: this.stores.mode(customer.store), seller, country: market.code, currency: market.currency };
    }
    const seller = this.stores.isHouse(customer.store)
      ? await this.stores.sellerFor(customer)
      : await this.prisma.reseller.findUniqueOrThrow({ where: { id: customer.store.resellerId } });
    if (!seller.country) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'store_unavailable', 'This store is not open.');
    const market = await this.prisma.country.findUniqueOrThrow({ where: { code: seller.country! }, select: { code: true, currency: true } });
    return { customer, mode: this.stores.mode(customer.store), seller, country: market.code, currency: market.currency };
  }

  /** Whether crypto is on for the customer: their store's seller's switch, or for Afrippa's traders their country's. */
  enabled(context: CryptoContext) {
    return this.switchOn('crypto_wallets', context);
  }

  /** A crypto switch for a customer: Afrippa's traders follow their own country (then the global level), never a reseller. */
  private switchOn(key: 'crypto_wallets' | 'p2p_trading', context: CryptoContext) {
    return isTrader(context.customer) ? this.settings.isOnForCountry(key, context.country) : this.settings.isOn(key, context.seller.id);
  }

  /** Live crypto needs the customer's identity check (BVN in Nigeria, Didit elsewhere); the sandbox does not. */
  async verified(context: CryptoContext) {
    return context.mode === 'test' || this.identity.isCustomerVerified(context.seller.id, context.mode, context.customer.id);
  }

  /** The checks before any new crypto business (deposits, ads, trades): the store open and crypto on for it, then `requireHolder`'s. */
  async require(customer: CustomerWithStore) {
    const context = await this.requireOpen(customer);
    if (!(await this.enabled(context))) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'crypto_not_enabled', 'Crypto is not available in your country yet.');
    }
    return context;
  }

  // -- Markets: whose crypto is on ----------------------------------------------------------------------------

  /** Whether the customer's own market is open: crypto and P2P switched on for their store's seller. */
  async homeOpen(context: CryptoContext) {
    return (await this.enabled(context)) && (await this.switchOn('p2p_trading', context));
  }

  /**
   * Whether residents of `country` may trade on the global market: the market itself on, and switched on for that
   * country by itself (the global level never opens a country: only countries admins allow, absolutely).
   */
  async globalOpenFor(country: string) {
    return (await this.settings.isOnGlobally('crypto_global')) && (await this.settings.isSetFor('crypto_global', { countryCode: country })) === true;
  }

  /**
   * Whether this customer may trade on the global market: the market itself on, and on for them. bitocard.com's
   * customers follow their country (even where its own market is off); a reseller's store's customers follow the
   * reseller's switch (else their country), and only while their store's own market is open.
   */
  async globalAllowed(context: CryptoContext, home?: boolean) {
    if (context.customer.store.reseller.house || isTrader(context.customer)) return this.globalOpenFor(context.country);
    const open = home ?? (await this.homeOpen(context));
    if (!open || !(await this.settings.isOnGlobally('crypto_global'))) return false;
    // The reseller's own choice, else their country's, set for it by itself: never the global level alone.
    return ((await this.settings.isSetFor('crypto_global', { resellerId: context.seller.id })) ?? (await this.settings.isSetFor('crypto_global', { countryCode: context.country }))) === true;
  }

  /**
   * Whether a country is one admins allow in the crypto markets: one of BitoCard's markets with, set for that country
   * by itself, BitoCard Crypto showing it (`crypto_app`), its residents allowed on the global market, or its own
   * market open (crypto and P2P on). Global switches never allow a country, and nobody else trades, whatever they
   * declare: an allow-list, never a list of refused countries.
   */
  async allowedCountry(code: string) {
    if (!/^[A-Z]{2}$/.test(code) || !(await this.prisma.country.findUnique({ where: { code }, select: { code: true } }))) return false;
    const set = async (key: 'crypto_app' | 'crypto_wallets' | 'p2p_trading') => (await this.settings.isSetFor(key, { countryCode: code })) === true;
    return (await set('crypto_app')) || (await this.globalOpenFor(code)) || ((await set('crypto_wallets')) && (await set('p2p_trading')));
  }

  /** The customer's declaration for the current version: whether they made it, and what it says. */
  async declaration(customer: CustomerWithStore) {
    const found = await this.prisma.cryptoDeclaration.findUnique({ where: { customerId_version: { customerId: customer.id, version: cryptoDeclarationVersion } } });
    return {
      object: 'crypto_declaration' as const,
      version: cryptoDeclarationVersion,
      text: cryptoDeclarationText,
      documents: cryptoDeclarationDocuments,
      declared: Boolean(found),
      declared_at: found?.declaredAt.toISOString() ?? null,
    };
  }

  /** Records the declaration for `version`, which must be the current one; declaring again changes nothing. */
  async declare(customer: CustomerWithStore, version: string) {
    if (version !== cryptoDeclarationVersion) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'declaration_changed', "Afrippa's terms have changed. Read them again and confirm.", 'version');
    }
    await this.prisma.cryptoDeclaration.upsert({ where: { customerId_version: { customerId: customer.id, version } }, create: { customerId: customer.id, version }, update: {} });
    return this.declaration(customer);
  }

  /**
   * Whether the customer may trade at all: their declaration for the current version, their own country allowed, and,
   * live, the country of the document their identity check verified allowed too (so US, UK and every other country
   * outside the allowed markets are refused, whatever is declared).
   */
  async requireEligible(context: CryptoContext) {
    if (!(await this.prisma.cryptoDeclaration.findUnique({ where: { customerId_version: { customerId: context.customer.id, version: cryptoDeclarationVersion } } }))) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'declaration_required', "Accept Afrippa's terms, and confirm you are 18 or over and not a citizen or resident of the United States or the United Kingdom, first.", 'declaration');
    }
    const refused = () => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'country_not_allowed', 'Trading is open only to residents of the countries Afrippa serves.');
    if (!(await this.allowedCountry(context.country))) throw refused();
    if (context.mode === 'live') {
      const document = await this.identity.customerDocumentCountry(context.seller.id, context.mode, context.customer.id);
      if (!document || !(await this.allowedCountry(document))) throw refused();
    }
  }

  /**
   * The checks before using crypto at all (deposits, test crypto): `require`'s, with crypto on either in the customer's
   * own market or for the global market, so residents trading only globally (their own market off) still hold coins.
   */
  async requireUse(customer: CustomerWithStore) {
    const context = await this.requireOpen(customer);
    if ((await this.enabled(context)) || (await this.globalAllowed(context))) return context;
    throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'crypto_not_enabled', 'Crypto is not available in your country yet.');
  }

  /**
   * `require` without the crypto switch: the store open, then `requireHolder`'s checks. For the P2P markets, whose
   * switches depend on the market (the global market does not need the customer's own country's crypto on).
   */
  async requireOpen(customer: CustomerWithStore) {
    // Afrippa's store is never a store on BitoCard: its traders are let in by Afrippa's signed server.
    if (!this.stores.isHouse(customer.store) && !isTrader(customer)) await this.stores.seller(customer.store, '');
    return this.requireHolder(customer, 'using crypto');
  }

  /**
   * The checks before moving out what a customer already holds (on-chain withdrawals, bank payouts):
   * email confirmed, not frozen, identity checked live. Not the crypto switches nor the store being open: switching
   * crypto off or closing a store never traps money.
   */
  async requireHolder(customer: CustomerWithStore, doing = 'moving money out') {
    if (!customer.emailVerifiedAt) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'email_not_verified', 'Confirm your email first: enter the code we emailed you.');
    }
    const context = await this.context(customer);
    const fresh = await this.prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, select: { cryptoFrozenAt: true } });
    if (fresh.cryptoFrozenAt) throw cryptoFrozen();
    if (!(await this.verified(context))) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'customer_verification_required', `Verify your identity before ${doing}.`);
    }
    return context;
  }

  /** `requireHolder`, plus the name the identity check verified (live) for matching bank accounts. */
  async requireCashOut(customer: CustomerWithStore) {
    const context = await this.requireHolder(customer, 'paying money out');
    const verifiedName = context.mode === 'live' ? await this.identity.customerVerifiedName(context.seller.id, context.mode, customer.id) : null;
    return { customer, mode: context.mode, sellerId: context.seller.id, country: context.country, currency: context.currency, verifiedName };
  }

  // -- Balances -------------------------------------------------------------------------------------------------

  ref(customerId: string, kind: AccountKind, currency: string): AccountRef {
    return { kind, currency, customerId };
  }

  /** Every crypto balance the customer has in a mode, by kind and asset. */
  private async accounts(customerId: string, mode: LedgerMode) {
    const rows = await this.prisma.ledgerAccount.findMany({ where: { customerId, mode, kind: { in: [...cryptoKinds] } }, select: { kind: true, currency: true, balanceMinor: true } });
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
        /** False for an asset admins switched off: what is held can still be withdrawn, not traded or deposited. */
        enabled: asset.enabled,
        available: fromUnits(available, asset.decimals),
        locked: fromUnits(locked, asset.decimals),
        frozen: fromUnits(frozen, asset.decimals),
        /** On its way out in on-chain withdrawals (amount and fee), until each is sent or returned. */
        withdrawing: fromUnits(withdrawing, asset.decimals),
        total: fromUnits(available + locked + frozen + withdrawing, asset.decimals),
      };
    });
  }

  /** The customer's crypto wallets, with what they can do now. */
  async overview(customer: CustomerWithStore) {
    const context = await this.context(customer);
    const [home, p2p, global, verified, fresh, all] = await Promise.all([
      this.enabled(context),
      this.switchOn('p2p_trading', context),
      this.globalAllowed(context),
      this.verified(context),
      this.prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, select: { cryptoFrozenAt: true } }),
      this.assets(true),
    ]);
    const enabled = home || global;
    const balance = await this.accounts(customer.id, context.mode);
    // A switched-off asset is listed only while the customer still holds some, so they can withdraw it.
    const held = (code: string) => cryptoKinds.some(kind => balance(kind, code) > 0n);
    const listed = all.filter(asset => asset.enabled || held(asset.code));
    return {
      object: 'crypto_wallets' as const,
      mode: context.mode,
      country: context.country,
      currency: context.currency,
      /** Crypto usable: on in the customer's own market, or the global market open to them. */
      enabled,
      /** Their own country's P2P market open (`p2p_enabled`), and the global market open to them (`global_enabled`). */
      p2p_enabled: home && p2p,
      global_enabled: global,
      verified,
      /** The crypto declaration (not a US or UK citizen or resident), needed to trade: its version and whether it was made. */
      declaration: { version: cryptoDeclarationVersion, declared: Boolean(await this.prisma.cryptoDeclaration.findUnique({ where: { customerId_version: { customerId: customer.id, version: cryptoDeclarationVersion } } })) },
      frozen: Boolean(fresh.cryptoFrozenAt),
      assets: await this.assetBalances(customer.id, context.mode, listed),
    };
  }

  /** Sandbox stores only: test crypto into the customer's wallet (in place of an on-chain deposit). */
  async testDeposit(customer: CustomerWithStore, input: { asset: string; amount: string }) {
    const context = await this.requireUse(customer);
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

  /** One customer's crypto: balances in both modes and freezes. */
  async adminCustomer(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id }, include: { store: { select: { name: true, subdomain: true } }, p2pProfile: true } });
    if (!customer) throw notFound('customer');
    const assets = await this.assets(true);
    const byCode = new Map(assets.map(asset => [asset.code, asset]));
    const freezes = await this.prisma.cryptoFreeze.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return {
      ...this.presentCustomer(customer),
      balances: {
        live: await this.assetBalances(id, 'live', assets),
        test: await this.assetBalances(id, 'test', assets),
      },
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
      link: '/wallets',
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
        link: '/wallets',
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
