import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { FxModule } from '../fx/fx.module';
import { PaymentsModule } from '../payments/payments.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { CronController } from './cron.controller';

@Module({ imports: [FxModule, PaymentsModule, PayoutsModule, BillingModule], controllers: [CronController] })
export class CronModule {}
