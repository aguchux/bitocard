import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, StepUp, requireStepUp } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import type { ResellerStatus } from '../generated/prisma/client.js';
import { PlansService } from './plans.service.js';

const statuses = ['pending', 'active', 'suspended'] as const;

class UpdatePlanDto {
  @IsOptional() @IsString() @Length(1, 40) name?: string;
  @IsOptional() @IsString() @Length(0, 300) description?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) price_cents?: number;
  /** Fixed monthly prices per market currency, in minor units (`{ NGN: 3500000 }`); null goes back to converting. */
  @IsOptional() @IsObject() local_prices?: Record<string, number | null>;
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) features?: string[];
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) api_restrictions?: string[];
  /** Resellers can choose it; false hides it from new subscribers (those on it keep it). */
  @IsOptional() @IsBoolean() available?: boolean;
  /** Its place in the list, lowest first. */
  @IsOptional() @IsInt() @Min(0) @Max(10_000) sort_order?: number;
}

class CreatePlanDto {
  /** Its code, for example `business` (lower-case letters, numbers and underscores). */
  @IsString() @Length(2, 30) code: string;
  @IsString() @Length(1, 40) name: string;
  @IsOptional() @IsString() @Length(0, 300) description?: string | null;
  /** The monthly price in US cents (above zero: only Standard is free). */
  @IsInt() @Min(1) @Max(1_000_000) price_cents: number;
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) features?: string[];
  @IsOptional() @IsBoolean() available?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) sort_order?: number;
}

class PlanFeatureDto {
  /** Whether the plan includes the feature. */
  @IsBoolean() enabled: boolean;
}

class PlansQueryDto {
  @ApiPropertyOptional({ description: 'A currency (ISO 4217): each plan then carries its monthly price in it as `local_price`.', example: 'NGN' })
  @IsOptional() @Matches(/^[A-Za-z]{3}$/) currency?: string;
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

  @ApiOperation({
    summary: 'List reseller plans',
    description:
      'Standard is free; Premium adds what BitoCard places on it (`feature_details` names each feature). With `currency`, each plan carries `local_price`: what it costs a month in that currency, a fixed price BitoCard set (`fixed: true`) or the US dollar price at today\'s rate.',
  })
  @Get()
  async list(@Query() query: PlansQueryDto) {
    return { object: 'list' as const, data: await this.plans.publicList(query.currency) };
  }
}

@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin')
export class AdminPlansController {
  constructor(private readonly plans: PlansService) {}

  /** Every plan with its prices per market currency, and where each plan feature sits (free or Premium). */
  @AdminRoles('finance', 'operations', 'support')
  @Get('plans')
  overview() {
    return this.plans.adminOverview();
  }

  /** A new paid plan with its features. Audited. */
  @AdminRoles('finance')
  @StepUp()
  @Post('plans')
  createPlan(@CurrentCaller() caller: Caller, @Body() body: CreatePlanDto) {
    return this.plans.create(adminId(caller), body);
  }

  /** Switches one feature on or off for one plan; resellers on it gain or lose it at once. Audited. */
  @AdminRoles('finance')
  @StepUp()
  @Put('plans/:code/features/:feature')
  setFeature(@CurrentCaller() caller: Caller, @Param('code') code: string, @Param('feature') feature: string, @Body() body: PlanFeatureDto) {
    return this.plans.setFeature(adminId(caller), code, feature, body.enabled);
  }

  /** Deletes a plan nobody is on (never Standard). Audited. */
  @AdminRoles('finance')
  @StepUp()
  @Delete('plans/:code')
  removePlan(@CurrentCaller() caller: Caller, @Param('code') code: string) {
    return this.plans.remove(adminId(caller), code);
  }

  @AdminRoles('finance')
  @StepUp()
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
    if (body.status === 'active' || body.plan !== undefined) requireStepUp(caller);
    return this.plans.updateReseller(adminId(caller), id, body);
  }

  /** Lets the reseller go live without the owner's identity check. Audited with the reason. */
  @AdminRoles('operations')
  @StepUp()
  @Post('resellers/:id/identity-waiver')
  @HttpCode(HttpStatus.OK)
  waiveIdentity(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: WaiveIdentityDto) {
    return this.plans.waiveIdentity(adminId(caller), id, body);
  }

  /** Lifts a suspension: active again when verified (or waived), else pending. Audited with the reason. */
  @AdminRoles('operations')
  @StepUp()
  @Post('resellers/:id/unsuspend')
  @HttpCode(HttpStatus.OK)
  unsuspend(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: WaiverReasonDto) {
    return this.plans.unsuspend(adminId(caller), id, body);
  }

  /** Asks for the identity check again; an unverified active reseller goes back to pending. Audited with the reason. */
  @AdminRoles('operations')
  @StepUp()
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
