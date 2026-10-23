import { InvoicesService } from '../billing/invoices.service.js';
import { DomainsService } from '../domains/domains.service.js';
import { StoreHostsService } from '../stores/store-hosts.service.js';
import { StoreVisitsService } from '../stores/store-visits.service.js';
import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, HttpStatus, Inject, Param, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { CronOnly } from '../auth/caller.js';
import { BillingService } from '../billing/billing.service.js';
import { CheckoutService } from '../checkout/checkout.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { FxService } from '../fx/fx.service.js';
import { WalletService } from '../ledger/wallet.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { CustomerPayoutsService } from '../payouts/customer-payouts.service.js';
import { PayoutsService } from '../payouts/payouts.service.js';
import { SuppliersService } from '../suppliers/suppliers.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { SupplierWebhooksService } from '../orders/supplier-webhooks.js';
import { WebhookDeliveryService } from '../webhooks/delivery.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { KycService } from '../kyc/kyc.service.js';
import { OwnSuppliersService } from '../reseller-integrations/own-suppliers.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { PushService } from '../notifications/push.service.js';
import { MediaService } from '../media/media.service.js';
import { NumbersService } from '../numbers/numbers.service.js';
import { EsimsService } from '../esims/esims.service.js';
import { VpnService } from '../vpn/vpn.service.js';
import { CryptoDepositsService, depositBudgetMs } from '../crypto/chains/deposits.service.js';
import { CryptoReconciliationService } from '../crypto/custody/reconciliation.service.js';
import { CryptoWithdrawalsService } from '../crypto/withdrawals.service.js';
import { BotsService } from '../support/bots.service.js';
import { ChatsService } from '../support/chats.service.js';
import { RepliesService } from '../support/replies.service.js';
import { TicketsService } from '../support/tickets.service.js';

/**
 * Scheduled jobs, called by Vercel Cron (see vercel.json) with `Authorization: Bearer <CRON_SECRET>`.
 * Every job is safe to run twice or late.
 */
@ApiExcludeController()
@CronOnly()
@Controller('cron')
export class CronController {
  private readonly jobs: Record<string, () => Promise<unknown>>;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    fx: FxService,
    payments: PaymentsService,
    payouts: PayoutsService,
    wallets: WalletService,
    billing: BillingService,
    suppliers: SuppliersService,
    orders: OrdersService,
    webhooks: WebhookDeliveryService,
    identity: IdentityService,
    kyc: KycService,
    supplierWebhooks: SupplierWebhooksService,
    ownSuppliers: OwnSuppliersService,
    inbox: InboxService,
    push: PushService,
    media: MediaService,
    checkout: CheckoutService,
    numbers: NumbersService,
    esims: EsimsService,
    deposits: CryptoDepositsService,
    withdrawals: CryptoWithdrawalsService,
    customerPayouts: CustomerPayoutsService,
    reconciliation: CryptoReconciliationService,
    domains: DomainsService,
    storeHosts: StoreHostsService,
    storeVisits: StoreVisitsService,
    vpn: VpnService,
    bots: BotsService,
    replies: RepliesService,
    chats: ChatsService,
    tickets: TicketsService,
    invoices: InvoicesService,
  ) {
    this.jobs = {
      /** Hourly. */
      'exchange-rates': () => fx.refresh(),
      /**
       * Every 10 minutes: settle top-ups, checkout payments and payouts the providers have not notified us about, and
       * credit transfers into reserved accounts whose notification never came.
       */
      payments: async () => ({
        top_ups: await payments.requeryPending(),
        reserved_deposits: await payments.sweepReservedDeposits(),
        payouts: await payouts.refreshProcessing(),
        customer_payouts: await customerPayouts.job(),
      }),
      /** Every 5 minutes: place orders for paid checkouts the request did not finish, send and check customer refunds. */
      checkout: () => checkout.job(),
      /** Hourly. */
      earnings: () => wallets.releaseDueEarnings(),
      /** Daily. */
      plans: () => billing.renewDue(),
      /** Hourly: close last month's invoices, drop the credit limit for overdue ones, pay what is owed from top-ups. */
      invoices: () => invoices.run(),
      /** Hourly: virtual number renewals, reminders, pausing at expiry, deletion 15 days later, and old messages. */
      numbers: () => numbers.job(),
      esims: () => esims.job(),
      /** Every 15 minutes: end VPN access at its expiry or after a refund (verified with the supplier), fix expiry drift, retry unconfirmed password resets. */
      vpn: () => vpn.job(),
      /** Daily: the VPN supplier's Active accounts and credit against BitoCard's active VPN access. */
      'vpn-reconcile': () => vpn.reconcile(),
      /** Daily: assistants whose store changed since their knowledge base was updated (flagged, or updated by itself); chats ended over 12 months ago and tickets resolved over two years ago deleted. */
      support: async () => ({ knowledge: await bots.checkStale(), chats_deleted: await chats.purgeOld(), tickets_deleted: await tickets.purgeOld() }),
      /** Every 5 minutes: chats and tickets an assistant's answer after the reply never reached. */
      'support-replies': () => replies.job(),
      /**
       * Every 15 minutes: stores' bitocard.com addresses, past days' visitor hashes and salts, then domain purchases, DNS
       * checks, renewals and reminders.
       */
      domains: async () => ({ store_addresses: await storeHosts.job(), store_visits: await storeVisits.cleanup(), ...(await domains.run()) }),
      /** Every 2 minutes: check orders the suppliers have not confirmed, and repair interrupted completions. */
      orders: () => orders.checkDue(),
      /** Daily: refresh supplier catalogues and costs, BitoCard's and resellers' own. */
      catalogue: async () => ({ suppliers: await suppliers.syncAll(), own: await ownSuppliers.syncAll() }),
      /** Every minute: send the outbox and due webhook retries (runs also start right after each change). */
      webhooks: () => webhooks.run(),
      /**
       * Every 30 minutes: re-read identity checks the providers have not reported, and close abandoned ones; then delete
       * BitoCard Verify documents past their retention.
       */
      identity: async () => ({ ...(await identity.checkOpen()), verify: await kyc.job() }),
      /** Every 5 minutes: retry supplier notifications that are due, and drop old processed ones. */
      'supplier-webhooks': () => supplierWebhooks.processDue(),
      /** Daily: delete events older than 30 days and expired rotated secrets. */
      'webhooks-cleanup': () => webhooks.purge(),
      /** Every 5 minutes: retry push notifications that are due (pushes start right after each notification). */
      push: () => push.runDue(),
      /** Daily: delete in-app notifications older than 90 days (and their pushes). */
      'notifications-cleanup': () => inbox.purge(),
      /**
       * Every 2 minutes: crypto withdrawals (sent, checked on chain, settled), then deposits (pending ones settled, then
       * customers' addresses scanned, re-read, credited once confirmed) within a deadline, so the run ends inside the
       * function's 300 seconds and a slow scan never stops withdrawals or settlement.
       */
      crypto: async () => {
        const deadline = Date.now() + depositBudgetMs;
        const sent = await withdrawals.job();
        return { deposits: await deposits.job({ deadline }), withdrawals: sent };
      },
      /** Every 15 minutes: every blockchain provider's latest block (Crypto > Chains health). */
      'chain-health': () => deposits.checkAll(),
      /** Daily: each asset's crypto_custody against what the signer's wallets hold (live; the sandbox only with a test signer). */
      'crypto-reconcile': async () => ({ live: await reconciliation.run('live'), test: await reconciliation.run('test') }),
      /** Daily: remove uploads that were started but never completed. */
      'media-cleanup': () => media.purgeAbandoned(),
    };
  }

  @Get(':job')
  async run(@Req() req: Request, @Param('job') job: string) {
    const secret = this.config.CRON_SECRET;
    const given = req.get('authorization') ?? '';
    const expected = `Bearer ${secret}`;
    if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'unauthenticated', 'Cron secret missing or wrong.');
    }
    const handler = this.jobs[job];
    if (!handler) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such job.');
    return { object: 'cron_run' as const, job, result: await handler() };
  }
}
