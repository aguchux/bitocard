import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminDomainsController, DomainsController, FreeDomainController, StorefrontDomainsController } from './domains.controller.js';
import { DomainsService } from './domains.service.js';

@Module({
  imports: [LedgerModule, FxModule, SettingsModule],
  controllers: [DomainsController, FreeDomainController, StorefrontDomainsController, AdminDomainsController],
  providers: [DomainsService],
  exports: [DomainsService],
})
export class DomainsModule {}
