import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Injectable, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { chainNames } from './chains/client.js';
import { CryptoWithdrawalsService, type Holder, withdrawalChains } from './withdrawals.service.js';

/** The plan feature that lets a reseller move its own coins on chain (Premium, by migration). */
export const onchainFeature = 'onchain_crypto';

const refused = (code: string, message: string) => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', code, message);

/**
 * A Premium reseller's own coin wallet on chain: the same deposit addresses, deposits, saved addresses and emailed-code
 * withdrawals as store customers (`CryptoDepositsService`, `CryptoWithdrawalsService`), owned by the reseller
 * (`reseller_crypto`, the wallet it trades with BitoCard from) instead of a customer.
 *
 * Gates: depositing needs the `onchain_crypto` plan feature (Premium) and `reseller_exchange` (the coin wallet exists for
 * trading with BitoCard). Withdrawing what they hold needs neither, so ending Premium or switching the exchange off never
 * traps a reseller's coins. Both need not a house account, not suspended, and live an active (verified) reseller.
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
    if (purpose === 'deposit' && !reseller.plan.features.includes(onchainFeature)) throw refused('premium_required', 'Depositing coins on chain is part of the Premium plan.');
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
    const [assets, accounts] = await Promise.all([
      this.wallets.assets(true),
      this.prisma.ledgerAccount.findMany({ where: { mode, resellerId, kind: { in: ['reseller_crypto', 'reseller_crypto_withdrawing'] } }, select: { kind: true, currency: true, balanceMinor: true } }),
    ]);
    const balance = (kind: string, asset: string) => accounts.find(row => row.kind === kind && row.currency === asset)?.balanceMinor ?? 0n;
    return {
      object: 'reseller_coins' as const,
      mode,
      /** Whether the plan lets the reseller deposit coins on chain (Premium); withdrawing what it holds is always open. */
      onchain: reseller.plan.features.includes(onchainFeature),
      withdrawal_chains: withdrawalChains.map(chain => ({ chain, name: chainNames[chain] })),
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
@ApiTags('Crypto')
@ApiBearerAuth()
@modeHeader
@SessionOnly()
@Controller('crypto')
export class ResellerCoinsController {
  constructor(
    private readonly coins: ResellerCoinsService,
    private readonly deposits: CryptoDepositsService,
    private readonly withdrawals: CryptoWithdrawalsService,
  ) {}

  @ApiOperation({ summary: 'Get your coin wallet', description: 'What you hold of each coin, what is on its way out, whether your plan lets you deposit, and the networks addresses can be saved on.' })
  @Get()
  balances(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    return this.coins.balances(caller, mode);
  }

  @ApiOperation({ summary: 'List the networks a coin can be deposited on', description: 'Premium. Only networks switched on, with a key and a provider for the mode.' })
  @Get('deposit-networks')
  async depositNetworks(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: DepositNetworksDto) {
    await this.coins.holder(caller, mode, 'deposit');
    return this.deposits.networksOpen(mode, query.asset);
  }

  @ApiOperation({ summary: 'Get your deposit address for a coin and network', description: 'Premium. Made once per network family and mode, then the same every time; showing it watches it closely for a week.' })
  @Roles('admin', 'finance')
  @Post('deposit-addresses')
  @HttpCode(HttpStatus.OK)
  async depositAddress(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: DepositAddressDto) {
    const holder = await this.coins.holder(caller, mode, 'deposit');
    return this.deposits.addressFor(holder.owner, mode, body);
  }

  @ApiOperation({ summary: 'List your coin deposits', description: 'Newest first. Credited to your coin wallet once confirmed (and checked by a second provider when large).' })
  @Get('deposits')
  async depositsList(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    const holder = await this.coins.holder(caller, mode, 'read');
    return this.deposits.depositsOf(holder.owner, mode);
  }

  @ApiOperation({ summary: 'List your saved withdrawal addresses' })
  @Get('withdrawal-addresses')
  async addresses(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    const holder = await this.coins.holder(caller, mode, 'read');
    return this.withdrawals.addressesOf(holder.owner, mode);
  }

  /** Only the owner saves an address coins can be sent to, as with payout bank accounts. */
  @ApiOperation({ summary: 'Save a withdrawal address', description: 'Owner only. Checked for the network, never a BitoCard deposit address, screened against sanctions lists, usable 24 hours after it is added.' })
  @Roles()
  @Post('withdrawal-addresses')
  async addAddress(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: WithdrawalAddressDto) {
    return this.withdrawals.addAddressFor(await this.coins.holder(caller, mode, 'withdraw'), body);
  }

  @ApiOperation({ summary: 'Remove a saved withdrawal address' })
  @Roles('admin', 'finance')
  @Delete('withdrawal-addresses/:id')
  async removeAddress(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    const holder = await this.coins.holder(caller, mode, 'read');
    return this.withdrawals.removeAddressOf(holder.owner, id);
  }

  @ApiOperation({ summary: 'List the networks a coin can be withdrawn on', description: "With each network's fee and minimum, and your daily limit and what is left of it." })
  @Get('withdrawal-networks')
  async withdrawalNetworks(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: DepositNetworksDto) {
    return this.withdrawals.networksFor(await this.coins.holder(caller, mode, 'withdraw'), query.asset);
  }

  @ApiOperation({ summary: 'Ask for a withdrawal', description: 'The amount plus the network fee leaves your coin wallet at once and a 6-digit code is emailed to you. `preview: true` only shows the cost.' })
  @Roles('admin', 'finance')
  @Post('withdrawals')
  async create(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: WithdrawalDto) {
    return this.withdrawals.createFor(await this.coins.holder(caller, mode, 'withdraw'), body);
  }

  @ApiOperation({ summary: 'List your withdrawals' })
  @Get('withdrawals')
  async list(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    const holder = await this.coins.holder(caller, mode, 'read');
    return this.withdrawals.listOf(holder.owner, mode);
  }

  @ApiOperation({ summary: 'Get a withdrawal' })
  @Get('withdrawals/:id')
  async get(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    const holder = await this.coins.holder(caller, mode, 'read');
    return this.withdrawals.getOf(holder.owner, id);
  }

  @ApiOperation({ summary: 'Confirm a withdrawal with its emailed code', description: "Only the person who asked. It then goes to BitoCard's signer, or waits for BitoCard's approval." })
  @Roles('admin', 'finance')
  @Post('withdrawals/:id/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: CodeDto) {
    return this.withdrawals.confirmFor(await this.coins.holder(caller, mode, 'withdraw'), id, body.code);
  }

  @ApiOperation({ summary: 'Email a new code', description: 'Once a minute; only the person who asked.' })
  @Roles('admin', 'finance')
  @Post('withdrawals/:id/resend-code')
  @HttpCode(HttpStatus.OK)
  async resend(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.withdrawals.resendFor(await this.coins.holder(caller, mode, 'withdraw'), id);
  }

  @ApiOperation({ summary: 'Cancel a withdrawal', description: "While it waits for its code or BitoCard's approval: the coins go back to your coin wallet." })
  @Roles('admin', 'finance')
  @Post('withdrawals/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    const holder = await this.coins.holder(caller, mode, 'read');
    return this.withdrawals.cancelFor(holder.owner, id);
  }
}
