import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AdminVerificationsController, CustomerVerificationController, IdentityWebhooksController, ResellerVerificationController } from './identity.controller';
import { IdentityService } from './identity.service';

@Module({
  imports: [SettingsModule],
  controllers: [ResellerVerificationController, CustomerVerificationController, AdminVerificationsController, IdentityWebhooksController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
