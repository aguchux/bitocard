import { Body, Controller, Get, HttpCode, HttpStatus, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly, StepUp } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { CountriesModule } from '../countries/countries.module.js';
import { ProductOnly } from '../products/product.js';
import { AccountSwitchService } from './account-switch.service.js';

class MakeCustomerDto {
  /** Why (audited). */
  @IsString() @Length(3, 500) reason: string;
  /** Also suspend the reseller account (refused while BitoCard holds money for it). */
  @IsOptional() @IsBoolean() suspend_reseller?: boolean;
}

class MakeResellerDto {
  /** The new reseller account's business name. */
  @IsString() @Length(2, 120) business_name: string;
  /** Why (audited). */
  @IsString() @Length(3, 500) reason: string;
}

/** Admin app: a reseller's page ("Make a customer") and a bitocard.com customer's page ("Make a reseller"). */
@ApiExcludeController()
@ProductOnly('bitocard')
@RealmOnly('admin')
@Controller('admin')
export class AccountSwitchController {
  constructor(private readonly switches: AccountSwitchService) {}

  @AdminRoles('operations', 'support')
  @Get('resellers/:id/make-customer')
  customerPreview(@Param('id', ParseUUIDPipe) id: string) {
    return this.switches.customerPreview(id);
  }

  @AdminRoles('operations')
  @StepUp()
  @Post('resellers/:id/make-customer')
  @HttpCode(HttpStatus.OK)
  makeCustomer(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: MakeCustomerDto) {
    return this.switches.makeCustomer(adminId(caller), id, body);
  }

  @AdminRoles('operations', 'support')
  @Get('storefront/customers/:id/make-reseller')
  resellerPreview(@Param('id', ParseUUIDPipe) id: string) {
    return this.switches.resellerPreview(id);
  }

  @AdminRoles('operations')
  @StepUp()
  @Post('storefront/customers/:id/make-reseller')
  @HttpCode(HttpStatus.OK)
  makeReseller(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: MakeResellerDto) {
    return this.switches.makeReseller(adminId(caller), id, body);
  }
}

@Module({ imports: [CountriesModule], controllers: [AccountSwitchController], providers: [AccountSwitchService] })
export class AccountSwitchModule {}
