import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, HttpStatus, Inject, Param, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { CronOnly } from '../auth/caller.js';
import { BillingService } from '../billing/billing.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { FxService } from '../fx/fx.service.js';
import { WalletService } from '../ledger/wallet.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { PayoutsService } from '../payouts/payouts.service.js';
import { SuppliersService } from '../suppliers/suppliers.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { SupplierWebhooksService } from '../orders/supplier-webhooks.js';
import { WebhookDeliveryService } from '../webhooks/delivery.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { OwnSuppliersService } from '../reseller-integrations/own-suppliers.service.js';

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
    supplierWebhooks: SupplierWebhooksService,
    ownSuppliers: OwnSuppliersService,
  ) {
    this.jobs = {
      /** Hourly. */
      'exchange-rates': () => fx.refresh(),
      /** Every 10 minutes: settle top-ups and payouts the providers have not notified us about. */
      payments: async () => ({ top_ups: await payments.requeryPending(), payouts: await payouts.refreshProcessing() }),
      /** Hourly. */
      earnings: () => wallets.releaseDueEarnings(),
      /** Daily. */
      plans: () => billing.renewDue(),
      /** Every 2 minutes: check orders the suppliers have not confirmed, and repair interrupted completions. */
      orders: () => orders.checkDue(),
      /** Daily: refresh supplier catalogues and costs, BitoCard's and resellers' own. */
      catalogue: async () => ({ suppliers: await suppliers.syncAll(), own: await ownSuppliers.syncAll() }),
      /** Every minute: send the outbox and due webhook retries (runs also start right after each change). */
      webhooks: () => webhooks.run(),
      /** Every 30 minutes: re-read identity checks the providers have not reported, and close abandoned ones. */
      identity: () => identity.checkOpen(),
      /** Every 5 minutes: retry supplier notifications that are due, and drop old processed ones. */
      'supplier-webhooks': () => supplierWebhooks.processDue(),
      /** Daily: delete events older than 30 days and expired rotated secrets. */
      'webhooks-cleanup': () => webhooks.purge(),
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
