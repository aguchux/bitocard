import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches, ValidateIf } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly, StepUp } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { AfrippaMarketsService } from './markets.service.js';

class MarketSwitchDto {
  /** Leave it out for all of Afrippa. */
  @IsOptional() @Matches(/^[A-Za-z]{2}$/) country_code?: string;
  /** On, off, or null to follow all of Afrippa (a country) or the default (all of Afrippa). */
  @ValidateIf((_, value) => value !== null) @IsBoolean() enabled: boolean | null;
}

class StoreModeDto {
  @IsIn(['test', 'live']) mode: LedgerMode;
  @IsString() @Length(5, 500) reason: string;
}

/** Afrippa's admins: opening markets and moving Afrippa's store between the sandbox and live (operations, step-up). */
@ApiExcludeController()
@RealmOnly('afrippa_admin')
@AdminRoles('operations', 'finance', 'support')
@Controller('afrippa/admin/markets')
export class AfrippaMarketsAdminController {
  constructor(private readonly markets: AfrippaMarketsService) {}

  @Get()
  overview() {
    return this.markets.overview();
  }

  @AdminRoles('operations')
  @StepUp()
  @Put('switches/:key')
  setSwitch(@CurrentCaller() caller: Caller, @Param('key') key: string, @Body() body: MarketSwitchDto) {
    return this.markets.setSwitch(adminId(caller), key, body.country_code?.toUpperCase() ?? null, body.enabled);
  }

  @AdminRoles('operations')
  @StepUp()
  @Put('store-mode')
  setStoreMode(@CurrentCaller() caller: Caller, @Body() body: StoreModeDto) {
    return this.markets.setStoreMode(adminId(caller), body.mode, body.reason);
  }
}
