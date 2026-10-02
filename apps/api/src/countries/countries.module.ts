import { Module } from '@nestjs/common';
import { AdminCountriesController, CountriesController } from './countries.controller';
import { CountriesService } from './countries.service';

@Module({
  controllers: [CountriesController, AdminCountriesController],
  providers: [CountriesService],
  exports: [CountriesService],
})
export class CountriesModule {}
