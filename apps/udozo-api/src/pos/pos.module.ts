import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { PosBillingService } from './billing.service.js';
import { PosCatalogueService } from './catalogue.service.js';
import { PosAdminService } from './pos-admin.service.js';
import { AdminPosController, PosOwnerController, PublicPosController } from './pos.controller.js';
import { PosService } from './pos.service.js';

/** Udozo POS (docs/UDOZO_POS_PLAN.md): owners' accounts, shops and tills, the three plans and their monthly charges. */
@Module({
  imports: [CheckoutModule, SettingsModule],
  controllers: [PublicPosController, PosOwnerController, AdminPosController],
  providers: [PosService, PosBillingService, PosAdminService, PosCatalogueService],
  exports: [PosBillingService],
})
export class PosModule {}
