import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminResellerIntegrationsController, ResellerIntegrationsController } from './reseller-integrations.controller.js';
import { ResellerIntegrationsService } from './reseller-integrations.service.js';
import { OwnSuppliersService } from './own-suppliers.service.js';

/** Resellers' own supplier and payment gateway connections (see PLANS.md, Reseller's own integrations). */
@Module({
  imports: [SettingsModule],
  controllers: [ResellerIntegrationsController, AdminResellerIntegrationsController],
  providers: [ResellerIntegrationsService, OwnSuppliersService],
  exports: [ResellerIntegrationsService, OwnSuppliersService],
})
export class ResellerIntegrationsModule {}
