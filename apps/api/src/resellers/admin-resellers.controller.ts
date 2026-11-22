import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min, ValidateIf } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly, StepUp, requireStepUp } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import type { ResellerStatus } from '../generated/prisma/client.js';
import { AdminResellersService } from './admin-resellers.service.js';

const statuses = ['pending', 'active', 'suspended'] as const;

class UpdateResellerDto {
  @IsOptional() @IsIn(statuses) status?: ResellerStatus;
}

class ReasonDto {
  /** Why (kept in the audit log and shown on the reseller's page). */
  @IsString() @Length(5, 500) reason: string;
}

class TestAccountDto extends ReasonDto {
  /** Activate the reseller at once (when pending). */
  @IsOptional() @IsBoolean() activate?: boolean;
}

class ResellerFilterDto {
  @IsOptional() @IsIn(statuses) status?: ResellerStatus;
  @IsOptional() @IsString() country?: string;
}

class StoreLimitDto {
  /** How many stores (1 to 1000), or null to follow everyone's ceiling. */
  @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(1000) max_stores: number | null;
  /** Why (kept in the audit log). */
  @IsString() @Length(5, 500) reason: string;
}

@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin')
export class AdminResellersController {
  constructor(private readonly resellers: AdminResellersService) {}

  @AdminRoles('operations', 'support', 'finance')
  @Get('resellers')
  listResellers(@Query() query: ResellerFilterDto) {
    return this.resellers.listResellers(query);
  }

  @AdminRoles('operations', 'support', 'finance')
  @Get('resellers/:id')
  reseller(@Param('id', ParseUUIDPipe) id: string) {
    return this.resellers.resellerDetail(id);
  }

  @AdminRoles('operations')
  @Patch('resellers/:id')
  updateReseller(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateResellerDto) {
    if (body.status === 'active') requireStepUp(caller);
    return this.resellers.updateReseller(adminId(caller), id, body);
  }

  /** Marks a test account: activated without the identity check, never moving money out. Audited with the reason. */
  @AdminRoles('operations')
  @StepUp()
  @Post('resellers/:id/test-account')
  @HttpCode(HttpStatus.OK)
  markTestAccount(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: TestAccountDto) {
    return this.resellers.markTestAccount(adminId(caller), id, body);
  }

  /** Lifts a suspension: active again when verified (or a test account), else pending. Audited with the reason. */
  @AdminRoles('operations')
  @StepUp()
  @Post('resellers/:id/unsuspend')
  @HttpCode(HttpStatus.OK)
  unsuspend(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.resellers.unsuspend(adminId(caller), id, body);
  }

  /** No longer a test account; an unverified active one goes back to pending. Audited with the reason. */
  @AdminRoles('operations')
  @StepUp()
  @Post('resellers/:id/test-account/remove')
  @HttpCode(HttpStatus.OK)
  unmarkTestAccount(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.resellers.unmarkTestAccount(adminId(caller), id, body);
  }

  /** How many stores the reseller may run (null: everyone's ceiling). Audited with the reason. */
  @AdminRoles('operations')
  @StepUp()
  @Put('resellers/:id/store-limit')
  setStoreLimit(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: StoreLimitDto) {
    return this.resellers.setStoreLimit(adminId(caller), id, body);
  }

  @AdminRoles('operations', 'support', 'finance')
  @Get('resellers/:id/history')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.resellers.history(id);
  }
}
