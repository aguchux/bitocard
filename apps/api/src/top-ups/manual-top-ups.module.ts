import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { AdminManualTopUpsController } from './manual-top-ups.controller.js';
import { ManualTopUpsService } from './manual-top-ups.service.js';

/** Finance admins' manual top-ups of reseller and customer wallets, confirmed by a code emailed to the admin. */
@Module({
  imports: [CheckoutModule],
  controllers: [AdminManualTopUpsController],
  providers: [ManualTopUpsService],
})
export class ManualTopUpsModule {}
