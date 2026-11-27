import { InvoicesService } from '../billing/invoices.service.js';
import { ResellerIntegrationsService } from '../reseller-integrations/reseller-integrations.service.js';
import { randomUUID } from 'node:crypto';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Injectable, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, Matches, Max, Min } from 'class-validator';
import { Public } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { TransactionPinGuard } from '../customers/transaction-pin.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type Country, type LedgerMode, type Payment, type ReservedAccount, type Reseller, type Store } from '../generated/prisma/client.js';
import { PageDto } from '../ledger/wallet.controller.js';
import { minor } from '../ledger/mode.js';
import { FxService } from '../fx/fx.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { currencyNotHeld, usd } from '../ledger/wallet.service.js';
import { PaymentMethodsService } from '../payments/payment-methods.service.js';
import { isPaymentGateway, paymentGateways } from '../payments/payment-providers.js';
import { PaymentsService, testModeOnly } from '../payments/payments.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StoreSellers } from './store-sellers.js';

const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);

/** How a wallet payment shows among the payment methods (`id: wallet`). */
export const walletMethod = {
  object: 'payment_method' as const,
  id: 'wallet' as const,
  label: 'Wallet',
  description: 'Pay from your wallet balance',
  networks: [] as string[],
};

export function presentCustomerTopUp(payment: Payment) {
  return {
    object: 'customer_top_up' as const,
    id: payment.id,
    mode: payment.mode,
    status: payment.status,
    /** checkout (a payment page) or bank_transfer (into the customer's own account number). */
    source: payment.purpose === 'reserved_account_deposit' ? ('bank_transfer' as const) : ('checkout' as const),
    amount: minor(payment.amountMinor),
    currency: payment.currency,
    method: isPaymentGateway(payment.provider) ? { id: payment.provider, label: paymentGateways[payment.provider].label } : { id: payment.provider, label: payment.provider === 'sandbox' ? 'Sandbox' : payment.provider },
    /** Charged by the gateway in another currency (cards in US dollars where Stripe cannot take this one). */
    charged: payment.chargeCurrency && payment.chargeAmountMinor ? { amount: minor(payment.chargeAmountMinor), currency: payment.chargeCurrency } : null,
    checkout_url: payment.status === 'pending' ? payment.checkoutUrl : null,
    failure_reason: payment.failureReason,
    created_at: payment.createdAt.toISOString(),
    completed_at: payment.completedAt?.toISOString() ?? null,
  };
}

function presentAccount(account: ReservedAccount) {
  return {
    object: 'reserved_account' as const,
    id: account.id,
    currency: account.currency,
    bank_name: account.bankName,
    account_number: account.accountNumber,
    account_name: account.accountName,
  };
}

type WalletContext = { store: Store; mode: LedgerMode; seller: Reseller; country: Country };

const badRequest = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);

/** A customer's wallets in order: their own country's currency, US dollars, then the ones they added (by when). */
export const orderWallets = (home: string, added: string[]) => [...new Set([home, usd, ...added])];

/**
 * Store customers' wallets (`customer_wallets` switch, on unless an admin switches it off: global, per market or per
 * reseller; bitocard.com follows its market's house account). Every customer, on bitocard.com or a reseller's store,
 * has their own country's currency and US dollars, and may add the currencies of markets an admin opened
 * (`customer_foreign_wallets`; `customer_wallet_currencies`). Any of them pays for anything at BitoCard's rate
 * (`FxService.covering`), and money moves between them (`convert`). A customer tops up a wallet in its currency
 * through BitoCard's checkout methods for the market (card, Flutterwave, mobile money) or a transfer into their own
 * Flutterwave account number, and while wallets are on buys only from it. The balance is what BitoCard owes them
 * (`customer_wallet`, never below zero): it is spent only on the store's products and never withdrawn. Purchases move it
 * to the seller's `customer_payments`, as a checkout payment would; refunds of wallet purchases come back to it.
 */
@Injectable()
export class CustomerWalletsService {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly prisma: PrismaService,
    private readonly stores: StoreSellers,
    private readonly settings: SettingsService,
    private readonly payments: PaymentsService,
    private readonly methods: PaymentMethodsService,
    private readonly integrations: ResellerIntegrationsService,
    private readonly fx: FxService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Whether customers buying from this seller must use their wallet. Never while the reseller's own gateway collects
   * their payments: wallet top-ups go through BitoCard's gateways, so customers pay at checkout instead (a balance
   * they already hold can still be spent). A Resale shop is the exception: it sells only from the wallet, so BitoCard
   * always collects its customers' top-ups, whoever collects the reseller's other stores' payments.
   */
  async enabled(seller: Pick<Reseller, 'id'>, mode?: LedgerMode, store?: { template: string }) {
    if (!(await this.settings.isOn('customer_wallets', seller.id))) return false;
    if (store?.template === 'resale_shop') return true;
    return !(mode && (await this.integrations.ownCollects(seller.id, mode)));
  }

  /** The customer's balance in a currency (minor units). */
  async balance(customerId: string, mode: LedgerMode, currency: string) {
    const account = await this.prisma.ledgerAccount.findFirst({ where: { kind: 'customer_wallet', customerId, mode, currency }, select: { balanceMinor: true } });
    return account?.balanceMinor ?? 0n;
  }

  /**
   * The store, mode and seller, and the customer's home market: their own country (fixed at sign-up; on a reseller's
   * store, the reseller's), never the market of the store they are on. An older bitocard.com account without one is
   * asked to choose it first (`country_required`).
   */
  private async context(customer: CustomerWithStore): Promise<WalletContext> {
    const store = customer.store;
    const seller = await this.stores.sellerFor(customer);
    const market = await this.prisma.country.findUniqueOrThrow({ where: { code: customer.country ?? seller.country! } });
    return { store, mode: this.stores.mode(store), seller, country: market };
  }

  /**
   * Every wallet the customer holds: their country's currency, US dollars, the ones they added, and any other
   * currency they still have money in (a wallet with a balance is never hidden).
   */
  async heldCurrencies(customerId: string, home: string) {
    const [added, funded] = await Promise.all([
      this.prisma.customerWalletCurrency.findMany({ where: { customerId }, orderBy: { createdAt: 'asc' }, select: { currency: true } }),
      this.prisma.ledgerAccount.findMany({ where: { kind: 'customer_wallet', customerId, balanceMinor: { not: 0n } }, select: { currency: true }, orderBy: { currency: 'asc' } }),
    ]);
    return orderWallets(home, [...added.map(row => row.currency), ...funded.map(row => row.currency)]);
  }

  /** The customer's home currency and every wallet they hold (for checkout, spins and admins). */
  async walletsOf(customer: CustomerWithStore) {
    const context = await this.context(customer);
    return { home: context.country.currency, held: await this.heldCurrencies(customer.id, context.country.currency), context };
  }

  /** The markets whose currency customers may add: opened by an admin (`customer_foreign_wallets`), with wallets on there. */
  private async openMarkets() {
    const countries = await this.prisma.country.findMany({ orderBy: { code: 'asc' } });
    const open: Country[] = [];
    for (const country of countries) {
      if (country.currency === usd) continue;
      if ((await this.settings.isOnForCountry('customer_foreign_wallets', country.code)) && (await this.settings.isOnForCountry('customer_wallets', country.code))) open.push(country);
    }
    return open;
  }

  /** The market a wallet tops up in: home and US dollars at home; an added currency in the first open market using it. */
  private async walletMarket(context: WalletContext, currency: string) {
    if (currency === context.country.currency || currency === usd) return context.country;
    return (await this.openMarkets()).find(country => country.currency === currency) ?? (await this.prisma.country.findFirst({ where: { currency }, orderBy: { code: 'asc' } })) ?? context.country;
  }

  /** The ways to top up a wallet: its market's checkout methods that take its currency (BitoCard's gateways, never a reseller's own). */
  private async topUpMethods(context: WalletContext, currency: string) {
    const market = await this.walletMarket(context, currency);
    const payer = { code: market.code, currency };
    const offered = await this.methods.offered('checkout', payer, context.mode);
    return Promise.all(offered.map(gateway => this.methods.describe(gateway, payer)));
  }

  /** One of the customer's wallets (their country's currency by default). */
  private async walletCurrency(customer: CustomerWithStore, context: WalletContext, asked?: string) {
    const currency = asked ? asked.toUpperCase() : context.country.currency;
    if (!(await this.heldCurrencies(customer.id, context.country.currency)).includes(currency)) throw currencyNotHeld(currency);
    return currency;
  }

  async get(customer: CustomerWithStore, asked?: string) {
    const context = await this.context(customer);
    const { mode, country: market } = context;
    const currency = await this.walletCurrency(customer, context, asked);
    const local = currency === market.currency;
    const held = await this.heldCurrencies(customer.id, market.currency);
    const accounts = local ? await this.payments.customerReservedAccounts(customer.id, mode, market.currency) : [];
    return {
      object: 'customer_wallet' as const,
      mode,
      country: market.code,
      currency,
      /** Wallets are on for this store: purchases are paid only from the wallet. */
      enabled: await this.enabled(context.seller, context.mode, context.store),
      balance: minor(await this.balance(customer.id, mode, currency)),
      top_up_methods: await this.topUpMethods(context, currency),
      /** Transfers into these top the country wallet up (Flutterwave; where the market offers bank account numbers). */
      reserved_accounts: accounts.map(presentAccount),
      reserved_accounts_available: local && market.reservedAccounts,
      /** Nigeria: the bank needs the customer's BVN to open an account number (passed on, never kept). */
      reserved_account_needs_bvn: mode === 'live' && market.code === 'NG',
      /** Every wallet: the country's currency first (`primary`), then US dollars, then the ones added. */
      wallets: await Promise.all(
        held.map(async code => {
          const balance = await this.balance(customer.id, mode, code);
          return { currency: code, primary: code === market.currency, balance: minor(balance), removable: code !== market.currency && code !== usd && balance === 0n };
        }),
      ),
    };
  }

  private requireConfirmed(customer: CustomerWithStore) {
    if (!customer.emailVerifiedAt) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'email_not_verified', 'Confirm your email first: enter the code we emailed you.');
    }
  }

  private async requireEnabled(context: WalletContext) {
    if (!(await this.enabled(context.seller, context.mode, context.store))) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'wallets_not_enabled', 'This store does not use wallets: pay when you buy instead.');
    }
  }

  /** Opens a payment page to top the wallet up; it is credited once the gateway confirms the payment. */
  async topUp(customer: CustomerWithStore, input: { amount: number; method?: string; return_url: string; currency?: string }) {
    this.requireConfirmed(customer);
    const context = await this.context(customer);
    await this.requireEnabled(context);
    const currency = await this.walletCurrency(customer, context, input.currency);
    const market = await this.walletMarket(context, currency);
    const offered = await this.methods.offered('checkout', { code: market.code, currency }, context.mode);
    let gateway: string;
    if (input.method) {
      if (!offered.includes(input.method as never)) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'payment_method_unavailable', 'This payment method is not available here. List the methods offered first.', 'method');
      }
      gateway = input.method;
    } else if (offered[0]) {
      gateway = offered[0];
    } else if (context.mode === 'test') {
      gateway = 'sandbox';
    } else {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'provider_unavailable', 'Top-ups are not available in your country yet.');
    }
    // Mobile money top-ups are billable for the store's reseller: at their credit limit, other methods stay open.
    if (gateway === 'pawapay' && context.mode === 'live' && !context.seller.house) {
      try {
        await this.invoices.requireCredit(context.seller.id);
      } catch {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'payment_method_unavailable', 'This payment method is not available here right now. Choose another.', 'method');
      }
    }
    const id = randomUUID();
    const returnUrl = new URL(input.return_url);
    returnUrl.searchParams.set('top_up', id);
    const payment = await this.payments.openPayment({
      id,
      resellerId: context.seller.id,
      customerId: customer.id,
      mode: context.mode,
      purpose: 'customer_top_up',
      gateway,
      reference: `bc_ctu_${id.replaceAll('-', '')}`,
      amount: BigInt(input.amount),
      country: market.code,
      currency,
      payer: { email: customer.email, name: customer.name },
      returnUrl: returnUrl.toString(),
      description: 'Wallet top-up',
    });
    return presentCustomerTopUp(payment);
  }

  /** One of the customer's top-ups; a pending live one is checked with the gateway first. */
  async getTopUp(customer: CustomerWithStore, id: string) {
    let payment = await this.prisma.payment.findFirst({ where: { id, customerId: customer.id } });
    if (!payment) throw notFound('top-up');
    if (payment.status === 'pending' && payment.mode === 'live' && payment.purpose === 'customer_top_up') {
      payment = await this.payments.requery(payment).catch(() => payment!);
    }
    return presentCustomerTopUp(payment);
  }

  /** The customer gave up on the payment page: closed as cancelled (credited instead if it was paid after all). */
  async cancelTopUp(customer: CustomerWithStore, id: string) {
    const payment = await this.prisma.payment.findFirst({ where: { id, customerId: customer.id, purpose: 'customer_top_up' } });
    if (!payment) throw notFound('top-up');
    return presentCustomerTopUp(await this.payments.cancel(payment));
  }

  /** Sandbox stores only: finish a top-up as paid or failed. */
  async simulateTopUp(customer: CustomerWithStore, id: string, outcome: 'succeeded' | 'failed') {
    const payment = await this.prisma.payment.findFirst({ where: { id, customerId: customer.id, purpose: 'customer_top_up' } });
    if (!payment) throw notFound('top-up');
    if (payment.mode !== 'test') throw testModeOnly();
    return presentCustomerTopUp(await this.payments.simulate(payment, outcome));
  }

  /** Opens a dedicated bank account number for the wallet, where the market offers one. */
  async createReservedAccounts(customer: CustomerWithStore, input: { bvn?: string; phone?: string }) {
    this.requireConfirmed(customer);
    const context = await this.context(customer);
    await this.requireEnabled(context);
    // Ghana: the account is opened in the name the identity check verified, when there is one.
    const verified =
      context.country.code === 'GH'
        ? await this.prisma.identityVerification.findFirst({ where: { resellerId: context.seller.id, mode: context.mode, subject: 'customer', customerReference: customer.id, status: 'approved' }, orderBy: { createdAt: 'desc' }, select: { verifiedName: true } })
        : null;
    const accounts = await this.payments.createCustomerReservedAccounts({
      customer,
      sellerId: context.seller.id,
      mode: context.mode,
      country: context.country,
      bvn: input.bvn,
      holder: { name: verified?.verifiedName ?? customer.name, phone: input.phone },
    });
    return { object: 'list' as const, data: accounts.map(presentAccount) };
  }

  /** Sandbox stores only: a transfer into the customer's account number. */
  async simulateDeposit(customer: CustomerWithStore, accountId: string, amount: number) {
    const account = await this.prisma.reservedAccount.findFirst({ where: { id: accountId, customerId: customer.id, mode: 'test' } });
    if (!account) throw notFound('account');
    const outcome = await this.payments.recordDeposit('sandbox', {
      status: 'succeeded',
      providerTransactionId: randomUUID(),
      reference: account.providerReference,
      amount: BigInt(amount),
      currency: account.currency,
      fee: 0n,
    });
    return { object: 'simulated_deposit' as const, credited: outcome.credited, amount, currency: account.currency };
  }

  /** The currencies the customer could add as wallets, each with why it cannot be added yet (`reason`). */
  async addable(customer: CustomerWithStore) {
    const context = await this.context(customer);
    const held = await this.heldCurrencies(customer.id, context.country.currency);
    const seen = new Set<string>();
    const data = [];
    for (const market of await this.openMarkets()) {
      if (held.includes(market.currency) || seen.has(market.currency)) continue;
      seen.add(market.currency);
      const rate = await this.fx.rate(market.currency).then(
        () => true,
        () => false,
      );
      data.push({ object: 'wallet_currency_option' as const, currency: market.currency, country: market.code, country_name: market.name, available: rate, reason: rate ? null : 'rate_unavailable' });
    }
    return { object: 'list' as const, data };
  }

  /** Adds a wallet in another market's currency (one an admin opened). */
  async addWallet(customer: CustomerWithStore, asked: string) {
    this.requireConfirmed(customer);
    const context = await this.context(customer);
    await this.requireEnabled(context);
    const currency = asked.toUpperCase();
    const held = await this.heldCurrencies(customer.id, context.country.currency);
    if (held.includes(currency)) throw conflict('wallet_exists', `You already have a ${currency} wallet.`, 'currency');
    const option = (await this.addable(customer)).data.find(item => item.currency === currency);
    if (!option) throw badRequest('currency_unavailable', `${currency} wallets are not open. Choose one of the currencies offered.`, 'currency');
    if (!option.available) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'conversion_unavailable', `${currency} wallets are paused just now. Try again later.`);
    await this.prisma.customerWalletCurrency.createMany({ data: [{ customerId: customer.id, currency }], skipDuplicates: true });
    return this.get(customer, currency);
  }

  /** Removes a wallet the customer added, only while it is empty and nothing is on its way into it. */
  async removeWallet(customer: CustomerWithStore, asked: string) {
    const context = await this.context(customer);
    const currency = asked.toUpperCase();
    if (currency === usd || currency === context.country.currency) throw conflict('wallet_required', "Your US dollar wallet and your own country's wallet always stay.", 'currency');
    const money = await this.prisma.ledgerAccount.findFirst({ where: { kind: 'customer_wallet', customerId: customer.id, currency, balanceMinor: { not: 0n } }, select: { id: true } });
    if (money) throw conflict('wallet_not_empty', `Your ${currency} wallet still has money in it. Spend it or move it to another wallet first.`, 'currency');
    const row = await this.prisma.customerWalletCurrency.findUnique({ where: { customerId_currency: { customerId: customer.id, currency } } });
    if (!row) throw notFound('wallet');
    const pending = await this.prisma.payment.findFirst({ where: { customerId: customer.id, currency, status: 'pending', purpose: 'customer_top_up' }, select: { id: true } });
    if (pending) throw conflict('top_up_pending', `A top-up into your ${currency} wallet is still on its way. Try again once it is done.`, 'currency');
    await this.prisma.customerWalletCurrency.delete({ where: { id: row.id } });
    return this.get(customer);
  }

  /**
   * Moves money between two of the customer's wallets at BitoCard's rate (`FxService.convert`, one margin, rounded
   * down), shown first with `preview`. `expected_amount` refuses less than the customer was shown (`rate_changed`).
   * One `conversion` entry through BitoCard's currency exchange accounts; spend only, as every wallet is.
   */
  async convert(customer: CustomerWithStore, input: { from: string; to: string; amount: number; preview?: boolean; expected_amount?: number }) {
    this.requireConfirmed(customer);
    const context = await this.context(customer);
    await this.requireEnabled(context);
    const from = input.from.toUpperCase();
    const to = input.to.toUpperCase();
    const held = await this.heldCurrencies(customer.id, context.country.currency);
    if (!held.includes(from)) throw currencyNotHeld(from);
    if (!held.includes(to)) throw currencyNotHeld(to);
    if (from === to) throw badRequest('parameter_invalid', 'Choose two different wallets.', 'to');
    const amount = BigInt(input.amount);
    const out = await this.fx.convert(amount, from, to);
    if (out.amount <= 0n) throw badRequest('amount_too_small', 'This amount is too small to move.', 'amount');
    const { mode } = context;
    const quote = {
      object: 'wallet_conversion' as const,
      mode,
      from: { amount: minor(amount), currency: from },
      to: { amount: minor(out.amount), currency: to },
      /** Units of the receiving currency per unit of the paying one. */
      rate: out.rate.mul(new Prisma.Decimal(10).pow(fractionDigits(from) - fractionDigits(to))).toSignificantDigits(8).toString(),
    };
    const short = () => new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'wallet_balance_low', `Your ${from} wallet does not have this much. Move less, or add money first.`, 'amount');
    if ((await this.balance(customer.id, mode, from)) < amount) throw short();
    if (input.preview) return { ...quote, id: null, created_at: null };
    if (input.expected_amount !== undefined && out.amount < BigInt(input.expected_amount)) {
      throw conflict('rate_changed', 'The rate changed. Check the new amount and try again.', 'expected_amount');
    }
    const id = randomUUID();
    const entry = await this.ledger.prepare({
      mode,
      type: 'conversion',
      reference: `customer_conversion:${id}`,
      description: `Moved from your ${from} wallet to your ${to} wallet`,
      metadata: { conversion: { from: { amount: String(amount), currency: from }, to: { amount: String(out.amount), currency: to }, rate: quote.rate } },
      lines: [
        { account: { kind: 'customer_wallet', currency: from, customerId: customer.id }, debit: amount },
        { account: { kind: 'currency_exchange', currency: from }, credit: amount },
        { account: { kind: 'currency_exchange', currency: to }, debit: out.amount },
        { account: { kind: 'customer_wallet', currency: to, customerId: customer.id }, credit: out.amount },
      ],
    });
    try {
      const written = await this.prisma.$transaction(tx => this.ledger.write(tx, entry));
      return { ...quote, id: written.id, created_at: written.createdAt.toISOString() };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'insufficient_funds') throw short();
      throw error;
    }
  }

  /** What moved in and out of the customer's wallets (this store's mode), newest first. */
  async transactions(customer: CustomerWithStore, page: { limit?: number; starting_after?: string }) {
    const limit = page.limit ?? 25;
    const mode = this.stores.mode(customer.store);
    const postings = await this.prisma.ledgerPosting.findMany({
      where: { account: { kind: 'customer_wallet', customerId: customer.id, mode } },
      include: { entry: true, account: true },
      orderBy: [{ entry: { createdAt: 'desc' } }, { id: 'desc' }],
      take: limit + 1,
      ...(page.starting_after ? { cursor: { id: page.starting_after }, skip: 1 } : {}),
    });
    return {
      object: 'list' as const,
      data: postings.slice(0, limit).map(posting => {
        const meta = (posting.entry.metadata ?? {}) as { checkout_id?: string; payment_id?: string };
        return {
          object: 'wallet_transaction' as const,
          id: posting.id,
          type: posting.entry.type,
          description: posting.entry.description,
          // The wallet is owed to the customer: it grows with credits (negative postings).
          amount: minor(-posting.amountMinor),
          currency: posting.account.currency,
          checkout_id: meta.checkout_id ?? null,
          top_up_id: meta.payment_id && !meta.checkout_id ? meta.payment_id : null,
          created_at: posting.entry.createdAt.toISOString(),
        };
      }),
      has_more: postings.length > limit,
    };
  }

  /** Admins and store owners: a customer's balances (every currency and mode). */
  async balances(customerId: string) {
    const accounts = await this.prisma.ledgerAccount.findMany({ where: { kind: 'customer_wallet', customerId }, orderBy: [{ mode: 'desc' }, { currency: 'asc' }] });
    return accounts.map(account => ({ mode: account.mode, currency: account.currency, balance: minor(account.balanceMinor) }));
  }
}

/** Minor-unit digits of a currency (2 for most; 0 for UGX, XOF). */
const fractionDigits = (currency: string) => {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
};

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);

class TopUpDto {
  /** Minor units of the wallet's currency. */
  @IsInt() @Min(100) @Max(100_000_000_00)
  amount: number;

  @IsOptional() @IsIn(Object.keys(paymentGateways))
  method?: string;

  /** The store page the payment page returns to (the top-up's ID is added as `top_up`). */
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true, require_tld: false })
  return_url: string;

  /** Which wallet: `USD`, or the customer's country's currency (the default). */
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency?: string;
}

class WalletQueryDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency?: string;

  /** Ignored: the wallet is always in the customer's own country (older storefronts sent it). */
  @IsOptional() @IsString()
  country?: string;
}

class ReservedAccountDto {
  @IsOptional() @Matches(/^\d{11}$/, { message: 'bvn must be 11 digits' })
  bvn?: string;

  /** The number used by the account provider. Defaults to the customer's profile number. */
  @IsOptional() @Matches(/^[+\d][\d ]{8,15}$/, { message: 'phone must be a phone number' })
  phone?: string;
}

class AddWalletDto {
  @Transform(upper) @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency: string;
}

class ConversionDto {
  @Transform(upper) @Matches(/^[A-Z]{3}$/, { message: 'from must be a 3-letter code' })
  from: string;

  @Transform(upper) @Matches(/^[A-Z]{3}$/, { message: 'to must be a 3-letter code' })
  to: string;

  /** Minor units of the `from` wallet's currency. */
  @IsInt() @Min(1) @Max(100_000_000_00)
  amount: number;

  @IsOptional() @IsBoolean()
  preview?: boolean;

  /** What the customer was shown arriving (minor units of `to`): less than this is refused (`rate_changed`). */
  @IsOptional() @IsInt() @Min(0)
  expected_amount?: number;
}

class SimulateTopUpDto {
  @IsIn(['succeeded', 'failed'])
  outcome: 'succeeded' | 'failed';
}

class SimulateDepositDto {
  @IsInt() @Min(100) @Max(100_000_000_00)
  amount: number;
}

/** A store customer's wallet: balance, top-ups, their own bank account number and activity. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('store/wallet')
export class CustomerWalletController {
  constructor(private readonly wallets: CustomerWalletsService) {}

  @Get()
  get(@CurrentCustomer() caller: CustomerCaller, @Query() query: WalletQueryDto) {
    return this.wallets.get(caller.customer, query.currency);
  }

  /** The currencies the customer could add as wallets. */
  @Get('currencies')
  currencies(@CurrentCustomer() caller: CustomerCaller) {
    return this.wallets.addable(caller.customer);
  }

  @Post('wallets')
  addWallet(@CurrentCustomer() caller: CustomerCaller, @Body() body: AddWalletDto) {
    return this.wallets.addWallet(caller.customer, body.currency);
  }

  @Delete('wallets/:currency')
  removeWallet(@CurrentCustomer() caller: CustomerCaller, @Param('currency') currency: string) {
    return this.wallets.removeWallet(caller.customer, currency);
  }

  @Post('conversions')
  @UseGuards(TransactionPinGuard)
  @HttpCode(HttpStatus.OK)
  convert(@CurrentCustomer() caller: CustomerCaller, @Body() body: ConversionDto) {
    return this.wallets.convert(caller.customer, body);
  }

  @Get('transactions')
  transactions(@CurrentCustomer() caller: CustomerCaller, @Query() page: PageDto) {
    return this.wallets.transactions(caller.customer, page);
  }

  @Post('top-ups')
  @UseGuards(TransactionPinGuard)
  topUp(@CurrentCustomer() caller: CustomerCaller, @Body() body: TopUpDto) {
    return this.wallets.topUp(caller.customer, body);
  }

  @Get('top-ups/:id')
  getTopUp(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.wallets.getTopUp(caller.customer, id);
  }

  @Post('top-ups/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelTopUp(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.wallets.cancelTopUp(caller.customer, id);
  }

  /** Sandbox stores only. */
  @Post('top-ups/:id/simulate')
  @HttpCode(HttpStatus.OK)
  simulateTopUp(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SimulateTopUpDto) {
    return this.wallets.simulateTopUp(caller.customer, id, body.outcome);
  }

  @Post('reserved-accounts')
  @UseGuards(TransactionPinGuard)
  @HttpCode(HttpStatus.OK)
  reservedAccounts(@CurrentCustomer() caller: CustomerCaller, @Body() body: ReservedAccountDto) {
    return this.wallets.createReservedAccounts(caller.customer, body);
  }

  /** Sandbox stores only. */
  @Post('reserved-accounts/:id/simulate-deposit')
  @HttpCode(HttpStatus.OK)
  simulateDeposit(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SimulateDepositDto) {
    return this.wallets.simulateDeposit(caller.customer, id, body.amount);
  }
}
