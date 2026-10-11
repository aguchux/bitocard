import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import type { ResellerStatus } from '../generated/prisma/client.js';
import { PlansService, presentPlan } from './plans.service.js';

const statuses = ['pending', 'active', 'suspended'] as const;

class UpdatePlanDto {
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) price_cents?: number;
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) features?: string[];
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) api_restrictions?: string[];
}

class UpdateResellerDto {
  @IsOptional() @IsIn(statuses) status?: ResellerStatus;
  @IsOptional() @IsString() plan?: string;
}

class WaiverReasonDto {
  /** Why (kept in the audit log and shown on the reseller's page). */
  @IsString() @Length(5, 500) reason: string;
}

class WaiveIdentityDto extends WaiverReasonDto {
  /** Activate the reseller at once (when pending). */
  @IsOptional() @IsBoolean() activate?: boolean;
}

class ResellerFilterDto {
  @IsOptional() @IsIn(statuses) status?: ResellerStatus;
  @IsOptional() @IsString() country?: string;
}

@ApiTags('Plans')
@Public()
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @ApiOperation({ summary: 'List reseller plans', description: 'Standard is free; Premium adds chargeback handling, priority support and international selling.' })
  @Get()
  async list() {
    return { object: 'list' as const, data: (await this.plans.list()).map(presentPlan) };
  }
}

@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin')
export class AdminPlansController {
  constructor(private readonly plans: PlansService) {}

  @AdminRoles('finance')
  @Patch('plans/:code')
  updatePlan(@CurrentCaller() caller: Caller, @Param('code') code: string, @Body() body: UpdatePlanDto) {
    return this.plans.update(adminId(caller), code, body);
  }

  @AdminRoles('operations', 'support', 'finance')
  @Get('resellers')
  listResellers(@Query() query: ResellerFilterDto) {
    return this.plans.listResellers(query);
  }

  @AdminRoles('operations', 'support', 'finance')
  @Get('resellers/:id')
  reseller(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.resellerDetail(id);
  }

  @AdminRoles('operations')
  @Patch('resellers/:id')
  updateReseller(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateResellerDto) {
    return this.plans.updateReseller(adminId(caller), id, body);
  }

  /** Lets the reseller go live without the owner's identity check. Audited with the reason. */
  @AdminRoles('operations')
  @Post('resellers/:id/identity-waiver')
  @HttpCode(HttpStatus.OK)
  waiveIdentity(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: WaiveIdentityDto) {
    return this.plans.waiveIdentity(adminId(caller), id, body);
  }

  /** Asks for the identity check again; an unverified active reseller goes back to pending. Audited with the reason. */
  @AdminRoles('operations')
  @Post('resellers/:id/identity-waiver/remove')
  @HttpCode(HttpStatus.OK)
  restoreIdentityCheck(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: WaiverReasonDto) {
    return this.plans.restoreIdentityCheck(adminId(caller), id, body);
  }

  @AdminRoles('operations', 'support', 'finance')
  @Get('resellers/:id/history')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.history(id);
  }
}
