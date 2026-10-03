import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminVerificationsController, ResellerBvnController, CustomerVerificationController, IdentityWebhooksController, ResellerVerificationController } from './identity.controller.js';
import { IdentityService } from './identity.service.js';

@Module({
  imports: [SettingsModule],
  controllers: [ResellerVerificationController, ResellerBvnController, CustomerVerificationController, AdminVerificationsController, IdentityWebhooksController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
