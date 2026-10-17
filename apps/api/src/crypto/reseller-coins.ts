import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Injectable, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { type Caller, CurrentCaller, resellerOf, Roles, SessionOnly } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { modeHeader } from '../ledger/wallet.controller.js';
import { Mode } from '../ledger/mode.js';
import { SettingsService } from '../settings/settings.service.js';
import { fromUnits } from './amounts.js';
import { CryptoDepositsService } from './chains/deposits.service.js';
import { CodeDto, DepositAddressDto, DepositNetworksDto, WithdrawalAddressDto, WithdrawalDto } from './crypto.controller.js';
import { CryptoWalletsService } from './crypto-wallets.service.js';
import type { CoinOwner } from './owner.js';
import { CryptoWithdrawalsService, type Holder } from './withdrawals.service.js';

/** The plan feature that lets a reseller move its own coins on chain (Premium, by migration). */
export const onchainFeature = 'onchain_crypto';

const refused = (code: string, message: string) => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', code, message);

/**
 * A Premium reseller's own coin wallet on chain: the same deposit addresses, deposits, saved addresses and emailed-code
 * withdrawals as store customers (`CryptoDepositsService`, `CryptoWithdrawalsService`), owned by the reseller
 * (`reseller_crypto`, the wallet it trades with BitoCard from) instead of a customer.
 *
 * Gates: the `onchain_crypto` plan feature, not a house account, not suspended, and live an active (verified) reseller.
 * New deposit addresses also need `reseller_exchange` (the coin wallet exists for trading with BitoCard); withdrawing what
 * they hold does not, so switching the exchange off never traps their coins.
 */
@Injectable()
export class ResellerCoinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly wallets: CryptoWalletsService,
    private readonly deposits: CryptoDepositsService,
    private readonly withdrawals: CryptoWithdrawalsService,
  ) {}

  /** Checks the gates and says who is asking; `deposit` also needs the exchange switch. */
  async holder(caller: Caller, mode: LedgerMode, purpose: 'read' | 'deposit' | 'withdraw'): Promise<Holder> {
    const resellerId = resellerOf(caller);
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, select: { name: true, status: true, house: true, plan: { select: { features: true } } } });
    if (reseller.house) throw refused('onchain_unavailable', 'BitoCard’s own accounts hold coins in the exchange reserves.');
    if (!reseller.plan.features.includes(onchainFeature)) throw refused('premium_required', 'Depositing and withdrawing coins on chain is part of the Premium plan.');
    if (purpose !== 'read') {
      if (reseller.status === 'suspended') throw refused('reseller_suspended', 'Your account is suspended.');
      if (mode === 'live' && reseller.status !== 'active') throw refused('reseller_not_verified', 'Verify your business before moving coins on chain.');
    }
    if (purpose === 'deposit' && !(await this.settings.isOn('reseller_exchange', resellerId))) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'exchange_not_enabled', 'Coin wallets are not enabled for your business yet.');
    }
    const userId = caller.kind === 'session' ? caller.userId : undefined;
    const user = userId ? await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }) : null;
    if (!user) throw refused('session_required', 'Sign in to SHQ to move coins.');
    return { owner: { resellerId }, mode, email: user.email, brand: 'BitoCard', who: `${reseller.name} (reseller)`, userId };
  }

  /** The reseller's coin wallet per coin: what it can spend and what is on its way out. */
  async balances(caller: Caller, mode: LedgerMode) {
    const resellerId = resellerOf(caller);
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, select: { plan: { select: { features: true } } } });
    const owner: CoinOwner = { resellerId };
    const [assets, accounts] = await Promise.all([
      this.wallets.assets(true),
      this.prisma.ledgerAccount.findMany({ where: { mode, resellerId, kind: { in: ['reseller_crypto', 'reseller_crypto_withdrawing'] } }, select: { kind: true, currency: true, balanceMinor: true } }),
    ]);
    const balance = (kind: string, asset: string) => accounts.find(row => row.kind === kind && row.currency === asset)?.balanceMinor ?? 0n;
    return {
      object: 'reseller_coins' as const,
      mode,
      onchain: reseller.plan.features.includes(onchainFeature),
      owner: owner.resellerId,
      assets: assets
        .filter(asset => asset.enabled || balance('reseller_crypto', asset.code) > 0n || balance('reseller_crypto_withdrawing', asset.code) > 0n)
        .map(asset => ({
          asset: asset.code,
          name: asset.name,
          decimals: asset.decimals,
          enabled: asset.enabled,
          available: fromUnits(balance('reseller_crypto', asset.code), asset.decimals),
          withdrawing: fromUnits(balance('reseller_crypto_withdrawing', asset.code), asset.decimals),
        })),
    };
  }
}

/** SHQ's coin wallet: balances, on-chain deposits and withdrawals (Premium). Sessions only: an API key never moves coins. */
@ApiExcludeController()
@modeHeader
@SessionOnly()
@Controller('crypto')
export class ResellerCoinsController {
  constructor(
    private readonly coins: ResellerCoinsService,
    private readonly deposits: CryptoDepositsService,
    private readonly withdrawals: CryptoWithdrawalsService,
  ) {}

  @Get()
  balances(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    return this.coins.balances(caller, mode);
  }

  @Get('deposit-networks')
  async depositNetworks(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: DepositNetworksDto) {
    await this.coins.holder(caller, mode, 'deposit');
    return this.deposits.networksOpen(mode, query.asset);
  }

  @Roles('admin', 'finance')
  @Post('deposit-addresses')
  @HttpCode(HttpStatus.OK)
  async depositAddress(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: DepositAddressDto) {
    const holder = await this.coins.holder(caller, mode, 'deposit');
    return this.deposits.addressFor(holder.owner, mode, body);
  }

  @Get('deposits')
  async depositsList(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    const holder = await this.coins.holder(caller, mode, 'read');
    return this.deposits.depositsOf(holder.owner, mode);
  }

  @Get('withdrawal-addresses')
  async addresses(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    const holder = await this.coins.holder(caller, mode, 'read');
    return this.withdrawals.addressesOf(holder.owner, mode);
  }

  /** Only the owner saves an address coins can be sent to, as with payout bank accounts. */
  @Roles()
  @Post('withdrawal-addresses')
  async addAddress(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: WithdrawalAddressDto) {
    return this.withdrawals.addAddressFor(await this.coins.holder(caller, mode, 'withdraw'), body);
  }

  @Roles('admin', 'finance')
  @Delete('withdrawal-addresses/:id')
  async removeAddress(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    const holder = await this.coins.holder(caller, mode, 'read');
    return this.withdrawals.removeAddressOf(holder.owner, id);
  }

  @Get('withdrawal-networks')
  async withdrawalNetworks(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: DepositNetworksDto) {
    return this.withdrawals.networksFor(await this.coins.holder(caller, mode, 'withdraw'), query.asset);
  }

  @Roles('admin', 'finance')
  @Post('withdrawals')
  async create(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: WithdrawalDto) {
    return this.withdrawals.createFor(await this.coins.holder(caller, mode, 'withdraw'), body);
  }

  @Get('withdrawals')
  async list(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    const holder = await this.coins.holder(caller, mode, 'read');
    return this.withdrawals.listOf(holder.owner, mode);
  }

  @Get('withdrawals/:id')
  async get(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    const holder = await this.coins.holder(caller, mode, 'read');
    return this.withdrawals.getOf(holder.owner, id);
  }

  @Roles('admin', 'finance')
  @Post('withdrawals/:id/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: CodeDto) {
    return this.withdrawals.confirmFor(await this.coins.holder(caller, mode, 'withdraw'), id, body.code);
  }

  @Roles('admin', 'finance')
  @Post('withdrawals/:id/resend-code')
  @HttpCode(HttpStatus.OK)
  async resend(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.withdrawals.resendFor(await this.coins.holder(caller, mode, 'withdraw'), id);
  }

  @Roles('admin', 'finance')
  @Post('withdrawals/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    const holder = await this.coins.holder(caller, mode, 'read');
    return this.withdrawals.cancelFor(holder.owner, id);
  }
}
