import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Public } from '../auth/caller.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { ApiError } from '../common/errors/api-error.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { PrismaService } from '../database/prisma.service.js';
import { ProductOnly } from '../products/product.js';
import type { DiscountRule } from './actor.js';
import { PosCatalogueService } from './catalogue.service.js';
import { PosCollectionsService } from './collections.service.js';
import { PosCustomersService } from './customers.service.js';
import { levelOf, type PosPermission, type ResolvedRole } from './permissions.js';
import { AttachDto, CatalogueDto, CollectionsDto, CustomerDto, CustomersDto, KeepDto, RefundDto, RepaymentDto, SaleDto, SalesDto, ShopDto, StockDto, TillDto, TransferRequestDto, WalletRequestDto } from './pos.controller.js';
import { AllowPinChange, CurrentDevice, CurrentStaff, PosAllows, PosDeviceGuard, PosGuard } from './pos.guard.js';
import { PosService } from './pos.service.js';
import { PosSalesService } from './sales.service.js';
import { type ApprovalInput, ownerBy, type PosManager, PosStaffService, type PosStaffContext } from './staff.service.js';
import { PosWalletService } from './wallet.service.js';

const sendVias = ['sms', 'whatsapp', 'link'] as const;

class SignInDto {
  @IsString() @MaxLength(12)
  shop_code: string;

  @IsString() @MaxLength(20)
  phone: string;

  @IsString() @Matches(/^(?:\d{4}|\d{6})$/, { message: 'Your PIN is 6 digits.' })
  pin: string;

  @IsOptional() @IsUUID()
  till_id?: string | null;
}

class InviteTokenDto {
  @IsString() @MaxLength(80)
  token: string;
}

class AcceptInviteDto extends InviteTokenDto {
  @IsString() @Matches(/^\d{6}$/, { message: 'Your PIN is 6 digits.' })
  pin: string;
}

class ChangePinDto {
  /** The PIN they sign in with now (4 digits if set before PINs were 6). */
  @IsString() @Matches(/^(?:\d{4}|\d{6})$/, { message: 'Your current PIN is 4 or 6 digits.' })
  current_pin: string;

  @IsString() @Matches(/^\d{6}$/, { message: 'Your new PIN is 6 digits.' })
  new_pin: string;
}

class LinkDto {
  @IsString() @MaxLength(12)
  code: string;

  @IsOptional() @IsString() @MaxLength(60)
  name?: string | null;

  @IsOptional() @IsIn(['web', 'windows', 'android', 'ios'])
  platform?: string | null;
}

class DeviceSignInDto {
  @IsUUID()
  staff_id: string;

  @IsString() @Matches(/^(?:\d{4}|\d{6})$/, { message: 'Your PIN is 6 digits.' })
  pin: string;
}

class StaffDto {
  @IsString() @MaxLength(60)
  first_name: string;

  @IsString() @MaxLength(60)
  last_name: string;

  @IsString() @MaxLength(20)
  phone: string;

  @IsOptional() @IsString() @MaxLength(254)
  email?: string | null;

  /** A fixed role (`manager`, `cashier`, `stock_keeper`, `accountant`) or one of the owner's own roles' ids. */
  @IsString() @MaxLength(40)
  role: string;

  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true })
  till_ids?: string[];

  @IsOptional() @IsBoolean()
  all_tills?: boolean;

  @IsOptional() @IsBoolean()
  mobile?: boolean;
}

class InviteDto extends StaffDto {
  /** `sms` (sent here), `whatsapp` (the owner sends it with `whatsapp_url`) or `link` (copied). */
  @IsIn(sendVias)
  send_via: (typeof sendVias)[number];
}

class StaffChangeDto {
  @IsOptional() @IsString() @MaxLength(60)
  first_name?: string;

  @IsOptional() @IsString() @MaxLength(60)
  last_name?: string;

  @IsOptional() @IsString() @MaxLength(20)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(254)
  email?: string | null;

  @IsOptional() @IsString() @MaxLength(40)
  role?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true })
  till_ids?: string[];

  @IsOptional() @IsBoolean()
  all_tills?: boolean;

  @IsOptional() @IsBoolean()
  mobile?: boolean;
}

class ResendDto {
  @IsIn(sendVias)
  send_via: (typeof sendVias)[number];
}

class RoleDto {
  @IsString() @MaxLength(40)
  name: string;

  @IsOptional() @IsString() @MaxLength(200)
  description?: string | null;

  /** Each permission: `yes`, `no`, `approval` (refunds, stock) or `cashiers` (staff). */
  @IsObject()
  permissions: Record<string, unknown>;

  /** The most discount without a manager, in basis points; null for any amount. */
  @IsOptional() @IsInt() @Min(0) @Max(10_000)
  discount_limit_bps?: number | null;
}

/** A manager's PIN given at the till for something the member of staff may only do with approval. */
class ApprovalDto {
  @IsUUID()
  staff_id: string;

  @IsString() @Matches(/^(?:\d{4}|\d{6})$/, { message: 'The PIN is 6 digits.' })
  pin: string;
}

class StaffSaleDto extends SaleDto {
  @IsOptional() @ValidateNested() @Type(() => ApprovalDto)
  approval?: ApprovalDto;
}

class StaffWalletRequestDto extends WalletRequestDto {
  @IsOptional() @ValidateNested() @Type(() => ApprovalDto)
  approval?: ApprovalDto;
}

class StaffTransferRequestDto extends TransferRequestDto {
  @IsOptional() @ValidateNested() @Type(() => ApprovalDto)
  approval?: ApprovalDto;
}

class StaffRefundDto extends RefundDto {
  @IsOptional() @ValidateNested() @Type(() => ApprovalDto)
  approval?: ApprovalDto;
}

class StaffStockDto extends StockDto {
  @IsOptional() @ValidateNested() @Type(() => ApprovalDto)
  approval?: ApprovalDto;
}

const notSignedUp = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'pos_account_missing', 'You have not signed up for Udozo POS yet.');
const tillNotAllowed = () => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'till_not_allowed', 'You may not use this till: ask the shop owner.', 'till_id');

/** Signing in at the till, accepting an invite and linking a device: public, held to the sign-in rate limit. */
@ApiExcludeController()
@Public()
@Controller('pos')
@ProductOnly('udozo')
export class PosStaffAuthController {
  constructor(private readonly staff: PosStaffService) {}

  @Post('staff/sign-in')
  @SkipIdempotency()
  signIn(@Body() body: SignInDto) {
    return this.staff.signIn(body);
  }

  /** The invite's details (the token in the body, never the address). */
  @Post('invites/lookup')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  invite(@Body() body: InviteTokenDto) {
    return this.staff.inviteInfo(body.token);
  }

  @Post('invites/accept')
  @SkipIdempotency()
  accept(@Body() body: AcceptInviteDto) {
    return this.staff.acceptInvite(body.token, body.pin);
  }

  @Post('devices/link')
  @SkipIdempotency()
  link(@Body() body: LinkDto) {
    return this.staff.link(body);
  }
}

/** A linked till before anyone signs in: the name tiles, and signing in with one and a PIN. */
@ApiExcludeController()
@Public()
@UseGuards(PosDeviceGuard)
@Controller('pos/device')
@ProductOnly('udozo')
export class PosDeviceController {
  constructor(private readonly staff: PosStaffService) {}

  @Get()
  info(@CurrentDevice() device: { id: string }) {
    return this.staff.deviceInfo(device.id);
  }

  @Post('sign-in')
  @SkipIdempotency()
  signIn(@CurrentDevice() device: { id: string }, @Body() body: DeviceSignInDto) {
    return this.staff.deviceSignIn(device.id, body);
  }
}

/** The owner manages their staff, roles and tills' devices from their Udozo account. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('pos/owner')
@ProductOnly('udozo')
export class PosOwnerStaffController {
  constructor(
    private readonly staff: PosStaffService,
    private readonly prisma: PrismaService,
  ) {}

  private async owner(caller: CustomerCaller): Promise<PosManager> {
    const account = await this.prisma.posAccount.findUnique({ where: { customerId: caller.customer.id }, select: { id: true } });
    if (!account) throw notSignedUp();
    return { accountId: account.id, by: ownerBy(caller.customer), role: null };
  }

  @Get('staff')
  async list(@CurrentCustomer() caller: CustomerCaller) {
    return this.staff.list((await this.owner(caller)).accountId);
  }

  @Post('staff')
  async invite(@CurrentCustomer() caller: CustomerCaller, @Body() body: InviteDto) {
    return this.staff.invite(await this.owner(caller), body);
  }

  @Get('staff/:id')
  async get(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.get(await this.owner(caller), id);
  }

  @Patch('staff/:id')
  async update(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: StaffChangeDto) {
    return this.staff.update(await this.owner(caller), id, body);
  }

  @Post('staff/:id/resend')
  @HttpCode(HttpStatus.OK)
  async resend(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ResendDto) {
    return this.staff.resend(await this.owner(caller), id, body.send_via);
  }

  @Post('staff/:id/suspend')
  @HttpCode(HttpStatus.OK)
  async suspend(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.setStatus(await this.owner(caller), id, 'suspend');
  }

  @Post('staff/:id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.setStatus(await this.owner(caller), id, 'restore');
  }

  @Delete('staff/:id')
  async remove(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.setStatus(await this.owner(caller), id, 'remove');
  }

  @Get('roles')
  async roles(@CurrentCustomer() caller: CustomerCaller) {
    return this.staff.roles((await this.owner(caller)).accountId);
  }

  @Post('roles')
  async createRole(@CurrentCustomer() caller: CustomerCaller, @Body() body: RoleDto) {
    return this.staff.createRole(await this.owner(caller), body);
  }

  @Patch('roles/:id')
  async updateRole(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: RoleDto) {
    return this.staff.updateRole(await this.owner(caller), id, body);
  }

  @Delete('roles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRole(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    await this.staff.deleteRole(await this.owner(caller), id);
  }

  @Post('tills/:id/devices/link-code')
  async linkCode(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.linkCode(await this.owner(caller), id);
  }

  @Get('devices')
  async devices(@CurrentCustomer() caller: CustomerCaller) {
    return this.staff.devices((await this.owner(caller)).accountId);
  }

  @Post('devices/:id/unlink')
  @HttpCode(HttpStatus.OK)
  async unlink(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.unlink(await this.owner(caller), id);
  }

  @Get('approvals')
  async approvals(@CurrentCustomer() caller: CustomerCaller) {
    return this.staff.approvals((await this.owner(caller)).accountId);
  }
}

/**
 * The till for staff: what each may do is their role's (`@PosAllows`), at the tills they may use, and never the owner's
 * Udozo account (plan, billing, shops, collection accounts, the settlement account, listings, wallet or payouts).
 */
@ApiExcludeController()
@Public()
@UseGuards(PosGuard)
@Controller('pos/staff')
@ProductOnly('udozo')
export class PosStaffController {
  constructor(
    private readonly staff: PosStaffService,
    private readonly pos: PosService,
    private readonly catalogue: PosCatalogueService,
    private readonly sales: PosSalesService,
    private readonly wallet: PosWalletService,
    private readonly collections: PosCollectionsService,
    private readonly customers: PosCustomersService,
    private readonly prisma: PrismaService,
  ) {}

  /** The till they may sell at: the session's till (a linked device's) or any of theirs. */
  private till(context: PosStaffContext, tillId: string) {
    if (context.tillId && context.tillId !== tillId) throw tillNotAllowed();
    if (context.tills !== 'all' && !context.tills.includes(tillId)) throw tillNotAllowed();
    return tillId;
  }

  /** The sales they may see: every sale with `all_sales`; else their own at their tills. */
  private scope(context: PosStaffContext) {
    if (levelOf(context.role, 'all_sales') === 'yes') return {};
    return { soldByStaff: context.staff.id, ...(context.tills === 'all' ? {} : { tills: context.tills }) };
  }

  /** A manager's PIN for what `permission` allows only with approval; null when their own role allows it outright. */
  private async approval(context: PosStaffContext, permission: PosPermission, approval: ApprovalInput | undefined, tillId: string | null, what: string) {
    if (levelOf(context.role, permission) === 'yes') return null;
    return this.staff.approver(context, approval, tillId, role => levelOf(role, permission) === 'yes', what);
  }

  /**
   * The discount they may give: their role's limit, and a manager's if one gave their PIN (who must be able to sell,
   * and whose own limit then holds). Checked against the basket by the sale itself.
   */
  private async discount(context: PosStaffContext, approval: ApprovalInput | undefined, tillId: string): Promise<{ rule: DiscountRule; approver: { id: string; name: string; role: ResolvedRole } | null }> {
    if (!approval) return { rule: { limit: context.role.discountLimitBps, approved: false }, approver: null };
    const approver = await this.staff.approver(context, approval, tillId, role => levelOf(role, 'sell') === 'yes', 'A bigger discount');
    return { rule: { limit: context.role.discountLimitBps, approverLimit: approver.role.discountLimitBps, approved: true }, approver };
  }

  @Get()
  @PosAllows([])
  @AllowPinChange()
  async me(@CurrentStaff() context: PosStaffContext) {
    const me = await this.pos.me(context.owner);
    const account = me.account!;
    const allowed = (tillId: string) => context.tills === 'all' || context.tills.includes(tillId);
    const shops = account.shops.map(shop => ({ ...shop, tills: shop.tills.filter(till => allowed(till.id)) })).filter(shop => shop.tills.length || context.tills === 'all');
    const transferAccounts =
      levelOf(context.role, 'sell') === 'yes' && me.collections
        ? (await this.prisma.posCollectionAccount.findMany({ where: { accountId: account.id, status: 'active' } }))
            .filter(row => row.tillId && allowed(row.tillId))
            .map(row => ({ till_id: row.tillId, bank_name: row.bankName, account_number: row.accountNumber, account_name: row.accountName }))
        : [];
    return {
      ...this.staff.presentContext(context),
      open: me.open,
      wallet_payments: me.wallet_payments,
      collections: me.collections,
      country: me.country,
      currency: me.currency,
      account: { id: account.id, mode: account.mode, plan: { code: account.plan.code, name: account.plan.name }, shops },
      transfer_accounts: transferAccounts,
      /** Who may give a manager's PIN at this till, for what this role may only do with approval. */
      approvers: await this.staff.approvers(context),
      /** Their PIN is from before PINs were 6 digits: nothing else works until they choose a new one. */
      pin_change_required: context.pinChangeRequired,
    };
  }

  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipIdempotency()
  @PosAllows([])
  @AllowPinChange()
  async signOut(@CurrentStaff() context: PosStaffContext) {
    await this.staff.signOut(context.sessionId);
  }

  /** Changes their own PIN (the current one, then a new 6-digit one). */
  @Post('pin')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  @PosAllows([])
  @AllowPinChange()
  changePin(@CurrentStaff() context: PosStaffContext, @Body() body: ChangePinDto) {
    return this.staff.changePin(context, body);
  }

  @Get('catalogue')
  @PosAllows(['sell', 'stock_view'])
  products(@CurrentStaff() context: PosStaffContext, @Query() query: CatalogueDto) {
    return this.catalogue.catalogue(context.owner, query);
  }

  @Post('sales')
  @PosAllows('sell')
  async sell(@CurrentStaff() context: PosStaffContext, @Body() body: StaffSaleDto) {
    const tillId = this.till(context, body.till_id);
    const { rule, approver } = await this.discount(context, body.approval, tillId);
    const sale = await this.sales.sell(context.owner, body, { by: context.by, discount: rule });
    if (approver && sale.subtotal > 0 && sale.discount > 0) {
      const share = Math.ceil((sale.discount * 10_000) / sale.subtotal);
      if (rule.limit !== null && share > rule.limit) await this.staff.recordApproval(context, approver, 'discount', sale.id, tillId);
    }
    return sale;
  }

  @Get('sales')
  @PosAllows(['own_sales', 'all_sales'])
  salesList(@CurrentStaff() context: PosStaffContext, @Query() query: SalesDto) {
    return this.sales.list(context.owner, query, this.scope(context));
  }

  @Get('sales/:id')
  @PosAllows(['own_sales', 'all_sales'])
  sale(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.get(context.owner, id, this.scope(context));
  }

  @Post('sales/:id/refund')
  @HttpCode(HttpStatus.OK)
  @PosAllows('refund', { approval: true })
  async refund(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: StaffRefundDto) {
    const approver = await this.approval(context, 'refund', body.approval, context.tillId, 'A refund');
    const sale = await this.sales.refund(context.owner, id, body, { by: context.by, tills: levelOf(context.role, 'all_sales') === 'yes' || context.tills === 'all' ? undefined : context.tills });
    if (approver) await this.staff.recordApproval(context, approver, 'refund', id, context.tillId);
    return sale;
  }

  @Post('wallet-requests')
  @PosAllows('sell')
  async walletRequest(@CurrentStaff() context: PosStaffContext, @Body() body: StaffWalletRequestDto) {
    const tillId = this.till(context, body.till_id);
    const { rule, approver } = await this.discount(context, body.approval, tillId);
    const request = await this.wallet.request(context.owner, body, { by: context.by, discount: rule });
    if (approver) await this.staff.recordApproval(context, approver, 'discount', null, tillId);
    return request;
  }

  @Get('wallet-requests/:id')
  @PosAllows('sell')
  walletStatus(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.wallet.status(context.owner, id);
  }

  @Post('wallet-requests/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @PosAllows('sell')
  walletCancel(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.wallet.cancel(context.owner, id);
  }

  @Post('transfer-requests')
  @PosAllows('sell')
  async transferRequest(@CurrentStaff() context: PosStaffContext, @Body() body: StaffTransferRequestDto) {
    const tillId = this.till(context, body.till_id);
    const { rule, approver } = await this.discount(context, body.approval, tillId);
    const request = await this.collections.ask(context.owner, body, { by: context.by, discount: rule });
    if (approver) await this.staff.recordApproval(context, approver, 'discount', null, tillId);
    return request;
  }

  @Get('transfer-requests/:id')
  @PosAllows('sell')
  transferStatus(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.collections.request(context.owner, id);
  }

  @Post('transfer-requests/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @PosAllows('sell')
  transferCancel(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.collections.cancel(context.owner, id);
  }

  @Post('stock/:listing')
  @PosAllows('stock_adjust', { approval: true })
  async adjustStock(@CurrentStaff() context: PosStaffContext, @Param('listing', ParseUUIDPipe) listing: string, @Body() body: StaffStockDto) {
    const approver = await this.approval(context, 'stock_adjust', body.approval, context.tillId, 'Changing stock');
    const result = await this.sales.adjustStock(context.owner, listing, body, context.by);
    if (approver) await this.staff.recordApproval(context, approver, 'stock_adjust', listing, context.tillId);
    return result;
  }

  @Get('stock/:listing/movements')
  @PosAllows('stock_view')
  movements(@CurrentStaff() context: PosStaffContext, @Param('listing', ParseUUIDPipe) listing: string) {
    return this.sales.movements(context.owner, listing);
  }

  @Get('customers')
  @PosAllows('customers')
  customerList(@CurrentStaff() context: PosStaffContext, @Query() query: CustomersDto) {
    return this.customers.list(context.owner, query);
  }

  @Post('customers')
  @PosAllows('customers')
  addCustomer(@CurrentStaff() context: PosStaffContext, @Body() body: CustomerDto) {
    return this.customers.create(context.owner, body);
  }

  @Get('customers/:id')
  @PosAllows('customers')
  customer(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(context.owner, id);
  }

  @Patch('customers/:id')
  @PosAllows('customers')
  updateCustomer(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: CustomerDto) {
    return this.customers.update(context.owner, id, body);
  }

  @Post('customers/:id/repayments')
  @PosAllows('customers')
  repay(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: RepaymentDto) {
    return this.customers.repay(context.owner, id, body, context.by);
  }

  @Get('collections/transfers')
  @PosAllows('transfers')
  transfers(@CurrentStaff() context: PosStaffContext, @Query() query: CollectionsDto) {
    return this.collections.collections(context.owner, query);
  }

  @Post('collections/transfers/:id/attach')
  @HttpCode(HttpStatus.OK)
  @PosAllows('transfers')
  attach(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: AttachDto) {
    return this.collections.attach(context.owner, id, body.transfer_request_id, context.by);
  }

  @Post('collections/transfers/:id/keep')
  @HttpCode(HttpStatus.OK)
  @PosAllows('transfers')
  keep(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: KeepDto) {
    return this.collections.keep(context.owner, id, body.note, context.by);
  }

  // ---- A manager's staff (cashiers only) ----

  private manager(context: PosStaffContext): PosManager {
    return { accountId: context.account.id, by: context.by, role: context.role };
  }

  @Get('staff')
  @PosAllows('staff')
  async staffList(@CurrentStaff() context: PosStaffContext) {
    const list = await this.staff.list(context.account.id);
    return { ...list, data: list.data.filter(row => row.role.key === 'cashier') };
  }

  @Post('staff')
  @PosAllows('staff')
  invite(@CurrentStaff() context: PosStaffContext, @Body() body: InviteDto) {
    return this.staff.invite(this.manager(context), body);
  }

  @Patch('staff/:id')
  @PosAllows('staff')
  updateStaff(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: StaffChangeDto) {
    return this.staff.update(this.manager(context), id, body);
  }

  @Post('staff/:id/resend')
  @HttpCode(HttpStatus.OK)
  @PosAllows('staff')
  resend(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ResendDto) {
    return this.staff.resend(this.manager(context), id, body.send_via);
  }

  @Post('staff/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @PosAllows('staff')
  suspend(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.setStatus(this.manager(context), id, 'suspend');
  }

  @Post('staff/:id/restore')
  @HttpCode(HttpStatus.OK)
  @PosAllows('staff')
  restore(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.setStatus(this.manager(context), id, 'restore');
  }

  @Delete('staff/:id')
  @PosAllows('staff')
  removeStaff(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.setStatus(this.manager(context), id, 'remove');
  }

  // ---- Settings: the shop's details, its tills and their devices ----

  @Patch('shops/:id')
  @PosAllows('settings')
  async updateShop(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ShopDto) {
    // The main shop and the one that fulfils online orders stay the owner's to choose.
    await this.pos.updateShop(context.owner, id, { ...body, main: undefined, fulfils_online: undefined });
    return this.me(context);
  }

  @Patch('tills/:id')
  @PosAllows('settings')
  async updateTill(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: TillDto) {
    await this.pos.updateTill(context.owner, id, body);
    return this.me(context);
  }

  @Post('tills/:id/devices/link-code')
  @PosAllows('settings')
  linkCode(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.linkCode(this.manager(context), id);
  }

  @Get('devices')
  @PosAllows('settings')
  devices(@CurrentStaff() context: PosStaffContext) {
    return this.staff.devices(context.account.id);
  }

  @Post('devices/:id/unlink')
  @HttpCode(HttpStatus.OK)
  @PosAllows('settings')
  unlink(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.unlink(this.manager(context), id);
  }
}
