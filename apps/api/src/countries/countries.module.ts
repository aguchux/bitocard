import { Module } from '@nestjs/common';
import { AdminCountriesController, CountriesController } from './countries.controller.js';
import { CountriesService } from './countries.service.js';

@Module({
  controllers: [CountriesController, AdminCountriesController],
  providers: [CountriesService],
  exports: [CountriesService],
})
export class CountriesModule {}
