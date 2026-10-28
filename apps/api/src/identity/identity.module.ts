import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminVerificationsController, ResellerBvnController, CustomerVerificationController, IdentityWebhooksController, ResellerVerificationController } from './identity.controller.js';
import { IdentityService } from './identity.service.js';
import {
  AdminKycController,
  AfrippaAdminKycController,
  AfrippaKycCaseController,
  AfrippaKycSessionController,
  AfrippaKycSessionGuard,
  KycCaseController,
  KycReviewsController,
  KycSessionController,
  KycSessionGuard,
} from '../kyc/kyc.controller.js';
import { KycService } from '../kyc/kyc.service.js';
import { VerifyLinks } from '../kyc/links.js';
import { KycStorage } from '../kyc/storage.js';

@Module({
  imports: [SettingsModule],
  controllers: [
    ResellerVerificationController,
    ResellerBvnController,
    CustomerVerificationController,
    AdminVerificationsController,
    IdentityWebhooksController,
    KycSessionController,
    KycCaseController,
    KycReviewsController,
    AdminKycController,
    AfrippaKycSessionController,
    AfrippaKycCaseController,
    AfrippaAdminKycController,
  ],
  providers: [IdentityService, VerifyLinks, KycStorage, KycService, KycSessionGuard, AfrippaKycSessionGuard],
  exports: [IdentityService, KycService],
})
export class IdentityModule {}
