import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { FxService } from './fx.service.js';

class CurrencySettingDto {
  @IsOptional() @IsInt() @Min(0) @Max(2000)
  margin_bps?: number;

  @IsOptional() @IsInt() @Min(10) @Max(5000)
  divergence_bps?: number;

  @IsOptional() @IsBoolean()
  paused?: boolean;
}

@ApiTags('Exchange rates')
@Public()
@Controller('exchange-rates')
export class FxController {
  constructor(private readonly fx: FxService) {}

  @ApiOperation({
    summary: 'List exchange rates',
    description:
      'Rates BitoCard uses against the US dollar, including its disclosed conversion margin. `pay` applies when paying in the currency for a USD amount; `receive` when USD is converted into it. A paused currency shows `available: false`.',
  })
  @Get()
  @Header('Cache-Control', 'public, max-age=300')
  list() {
    return this.fx.list();
  }
}

@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('finance')
@Controller('admin/currencies')
export class AdminFxController {
  constructor(private readonly fx: FxService) {}

  @Get()
  list() {
    return this.fx.adminList();
  }

  /** Fetch rates now instead of waiting for the schedule. */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh() {
    return this.fx.refresh();
  }

  @Patch(':currency')
  update(@CurrentCaller() caller: Caller, @Param('currency') currency: string, @Body() body: CurrencySettingDto) {
    return this.fx.update(adminId(caller), currency.toUpperCase(), body);
  }
}
