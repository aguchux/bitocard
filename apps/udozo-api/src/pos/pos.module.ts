import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { ClassifiedsModule } from '../classifieds/classifieds.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { PosCustomersService } from './customers.service.js';
import { PosBillingService } from './billing.service.js';
import { PosCatalogueService } from './catalogue.service.js';
import { PosAdminService } from './pos-admin.service.js';
import { AdminPosController, PosOwnerController, PosPaymentsController, PublicPosController } from './pos.controller.js';
import { PosService } from './pos.service.js';
import { PosSalesService } from './sales.service.js';
import { PosWalletService } from './wallet.service.js';

/** Udozo POS (docs/UDOZO_POS_PLAN.md): owners' accounts, shops and tills, the three plans and their monthly charges. */
@Module({
  imports: [CheckoutModule, SettingsModule, ClassifiedsModule],
  controllers: [PublicPosController, PosOwnerController, PosPaymentsController, AdminPosController],
  providers: [PosService, PosBillingService, PosAdminService, PosCatalogueService, PosSalesService, PosWalletService, PosCustomersService],
  exports: [PosBillingService],
})
export class PosModule {}
