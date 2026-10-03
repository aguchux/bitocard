import { Module } from '@nestjs/common';
import { CountriesModule } from '../countries/countries.module.js';
import { AdminStoresController, ResellerController, StorefrontsController, StoresController } from './stores.controller.js';
import { StoresService } from './stores.service.js';

@Module({
  imports: [CountriesModule],
  controllers: [ResellerController, StoresController, StorefrontsController, AdminStoresController],
  providers: [StoresService],
  exports: [StoresService],
})
export class StoresModule {}
