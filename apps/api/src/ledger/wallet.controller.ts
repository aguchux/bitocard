import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiHeader, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotIn, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
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

class AdminModeDto extends PageDto {
  @IsOptional() @IsIn(['test', 'live'])
  mode?: LedgerMode;
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
      'Amounts are integer minor units of the wallet currency (for example kobo for NGN). `available` pays wholesale cost; earnings become withdrawable after the payout hold.',
  })
  @Get()
  wallet(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    return this.wallets.wallet(resellerOf(caller), mode);
  }

  @ApiOperation({ summary: 'List wallet transactions', description: 'Newest first. `amount` is the change to the available balance.' })
  @Get('transactions')
  transactions(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() page: PageDto) {
    return this.wallets.transactions(resellerOf(caller), mode, page);
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
    return this.wallets.wallet(id, query.mode ?? 'live');
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
