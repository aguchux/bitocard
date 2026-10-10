import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, HttpCode, HttpStatus, Injectable, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUrl, Matches, Max, Min } from 'class-validator';
import { Public } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Country, LedgerMode, Payment, ReservedAccount, Reseller, Store } from '../generated/prisma/client.js';
import { PageDto } from '../ledger/wallet.controller.js';
import { minor } from '../ledger/mode.js';
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

/**
 * Store customers' wallets (`customer_wallets` switch, on unless an admin switches it off: global, per market or per
 * reseller; bitocard.com follows its market's house account). A customer tops up their wallet in the seller's currency
 * through BitoCard's checkout methods for the market (card, Flutterwave, mobile money) or a transfer into their own
 * Flutterwave account number, and while wallets are on buys only from it. The balance is what BitoCard owes them
 * (`customer_wallet`, never below zero): it is spent only on the store's products and never withdrawn. Purchases move it
 * to the seller's `customer_payments`, as a checkout payment would; refunds of wallet purchases come back to it.
 */
@Injectable()
export class CustomerWalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoreSellers,
    private readonly settings: SettingsService,
    private readonly payments: PaymentsService,
    private readonly methods: PaymentMethodsService,
  ) {}

  /** Whether customers buying from this seller must use their wallet. */
  enabled(seller: Pick<Reseller, 'id'>) {
    return this.settings.isOn('customer_wallets', seller.id);
  }

  /** The customer's balance in a currency (minor units). */
  async balance(customerId: string, mode: LedgerMode, currency: string) {
    const account = await this.prisma.ledgerAccount.findFirst({ where: { kind: 'customer_wallet', customerId, mode, currency }, select: { balanceMinor: true } });
    return account?.balanceMinor ?? 0n;
  }

  /**
   * The store, mode, seller and market a wallet belongs to: the customer's own country (fixed at sign-up; a reseller's
   * store is the reseller's). An older bitocard.com account without one is asked to choose it first (`country_required`).
   */
  private async context(customer: CustomerWithStore): Promise<WalletContext> {
    const store = customer.store;
    const seller = await this.stores.sellerFor(customer);
    const market = await this.prisma.country.findUniqueOrThrow({ where: { code: seller.country! } });
    return { store, mode: this.stores.mode(store), seller, country: market };
  }

  /** The ways to top up: the market's checkout methods (BitoCard's gateways, never a reseller's own). */
  private async topUpMethods(context: WalletContext) {
    const offered = await this.methods.offered('checkout', context.country, context.mode);
    return Promise.all(offered.map(gateway => this.methods.describe(gateway, context.country)));
  }

  async get(customer: CustomerWithStore) {
    const context = await this.context(customer);
    const { mode, country: market } = context;
    const accounts = await this.payments.customerReservedAccounts(customer.id, mode, market.currency);
    return {
      object: 'customer_wallet' as const,
      mode,
      country: market.code,
      currency: market.currency,
      /** Wallets are on for this store: purchases are paid only from the wallet. */
      enabled: await this.enabled(context.seller),
      balance: minor(await this.balance(customer.id, mode, market.currency)),
      top_up_methods: await this.topUpMethods(context),
      /** Transfers into these top the wallet up (Flutterwave; where the market offers bank account numbers). */
      reserved_accounts: accounts.map(presentAccount),
      reserved_accounts_available: market.reservedAccounts,
      /** Nigeria: the bank needs the customer's BVN to open an account number (passed on, never kept). */
      reserved_account_needs_bvn: mode === 'live' && market.code === 'NG',
    };
  }

  private requireConfirmed(customer: CustomerWithStore) {
    if (!customer.emailVerifiedAt) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'email_not_verified', 'Confirm your email first: enter the code we emailed you.');
    }
  }

  private async requireEnabled(context: WalletContext) {
    if (!(await this.enabled(context.seller))) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'wallets_not_enabled', 'This store does not use wallets: pay when you buy instead.');
    }
  }

  /** Opens a payment page to top the wallet up; it is credited once the gateway confirms the payment. */
  async topUp(customer: CustomerWithStore, input: { amount: number; method?: string; return_url: string }) {
    this.requireConfirmed(customer);
    const context = await this.context(customer);
    await this.requireEnabled(context);
    const offered = await this.methods.offered('checkout', context.country, context.mode);
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
      country: context.country.code,
      currency: context.country.currency,
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

  /** Sandbox stores only: finish a top-up as paid or failed. */
  async simulateTopUp(customer: CustomerWithStore, id: string, outcome: 'succeeded' | 'failed') {
    const payment = await this.prisma.payment.findFirst({ where: { id, customerId: customer.id, purpose: 'customer_top_up' } });
    if (!payment) throw notFound('top-up');
    if (payment.mode !== 'test') throw testModeOnly();
    return presentCustomerTopUp(await this.payments.simulate(payment, outcome));
  }

  /** Opens the customer's own bank account number for the wallet (Flutterwave), where the market offers them. */
  async createReservedAccounts(customer: CustomerWithStore, input: { bvn?: string }) {
    this.requireConfirmed(customer);
    const context = await this.context(customer);
    await this.requireEnabled(context);
    const accounts = await this.payments.createCustomerReservedAccounts({ customer, sellerId: context.seller.id, mode: context.mode, country: context.country, bvn: input.bvn });
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

class TopUpDto {
  /** Minor units of the wallet's currency. */
  @IsInt() @Min(100) @Max(100_000_000_00)
  amount: number;

  @IsOptional() @IsIn(Object.keys(paymentGateways))
  method?: string;

  /** The store page the payment page returns to (the top-up's ID is added as `top_up`). */
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true, require_tld: false })
  return_url: string;
}

class ReservedAccountDto {
  @IsOptional() @Matches(/^\d{11}$/, { message: 'bvn must be 11 digits' })
  bvn?: string;
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
  get(@CurrentCustomer() caller: CustomerCaller) {
    return this.wallets.get(caller.customer);
  }

  @Get('transactions')
  transactions(@CurrentCustomer() caller: CustomerCaller, @Query() page: PageDto) {
    return this.wallets.transactions(caller.customer, page);
  }

  @Post('top-ups')
  topUp(@CurrentCustomer() caller: CustomerCaller, @Body() body: TopUpDto) {
    return this.wallets.topUp(caller.customer, body);
  }

  @Get('top-ups/:id')
  getTopUp(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.wallets.getTopUp(caller.customer, id);
  }

  /** Sandbox stores only. */
  @Post('top-ups/:id/simulate')
  @HttpCode(HttpStatus.OK)
  simulateTopUp(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SimulateTopUpDto) {
    return this.wallets.simulateTopUp(caller.customer, id, body.outcome);
  }

  @Post('reserved-accounts')
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
