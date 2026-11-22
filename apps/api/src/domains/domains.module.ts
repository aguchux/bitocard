import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminDomainsController, DomainsController, StorefrontDomainsController } from './domains.controller.js';
import { DomainsService } from './domains.service.js';

@Module({
  imports: [LedgerModule, FxModule, SettingsModule],
  controllers: [DomainsController, StorefrontDomainsController, AdminDomainsController],
  providers: [DomainsService],
  exports: [DomainsService],
})
export class DomainsModule {}
