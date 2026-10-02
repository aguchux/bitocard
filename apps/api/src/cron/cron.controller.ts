import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, HttpStatus, Inject, Param, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { CronOnly } from '../auth/caller';
import { BillingService } from '../billing/billing.service';
import { ApiError } from '../common/errors/api-error';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { FxService } from '../fx/fx.service';
import { WalletService } from '../ledger/wallet.service';
import { PaymentsService } from '../payments/payments.service';
import { PayoutsService } from '../payouts/payouts.service';

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
