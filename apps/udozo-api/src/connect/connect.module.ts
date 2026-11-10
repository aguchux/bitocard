import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { MediaModule } from '../media/media.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { ConnectApplicationsService } from './applications.service.js';
import { ConnectAdminService } from './connect-admin.service.js';
import { AdminConnectCentresController, ConnectCentresController, PublicConnectCentresController } from './centres.controller.js';
import { ConnectCentresService } from './centres.service.js';
import { AdminConnectController, ConnectApplicationsController } from './connect.controller.js';

/** Udozo Connect (docs/UDOZO_CONNECT_PLAN.md): Connect Centre applications, Udozo's review and visits, and centres. */
@Module({
  imports: [CheckoutModule, IdentityModule, MediaModule, SettingsModule],
  controllers: [ConnectApplicationsController, ConnectCentresController, PublicConnectCentresController, AdminConnectController, AdminConnectCentresController],
  providers: [ConnectApplicationsService, ConnectAdminService, ConnectCentresService],
  exports: [ConnectApplicationsService, ConnectCentresService],
})
export class ConnectModule {}
