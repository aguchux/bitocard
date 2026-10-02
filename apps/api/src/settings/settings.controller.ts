import { Body, Controller, Get, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsBoolean, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly, Roles, SessionOnly } from '../auth/caller';
import { ApiError } from '../common/errors/api-error';
import { adminId } from '../countries/countries.controller';
import { SettingsService } from './settings.service';

class OptionValueDto {
  @ApiProperty({ example: 'bank' })
  @IsString()
  @Length(1, 40)
  value: string;
}

class CountryOptionDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  allowed: string[];

  @IsString()
  default: string;
}

class SwitchDto {
  /** Leave both scope fields out for the global switch. */
  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/)
  country_code?: string;

  @IsOptional()
  @IsUUID()
  reseller_id?: string;

  /** true or false sets the switch; null clears it so the wider scope applies. */
  @ValidateIf((dto: SwitchDto) => dto.enabled !== null)
  @IsBoolean()
  enabled: boolean | null;
}

function resellerOf(caller: Caller) {
  if (!caller.resellerId) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'not_permitted', 'Choose a reseller account first.');
  return caller.resellerId;
}

/** A reseller's settings: their choices within what BitoCard allows in their country, and switched-on features. */
@ApiTags('Settings')
@SessionOnly()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @ApiOperation({ summary: 'Retrieve settings', description: 'Each option shows the effective value, what is allowed in your country, and whether it is your choice or the default.' })
  @Get()
  async get(@CurrentCaller() caller: Caller) {
    const resellerId = resellerOf(caller);
    return { object: 'settings' as const, options: await this.settings.effectiveOptions(resellerId), features: await this.settings.switchesFor(resellerId) };
  }

  @ApiOperation({ summary: 'Choose an option', description: 'The value must be one your country allows.' })
  @Roles('admin')
  @Put('options/:key')
  async setOption(@CurrentCaller() caller: Caller, @Param('key') key: string, @Body() body: OptionValueDto) {
    return { object: 'settings' as const, options: await this.settings.setResellerOption(resellerOf(caller), key, body.value) };
  }
}

/** Admin: options per country, and feature switches. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('operations')
@Controller('admin')
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Put('countries/:code/options/:key')
  setCountryOption(@CurrentCaller() caller: Caller, @Param('code') code: string, @Param('key') key: string, @Body() body: CountryOptionDto) {
    return this.settings.setCountryOption(adminId(caller), code, key, body.allowed, body.default);
  }

  @Get('switches')
  listSwitches() {
    return this.settings.listSwitches();
  }

  @Put('switches/:key')
  setSwitch(@CurrentCaller() caller: Caller, @Param('key') key: string, @Body() body: SwitchDto) {
    return this.settings.setSwitch(adminId(caller), key, { countryCode: body.country_code, resellerId: body.reseller_id }, body.enabled);
  }
}
