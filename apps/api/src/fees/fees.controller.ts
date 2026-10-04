import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly, resellerOf, Roles, Scopes } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import type { FeeKind, LedgerMode, ProductCategory } from '../generated/prisma/client.js';
import { Mode } from '../ledger/mode.js';
import { modeHeader, PageDto } from '../ledger/wallet.controller.js';
import { maxRatePpb, PlatformFeesService } from './platform-fees.service.js';

const categories = ['gift_cards', 'airtime', 'data', 'bills', 'pay_tv', 'esim', 'software', 'virtual_numbers', 'virtual_cards'] as const;
const thisMonth = () => new Date().toISOString().slice(0, 7);

class FeesQueryDto extends PageDto {
  @ApiPropertyOptional({ description: 'Only this UTC month, `YYYY-MM`.', example: '2026-10' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' })
  month?: string;
}

class StatementQueryDto {
  @ApiPropertyOptional({ description: 'UTC month, `YYYY-MM`; defaults to this month.', example: '2026-10' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' })
  month?: string;
}

class FeeRuleDto {
  @IsIn(['supplier_order', 'gateway_payment'])
  kind: FeeKind;

  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/, { message: 'country_code must be a 2-letter code' })
  country_code?: string | null;

  @IsOptional()
  @IsIn(categories)
  category?: ProductCategory | null;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  plan_code?: string | null;

  /** Parts per billion: 1 = 0.0000001%, 100,000,000 = 10%. */
  @IsInt()
  @Min(0)
  @Max(maxRatePpb)
  rate_ppb: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000_000_00)
  min_fee_minor?: number | null;
}

class RefundFeeDto {
  @IsString()
  @Length(5, 500)
  reason: string;
}

class ReportQueryDto {
  @IsISO8601()
  from: string;

  @IsISO8601()
  to: string;

  @IsOptional()
  @IsIn(['live', 'test'])
  mode?: LedgerMode;

  @IsOptional()
  @IsIn(['reseller', 'kind', 'category', 'country', 'plan'])
  group_by?: 'reseller' | 'kind' | 'category' | 'country' | 'plan';
}

class AdminFeesQueryDto extends FeesQueryDto {
  @IsOptional()
  @IsIn(['live', 'test'])
  mode?: LedgerMode;
}

/** BitoCard's fees on your own-integration transactions, and your monthly statement. */
@ApiTags('Wallet')
@ApiBearerAuth()
@modeHeader
@Roles('admin', 'finance', 'developer')
@Scopes('wallet:read')
@Controller('wallet')
export class FeesController {
  constructor(private readonly fees: PlatformFeesService) {}

  @ApiOperation({
    summary: 'List BitoCard fees',
    description:
      'Fees on orders through your own suppliers and payments through your own gateway, newest first: the rate, the base, the exact fee (billionths of a minor unit), what was held and charged, and the fraction carried to your next transaction.',
  })
  @Get('fees')
  list(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: FeesQueryDto) {
    return this.fees.list(resellerOf(caller), mode, query);
  }

  @ApiOperation({ summary: 'Your monthly fee statement', description: 'Fees charged and refunded by kind, and your subscription charges, for a UTC month.' })
  @Get('fees/statement')
  statement(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: StatementQueryDto) {
    return this.fees.statement(resellerOf(caller), mode, query.month ?? thisMonth());
  }

  @ApiOperation({ summary: 'The fee rates that apply to you', description: 'Per fee kind and product category, for your country and plan, in parts per billion and as a percentage.' })
  @Get('fee-rates')
  rates(@CurrentCaller() caller: Caller) {
    return this.fees.ratesFor(resellerOf(caller));
  }
}

/** Admins: fee rules (finance), revenue reports and the reconciliation check. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin')
export class AdminFeesController {
  constructor(private readonly fees: PlatformFeesService) {}

  @AdminRoles('finance', 'operations', 'support')
  @Get('fee-rules')
  rules() {
    return this.fees.rules();
  }

  @AdminRoles('finance')
  @Put('fee-rules')
  setRule(@CurrentCaller() caller: Caller, @Body() body: FeeRuleDto) {
    return this.fees.setRule(adminId(caller), body);
  }

  @AdminRoles('finance')
  @Delete('fee-rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteRule(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.fees.deleteRule(adminId(caller), id);
  }

  @AdminRoles('finance', 'operations')
  @Get('fees/report')
  report(@Query() query: ReportQueryDto) {
    return this.fees.report({ from: new Date(query.from), to: new Date(query.to), mode: query.mode ?? 'live', groupBy: query.group_by ?? 'reseller' });
  }

  @AdminRoles('finance')
  @Get('fees/reconciliation')
  reconcile() {
    return this.fees.reconcile();
  }

  @AdminRoles('finance', 'operations', 'support')
  @Get('resellers/:id/fees')
  resellerFees(@Param('id', ParseUUIDPipe) id: string, @Query() query: AdminFeesQueryDto) {
    return this.fees.list(id, query.mode ?? 'live', query);
  }

  @AdminRoles('finance')
  @Post('fees/:id/refund')
  @HttpCode(HttpStatus.OK)
  refund(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: RefundFeeDto) {
    return this.fees.refund(id, adminId(caller), body.reason).then(charge => ({ id: charge.id, status: charge.status }));
  }
}
