import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { ClassifiedsModule } from '../classifieds/classifieds.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { CustomerCashModule } from '../payouts/customer-cash.js';
import { PayoutsModule } from '../payouts/payouts.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { WhatsappModule } from '../whatsapp/whatsapp.module.js';
import { PosOwnerReceiptsController, PosStaffReceiptsController } from './receipts.controller.js';
import { PosReceiptsService } from './receipts.service.js';
import { PosCollectionsService } from './collections.service.js';
import { PosCustomersService } from './customers.service.js';
import { PosBillingService } from './billing.service.js';
import { PosCatalogueService } from './catalogue.service.js';
import { PosAdminService } from './pos-admin.service.js';
import { AdminPosController, PosOwnerController, PosPaymentsController, PublicPosController } from './pos.controller.js';
import { PosService } from './pos.service.js';
import { PosSalesService } from './sales.service.js';
import { PosWalletService } from './wallet.service.js';
import { PosDeviceGuard, PosGuard } from './pos.guard.js';
import { PosDeviceController, PosOwnerStaffController, PosStaffAuthController, PosStaffController } from './staff.controller.js';
import { PosStaffService } from './staff.service.js';

/** Udozo POS (docs/UDOZO_POS_PLAN.md): owners' accounts, shops and tills, the three plans and their monthly charges. */
@Module({
  imports: [AuthModule, CheckoutModule, SettingsModule, ClassifiedsModule, PaymentsModule, PayoutsModule, CustomerCashModule, WhatsappModule],
  controllers: [PublicPosController, PosOwnerController, PosPaymentsController, AdminPosController, PosStaffAuthController, PosDeviceController, PosOwnerStaffController, PosStaffController, PosOwnerReceiptsController, PosStaffReceiptsController],
  providers: [PosService, PosBillingService, PosAdminService, PosCatalogueService, PosSalesService, PosWalletService, PosCustomersService, PosCollectionsService, PosStaffService, PosReceiptsService, PosGuard, PosDeviceGuard],
  exports: [PosBillingService, PosCollectionsService],
})
export class PosModule {}
