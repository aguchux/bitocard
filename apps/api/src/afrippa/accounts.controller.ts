import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, IsArray, IsEmail, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { AdminRoles, AllowTwoStepPending, type Caller, CurrentCaller, Public, RealmOnly, StepUp } from '../auth/caller.js';
import { mfaMethods } from '../auth/mfa-policy.js';
import { passwordLength } from '../auth/passwords.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { CustomersService } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { MfaMethod } from '../generated/prisma/client.js';
import { afrippaStoreId } from './ids.js';
import { TraderGoogleService } from './google.service.js';
import { everywhere, type TraderSession, TraderTwoStepService } from './two-step.service.js';
import { TraderDevicesService } from './devices.service.js';

const lowerTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

class TraderSignUpDto {
  @Transform(trim) @IsString() @Length(2, 100)
  name: string;

  /** The trader's country (one of the markets), fixed for good. */
  @Transform(upper) @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter code' })
  country: string;

  @Transform(lowerTrim) @IsEmail() @Length(3, 254)
  email: string;

  @IsOptional() @IsString() @Length(6, 25)
  phone?: string;

  @IsString() @Length(passwordLength.min, passwordLength.max)
  password: string;
}

class TraderSignInDto {
  @Transform(lowerTrim) @IsEmail() @Length(3, 254)
  email: string;

  @IsString() @Length(1, passwordLength.max)
  password: string;
}

class CodeDto {
  @Matches(/^\d{6}$/, { message: 'code must be the 6-digit code' })
  code: string;
}

class TwoStepCodeDto {
  /** The method's 6-digit code, or a recovery code (abcd-1234). */
  @Transform(lowerTrim) @Matches(/^(\d{6}|[a-z0-9]{4}-[a-z0-9]{4})$/, { message: 'code must be a 6-digit code or a recovery code' })
  code: string;
}

class TwoStepSetupDto {
  @IsIn(mfaMethods as MfaMethod[])
  method: MfaMethod;

  /** Changing an existing method (outside signing in): a code from it. */
  @IsOptional() @Transform(lowerTrim) @Matches(/^(\d{6}|[a-z0-9]{4}-[a-z0-9]{4})$/, { message: 'current_code must be a 6-digit code or a recovery code' })
  current_code?: string;
}

class GoogleStartDto {
  @IsIn(['signin', 'signup'])
  intent: 'signin' | 'signup';
}

class GoogleFinishDto {
  /** The state from `google/start`, as Afrippa's server kept it. */
  @IsString() @Length(20, 200)
  state: string;

  /** The code Google returned to afrippa.com. */
  @IsString() @Length(1, 2000)
  code: string;

  /** Signing up: the trader's country (one of the markets), fixed for good. */
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter code' })
  country?: string;
}

class PhoneDto {
  @IsString() @Length(6, 25)
  phone: string;
}

class ForgotDto {
  @Transform(lowerTrim) @IsEmail() @Length(3, 254)
  email: string;
}

class ResetDto extends CodeDto {
  @Transform(lowerTrim) @IsEmail() @Length(3, 254)
  email: string;

  @IsString() @Length(passwordLength.min, passwordLength.max)
  password: string;
}

class ChangePasswordDto {
  @IsString() @Length(1, passwordLength.max)
  current_password: string;

  @IsString() @Length(passwordLength.min, passwordLength.max)
  password: string;
}

class PolicyDto {
  @IsArray() @ArrayMinSize(1, { message: 'allow at least one method' }) @ArrayUnique() @IsIn(mfaMethods as MfaMethod[], { each: true })
  methods: MfaMethod[];
}

class ReasonDto {
  @Transform(trim) @IsString() @Length(3, 500)
  reason: string;
}

/** Afrippa's one store, whose customers are its traders. */
async function afrippaStore(prisma: PrismaService) {
  return prisma.store.findUniqueOrThrow({ where: { id: afrippaStoreId }, include: { reseller: { select: { house: true } } } });
}

const session = (caller: CustomerCaller): TraderSession => ({ customer: caller.customer, sessionId: caller.sessionId, mfaVerifiedAt: caller.mfaVerifiedAt ?? null, mfaReconfirmedAt: caller.mfaReconfirmedAt ?? null });

/**
 * Afrippa's traders' accounts (docs/CRYPTO_SPINOFF_PLAN.md, step 2 item 5): customers of Afrippa's own store, so an
 * Afrippa account and a bitocard.com one are unrelated, reached only through Afrippa's signed server (the gate pins
 * every request to Afrippa's store). Two-step sign-in is required from day one: a new session can only finish it.
 * Emails and texts come from Afrippa, through its own email and SMS accounts.
 */
@ApiExcludeController()
@Public()
@Controller('afrippa/account')
export class AfrippaAccountController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly twoStep: TraderTwoStepService,
    private readonly google: TraderGoogleService,
    private readonly devices: TraderDevicesService,
  ) {}

  /** Google sign-in, step 1: Google's consent address and the one-time state Afrippa's server keeps. */
  @Post('google/start')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  googleStart(@Body() body: GoogleStartDto) {
    return this.google.start(body.intent);
  }

  /** Google sign-in, step 2: the code Google returned; the trader is signed in (signed up first), two-step pending. */
  @Post('google/finish')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  async googleFinish(@Body() body: GoogleFinishDto, @Req() req: Request) {
    const result = await this.google.finish(body);
    await this.devices.seen(result.customer.id, this.devices.hashOf(req), { alert: true });
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: result.customer.id }, include: { store: { include: { reseller: { select: { house: true } } } } } });
    return { ...result, two_step: await this.twoStep.state({ customer, sessionId: '', mfaVerifiedAt: null, mfaReconfirmedAt: null }) };
  }

  /** A new trader: their account and a session waiting for two-step set-up; a code to confirm the email is sent. */
  @Post('signup')
  @SkipIdempotency()
  async signup(@Body() body: TraderSignUpDto, @Req() req: Request) {
    const device = this.devices.hashOf(req);
    await this.devices.requireRoomForSignup(device);
    const result = await this.customers.signup(await afrippaStore(this.prisma), body);
    await this.devices.seen(result.customer.id, device);
    return { ...result, two_step: { object: 'two_step_state' as const, pending: true, setup_required: true, method: null, method_not_allowed: false } };
  }

  /** Email and password, then the two-step code (`two_step.pending`). */
  @Post('signin')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  async signin(@Body() body: TraderSignInDto, @Req() req: Request) {
    const result = await this.customers.signin(await afrippaStore(this.prisma), body);
    await this.devices.seen(result.customer.id, this.devices.hashOf(req), { alert: true });
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: result.customer.id }, include: { store: { include: { reseller: { select: { house: true } } } } } });
    const state = await this.twoStep.state({ customer, sessionId: '', mfaVerifiedAt: null, mfaReconfirmedAt: null });
    return { ...result, two_step: state };
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  async forgot(@Body() body: ForgotDto) {
    return this.customers.forgotPassword(await afrippaStore(this.prisma), body.email);
  }

  /** A new password with the emailed code: every session ends, and the new one still needs the two-step code. */
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  async reset(@Body() body: ResetDto) {
    const result = await this.customers.resetPassword(await afrippaStore(this.prisma), body);
    return { ...result, two_step: { object: 'two_step_state' as const, pending: true } };
  }

  /** The account and what this session still has to do. */
  @Get()
  @UseGuards(CustomerGuard)
  @AllowTwoStepPending()
  async account(@CurrentCustomer() caller: CustomerCaller) {
    return { ...(await this.customers.present(caller.customer)), two_step: await this.twoStep.state(session(caller)) };
  }

  @Post('signout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CustomerGuard)
  @AllowTwoStepPending()
  signout(@CurrentCustomer() caller: CustomerCaller) {
    return this.customers.signout(caller.sessionId);
  }

  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CustomerGuard)
  @AllowTwoStepPending()
  verifyEmail(@CurrentCustomer() caller: CustomerCaller, @Body() body: CodeDto) {
    return this.customers.verifyEmail(caller.customer, body.code);
  }

  @Post('email/resend')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CustomerGuard)
  @AllowTwoStepPending()
  resendEmail(@CurrentCustomer() caller: CustomerCaller) {
    return this.customers.resendVerification(caller.customer);
  }

  /** A mobile number (the trader's country), confirmed by a texted code: needed to choose text messages for two-step. */
  @Post('phone')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CustomerGuard)
  @AllowTwoStepPending()
  addPhone(@CurrentCustomer() caller: CustomerCaller, @Body() body: PhoneDto) {
    return this.customers.addPhone(caller.customer, body.phone);
  }

  @Post('phone/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CustomerGuard)
  @AllowTwoStepPending()
  verifyPhone(@CurrentCustomer() caller: CustomerCaller, @Body() body: CodeDto) {
    return this.customers.verifyPhone(caller.customer, body.code);
  }

  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CustomerGuard)
  changePassword(@CurrentCustomer() caller: CustomerCaller, @Body() body: ChangePasswordDto) {
    return this.customers.changePassword(caller.customer, caller.sessionId, body);
  }

  // -- Two-step sign-in ----------------------------------------------------------------------------------------

  @Get('two-step')
  @UseGuards(CustomerGuard)
  @AllowTwoStepPending()
  twoStepSettings(@CurrentCustomer() caller: CustomerCaller) {
    return this.twoStep.settings(session(caller));
  }

  @Post('two-step/setup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CustomerGuard)
  @AllowTwoStepPending()
  @SkipIdempotency()
  setup(@CurrentCustomer() caller: CustomerCaller, @Body() body: TwoStepSetupDto) {
    return this.twoStep.setup(session(caller), body.method, body.current_code);
  }

  @Post('two-step/setup/confirm')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CustomerGuard)
  @AllowTwoStepPending()
  @SkipIdempotency()
  confirm(@CurrentCustomer() caller: CustomerCaller, @Body() body: TwoStepCodeDto) {
    return this.twoStep.confirmSetup(session(caller), body.code);
  }

  @Post('two-step/challenge')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CustomerGuard)
  @AllowTwoStepPending()
  challenge(@CurrentCustomer() caller: CustomerCaller) {
    return this.twoStep.challenge(session(caller));
  }

  @Post('two-step/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CustomerGuard)
  @AllowTwoStepPending()
  @SkipIdempotency()
  verify(@CurrentCustomer() caller: CustomerCaller, @Body() body: TwoStepCodeDto) {
    return this.twoStep.verify(session(caller), body.code);
  }

  @Post('two-step/recovery-codes')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CustomerGuard)
  @SkipIdempotency()
  recoveryCodes(@CurrentCustomer() caller: CustomerCaller, @Body() body: TwoStepCodeDto) {
    return this.twoStep.regenerateRecoveryCodes(session(caller), body.code);
  }
}

/**
 * Afrippa's operations: which two-step methods traders may use (for all of Afrippa, `WW`, and per market, the trader's
 * country winning), and resetting a trader who lost every method. Afrippa's admins only.
 */
@ApiExcludeController()
@RealmOnly('afrippa_admin')
@AdminRoles('operations', 'support')
@Controller('afrippa/admin')
export class AfrippaTraderAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly twoStep: TraderTwoStepService,
    private readonly audit: AuditService,
    private readonly devices: TraderDevicesService,
  ) {}

  @Get('two-step-methods')
  async policies() {
    const rows = await this.prisma.afrippaTwoStepPolicy.findMany({ orderBy: { market: 'asc' } });
    return { object: 'list' as const, data: rows.map(row => ({ object: 'two_step_policy' as const, market: row.market, methods: row.methods, updated_at: row.updatedAt.toISOString() })) };
  }

  /** Sets the methods allowed for all of Afrippa (`WW`) or one market. At least one stays allowed. */
  @Put('two-step-methods/:market')
  @AdminRoles('operations')
  @StepUp()
  async setPolicy(@CurrentCaller() caller: Caller, @Param('market') marketParam: string, @Body() body: PolicyDto) {
    const market = await this.market(marketParam);
    const before = await this.prisma.afrippaTwoStepPolicy.findUnique({ where: { market } });
    const actorId = caller.kind === 'session' ? caller.userId : null;
    const row = await this.prisma.afrippaTwoStepPolicy.upsert({ where: { market }, create: { market, methods: body.methods, updatedById: actorId }, update: { methods: body.methods, updatedById: actorId } });
    await this.audit.record({ actorId, action: 'trader.two_step_methods_changed', targetType: 'two_step_policy', targetId: market, before: before ? { methods: before.methods } : null, after: { methods: row.methods }, platform: 'afrippa' });
    return { object: 'two_step_policy' as const, market: row.market, methods: row.methods, updated_at: row.updatedAt.toISOString() };
  }

  /** A market goes back to all of Afrippa's methods. */
  @Delete('two-step-methods/:market')
  @AdminRoles('operations')
  @StepUp()
  async clearPolicy(@CurrentCaller() caller: Caller, @Param('market') marketParam: string) {
    const market = await this.market(marketParam);
    if (market === everywhere) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'All of Afrippa always has its methods: change them instead.', 'market');
    const removed = await this.prisma.afrippaTwoStepPolicy.deleteMany({ where: { market } });
    if (removed.count) await this.audit.record({ actorId: caller.kind === 'session' ? caller.userId : null, action: 'trader.two_step_methods_changed', targetType: 'two_step_policy', targetId: market, before: null, after: { methods: 'follows WW' }, platform: 'afrippa' });
    return { object: 'two_step_policy' as const, market, deleted: true };
  }

  /** A trader's devices (never their IDs): when each was used, and any other trader who used it. */
  @Get('traders/:id/devices')
  traderDevices(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.forAdmin(id);
  }

  /** A trader who lost every method, after they proved who they are: cleared, signed out, withdrawals held 24 hours. */
  @Post('traders/:id/two-step/reset')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  @StepUp()
  reset(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.twoStep.reset(caller.kind === 'session' ? caller.userId : null, id, body.reason);
  }

  private async market(value: string) {
    const market = value.trim().toUpperCase();
    if (market === everywhere) return market;
    if (!/^[A-Z]{2}$/.test(market) || !(await this.prisma.country.findUnique({ where: { code: market } }))) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such market.', 'market');
    }
    return market;
  }
}
