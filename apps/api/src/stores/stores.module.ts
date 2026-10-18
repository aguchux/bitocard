import { Module } from '@nestjs/common';
import { CountriesModule } from '../countries/countries.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminStoresController, ResellerController, StorefrontsController, StoresController, StoreVisitsController } from './stores.controller.js';
import { StoreVisitsService } from './store-visits.service.js';
import { StoreHostsService } from './store-hosts.service.js';
import { StoresService } from './stores.service.js';

@Module({
  imports: [CountriesModule, SettingsModule],
  controllers: [ResellerController, StoresController, StorefrontsController, AdminStoresController, StoreVisitsController],
  providers: [StoresService, StoreHostsService, StoreVisitsService],
  exports: [StoresService, StoreHostsService, StoreVisitsService],
})
export class StoresModule {}
