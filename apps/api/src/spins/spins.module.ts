import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { FxModule } from '../fx/fx.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminSpinsController, CustomerSpinsController, PublicSpinsController } from './spins.controller.js';
import { SpinsService } from './spins.service.js';

/** Spin and win: BitoCard's promotion, paid in US dollars into the customer's store wallet (no longer crypto). */
@Module({
  imports: [CheckoutModule, FxModule, SettingsModule],
  controllers: [CustomerSpinsController, PublicSpinsController, AdminSpinsController],
  providers: [SpinsService],
})
export class SpinsModule {}
