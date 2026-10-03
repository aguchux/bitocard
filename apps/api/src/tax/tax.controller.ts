import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsString, Length, Max, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { TaxService } from './tax.service.js';

class TaxRateDto {
  @IsString() @Length(2, 40)
  name: string;

  @IsInt() @Min(0) @Max(5000)
  rate_bps: number;

  @IsBoolean()
  prices_include_tax: boolean;

  /** Set only after tax advice for the country: live sales use confirmed rates only. */
  @IsBoolean()
  confirmed: boolean;
}

@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/tax-rates')
export class AdminTaxController {
  constructor(private readonly tax: TaxService) {}

  @AdminRoles('finance', 'operations')
  @Get()
  list() {
    return this.tax.list();
  }

  @AdminRoles('finance')
  @Put(':country')
  set(@CurrentCaller() caller: Caller, @Param('country') country: string, @Body() body: TaxRateDto) {
    return this.tax.set(adminId(caller), country.toUpperCase(), body);
  }
}
