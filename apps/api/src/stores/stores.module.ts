import { Module } from '@nestjs/common';
import { CountriesModule } from '../countries/countries.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminStoresController, ResellerController, StorefrontsController, StoresController, StoreGuideController, StoreTemplatesController, StoreVisitsController } from './stores.controller.js';
import { StoreGuideService } from './store-guide.service.js';
import { StoreHomeService } from './store-home.service.js';
import { StoreVisitsService } from './store-visits.service.js';
import { StoreHostsService } from './store-hosts.service.js';
import { StoresService } from './stores.service.js';

@Module({
  imports: [CountriesModule, SettingsModule],
  controllers: [ResellerController, StoresController, StorefrontsController, AdminStoresController, StoreVisitsController, StoreTemplatesController, StoreGuideController],
  providers: [StoresService, StoreHostsService, StoreVisitsService, StoreHomeService, StoreGuideService],
  exports: [StoresService, StoreHostsService, StoreVisitsService, StoreHomeService],
})
export class StoresModule {}
