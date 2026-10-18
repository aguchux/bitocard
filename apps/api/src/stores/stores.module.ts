import { Module } from '@nestjs/common';
import { CountriesModule } from '../countries/countries.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminStoresController, ResellerController, StorefrontsController, StoresController } from './stores.controller.js';
import { StoreHostsService } from './store-hosts.service.js';
import { StoresService } from './stores.service.js';

@Module({
  imports: [CountriesModule, SettingsModule],
  controllers: [ResellerController, StoresController, StorefrontsController, AdminStoresController],
  providers: [StoresService, StoreHostsService],
  exports: [StoresService, StoreHostsService],
})
export class StoresModule {}
