import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiHeader, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotIn, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly, resellerOf, Roles, Scopes } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { AllowanceService } from './allowance.service.js';
import { LedgerService } from './ledger.service.js';
import { Mode } from './mode.js';
import { WalletService } from './wallet.service.js';

export class PageDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'ID of the last item from the previous page.' })
  @IsOptional() @IsUUID()
  starting_after?: string;
}

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);

export class WalletCurrencyDto {
  @ApiPropertyOptional({ description: 'Which wallet: `USD`, or your country\'s currency (the default).', example: 'USD' })
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency?: string;
}

class TransactionsDto extends PageDto {
  @ApiPropertyOptional({ description: 'Only this wallet\'s transactions: `USD` or your country\'s currency. A conversion shows in both, each with its own side. Default: every wallet.', example: 'USD' })
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency?: string;
}

class ConversionDto {
  @ApiProperty({ description: 'The wallet the money leaves: `USD` or your country\'s currency.', example: 'USD' })
  @Transform(upper) @Matches(/^[A-Z]{3}$/, { message: 'from must be a 3-letter code' })
  from: string;

  @ApiProperty({ description: 'The wallet it arrives in: the other one.', example: 'NGN' })
  @Transform(upper) @Matches(/^[A-Z]{3}$/, { message: 'to must be a 3-letter code' })
  to: string;

  @ApiProperty({ description: 'Minor units of `from` (for example 2000 = US$20.00).', minimum: 1, example: 2000 })
  @IsInt() @Min(1) @Max(1_000_000_000_00)
  amount: number;

  @ApiPropertyOptional({ description: 'Only work out what would arrive, at today\'s rate: nothing moves.' })
  @IsOptional() @IsBoolean()
  preview?: boolean;
}

class AdminModeDto extends PageDto {
  @IsOptional() @IsIn(['test', 'live'])
  mode?: LedgerMode;

  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/)
  currency?: string;
}

class RevokeAllowanceDto {
  @IsString() @Length(5, 500) reason: string;
}

class AdjustmentDto {
  @IsIn(['test', 'live'])
  mode: LedgerMode;

  @IsIn(['funding', 'earnings'])
  balance: 'funding' | 'earnings';

  /** Minor units; negative takes money from the wallet. */
  @IsInt() @IsNotIn([0]) @Min(-1_000_000_000_00) @Max(1_000_000_000_00)
  amount: number;

  @IsString() @Length(5, 300)
  reason: string;
}

export const modeHeader = ApiHeader({
  name: 'BitoCard-Mode',
  required: false,
  description: 'Dashboard sessions only: test for the sandbox, live (default) otherwise. API keys always use their own mode.',
});

@ApiTags('Wallet')
@ApiBearerAuth()
@modeHeader
@Roles('admin', 'finance', 'developer')
@Scopes('wallet:read')
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallets: WalletService) {}

  @ApiOperation({
    summary: 'Get the wallet balance',
    description:
      'You hold two wallets: your country\'s currency (orders, earnings and withdrawals) and US dollars. Pass `currency` for one of them (your country\'s by default); `wallets` lists both. Amounts are integer minor units of the wallet currency (for example kobo for NGN). `available` pays wholesale cost; earnings become withdrawable after the payout hold. An order your country wallet cannot cover is covered from the US dollar wallet, converted at BitoCard\'s rate.',
  })
  @Get()
  wallet(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: WalletCurrencyDto) {
    return this.wallets.wallet(resellerOf(caller), mode, query.currency);
  }

  @ApiOperation({ summary: 'List wallet transactions', description: 'Newest first. `amount` is the change to the available balance of the transaction\'s `currency`.' })
  @Get('transactions')
  transactions(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() page: TransactionsDto) {
    return this.wallets.transactions(resellerOf(caller), mode, page);
  }

  @ApiOperation({
    summary: 'Convert between your wallets',
    description:
      'Moves money between your US dollar wallet and your country wallet at BitoCard\'s exchange rate (see `GET /v1/exchange-rates`): topped-up funds first, then withdrawable earnings. With `preview: true` it only says what would arrive. Converted money arrives as topped-up funds: it pays for orders and cannot be withdrawn.',
  })
  @Roles('admin', 'finance')
  @Scopes('wallet:write')
  @Post('conversions')
  @HttpCode(HttpStatus.OK)
  convert(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: ConversionDto) {
    return this.wallets.convert(resellerOf(caller), mode, body);
  }
}

@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin')
export class AdminWalletController {
  constructor(
    private readonly wallets: WalletService,
    private readonly ledger: LedgerService,
    private readonly allowance: AllowanceService,
  ) {}

  /** Grants the startup allowance now (verified reseller, switch on, never granted before). Audited. */
  @AdminRoles('finance')
  @Post('resellers/:id/startup-allowance')
  grantAllowance(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.allowance.grant(adminId(caller), id);
  }

  /** Takes back what remains of the startup allowance. It cannot be granted again. Audited with the reason. */
  @AdminRoles('finance')
  @Post('resellers/:id/startup-allowance/revoke')
  revokeAllowance(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: RevokeAllowanceDto) {
    return this.allowance.revoke(adminId(caller), id, body.reason);
  }

  @AdminRoles('finance', 'operations', 'support')
  @Get('resellers/:id/wallet')
  wallet(@Param('id', ParseUUIDPipe) id: string, @Query() query: AdminModeDto) {
    return this.wallets.wallet(id, query.mode ?? 'live', query.currency);
  }

  @AdminRoles('finance', 'operations', 'support')
  @Get('resellers/:id/wallet/transactions')
  transactions(@Param('id', ParseUUIDPipe) id: string, @Query() query: AdminModeDto) {
    return this.wallets.transactions(id, query.mode ?? 'live', query);
  }

  @AdminRoles('finance')
  @Post('resellers/:id/wallet/adjustments')
  adjust(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: AdjustmentDto) {
    return this.wallets.adjust(adminId(caller), { resellerId: id, ...body });
  }

  @AdminRoles('finance')
  @Get('ledger/check')
  check() {
    return this.ledger.check();
  }
}
