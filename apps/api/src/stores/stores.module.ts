import { Module } from '@nestjs/common';
import { CountriesModule } from '../countries/countries.module';
import { AdminStoresController, ResellerController, StorefrontsController, StoresController } from './stores.controller';
import { StoresService } from './stores.service';

@Module({
  imports: [CountriesModule],
  controllers: [ResellerController, StoresController, StorefrontsController, AdminStoresController],
  providers: [StoresService],
  exports: [StoresService],
})
export class StoresModule {}
