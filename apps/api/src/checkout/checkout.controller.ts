import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Public } from '../auth/caller.js';
import { passwordLength } from '../auth/passwords.service.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { CustomersService, presentCustomer } from '../customers/customers.service.js';
import { StoreKey } from '../customers/store-key.js';
import { IdentityService } from '../identity/identity.service.js';
import { PageDto } from '../ledger/wallet.controller.js';
import { paymentGateways } from '../payments/payment-providers.js';
import { SettingsService } from '../settings/settings.service.js';
import { desktopNavFor } from '../stores/stores.service.js';
import { type CheckoutGroup, checkoutGroups, CheckoutService } from './checkout.service.js';
import { StoreSellers } from './store-sellers.js';

const lowerTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

class SignUpDto {
  @Transform(trim) @IsString() @Length(2, 100)
  name: string;

  @Transform(lowerTrim) @IsEmail() @Length(3, 254)
  email: string;

  @IsString() @Length(passwordLength.min, passwordLength.max)
  password: string;
}

class SignInDto {
  @Transform(lowerTrim) @IsEmail() @Length(3, 254)
  email: string;

  @IsString() @Length(1, passwordLength.max)
  password: string;
}

class CodeDto {
  @Matches(/^\d{6}$/, { message: 'code must be the 6-digit code' })
  code: string;
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

class ProfileDto {
  @Transform(trim) @IsString() @Length(2, 100)
  name: string;
}

class ChangePasswordDto {
  @IsString() @Length(1, passwordLength.max)
  current_password: string;

  @IsString() @Length(passwordLength.min, passwordLength.max)
  password: string;
}

class CheckoutListDto extends PageDto {
  /** Only the orders in one group (`checkoutGroups`), paged on the server so every page is full. */
  @IsOptional() @IsIn(Object.keys(checkoutGroups))
  show?: CheckoutGroup;
}

class CountryQueryDto {
  @Transform(upper) @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter code' })
  country: string;
}

class RecipientDto {
  @IsOptional() @IsString() @Length(4, 20)
  phone?: string;

  @IsOptional() @IsString() @Length(4, 40)
  account_number?: string;

  @IsOptional() @IsIn(['change', 'renew'])
  transaction_type?: 'change' | 'renew';

  @IsOptional() @Transform(lowerTrim) @IsEmail() @Length(3, 254)
  email?: string;
}

class StartCheckoutDto {
  @IsUUID()
  product_id: string;

  /** Minor units of the product's face currency. */
  @IsInt() @Min(1) @Max(100_000_000_00)
  face_value: number;

  @IsOptional() @IsInt() @Min(1) @Max(10)
  quantity?: number;

  /** The customer's market: they pay in its currency (a reseller's store always sells in its own country). */
  @Transform(upper) @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter code' })
  country: string;

  @IsOptional() @IsIn(Object.keys(paymentGateways))
  method?: string;

  @IsOptional() @ValidateNested() @Type(() => RecipientDto)
  recipient?: RecipientDto;

  /** The store page the payment page returns the customer to (the checkout's ID is added). */
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true, require_tld: false })
  return_url: string;
}

class SimulateDto {
  @IsIn(['succeeded', 'failed'])
  outcome: 'succeeded' | 'failed';

  /** Once paid, whether the sandbox order is delivered (default) or fails, which refunds the customer. */
  @IsOptional() @IsIn(['completed', 'failed'])
  order?: 'completed' | 'failed';
}

class VerificationDto {
  @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country: string;

  @Transform(trim) @IsString() @Length(1, 60)
  first_name: string;

  @Transform(trim) @IsString() @Length(1, 60)
  last_name: string;

  @IsOptional() @Matches(/^\d{11}$/, { message: 'bvn must be 11 digits' })
  bvn?: string;

  @IsUrl({ protocols: ['https', 'http'], require_protocol: true, require_tld: false })
  redirect_url: string;

  @IsBoolean() @Equals(true, { message: 'consent must be true' })
  consent: boolean;
}

/**
 * Customer accounts on hosted stores: bitocard.com, or a reseller's store named in `BitoCard-Store` (an account exists
 * at one store only). Called by the store's server, never by browsers: it keeps the session token in its own cookie and
 * sends it as `BitoCard-Customer-Session`. Not part of the public reseller API (resellers' own systems use their own
 * customer accounts with quotes and orders).
 */
@ApiExcludeController()
@Public()
@Controller('store/account')
export class CustomerAccountController {
  constructor(
    private readonly customers: CustomersService,
    private readonly stores: StoreSellers,
    private readonly identity: IdentityService,
  ) {}

  /** Returns the session token, so it is never stored for replay. */
  @SkipIdempotency()
  @Post('signup')
  async signup(@StoreKey() store: string | null, @Body() body: SignUpDto) {
    return this.customers.signup(await this.stores.resolve(store), body);
  }

  @SkipIdempotency()
  @Post('signin')
  @HttpCode(HttpStatus.OK)
  async signin(@StoreKey() store: string | null, @Body() body: SignInDto) {
    return this.customers.signin(await this.stores.resolve(store), body);
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  async forgot(@StoreKey() store: string | null, @Body() body: ForgotDto) {
    return this.customers.forgotPassword(await this.stores.resolve(store), body.email);
  }

  @SkipIdempotency()
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  async reset(@StoreKey() store: string | null, @Body() body: ResetDto) {
    return this.customers.resetPassword(await this.stores.resolve(store), body);
  }

  @UseGuards(CustomerGuard)
  @Get()
  me(@CurrentCustomer() caller: CustomerCaller) {
    return presentCustomer(caller.customer);
  }

  @UseGuards(CustomerGuard)
  @Post('signout')
  @HttpCode(HttpStatus.OK)
  signout(@CurrentCustomer() caller: CustomerCaller) {
    return this.customers.signout(caller.sessionId);
  }

  @UseGuards(CustomerGuard)
  @Post('profile')
  @HttpCode(HttpStatus.OK)
  profile(@CurrentCustomer() caller: CustomerCaller, @Body() body: ProfileDto) {
    return this.customers.updateProfile(caller.customer, body);
  }

  @UseGuards(CustomerGuard)
  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  changePassword(@CurrentCustomer() caller: CustomerCaller, @Body() body: ChangePasswordDto) {
    return this.customers.changePassword(caller.customer, caller.sessionId, body);
  }

  @UseGuards(CustomerGuard)
  @Post('email/resend')
  @HttpCode(HttpStatus.OK)
  resend(@CurrentCustomer() caller: CustomerCaller) {
    return this.customers.resendVerification(caller.customer);
  }

  @UseGuards(CustomerGuard)
  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@CurrentCustomer() caller: CustomerCaller, @Body() body: CodeDto) {
    return this.customers.verifyEmail(caller.customer, body.code);
  }

  /** The customer's identity check for a market (BVN in Nigeria, Didit elsewhere), where buying needs one. */
  @UseGuards(CustomerGuard)
  @Get('verification')
  async verification(@CurrentCustomer() caller: CustomerCaller, @Query() query: CountryQueryDto) {
    const store = caller.customer.store;
    const mode = this.stores.mode(store);
    const seller = await this.stores.seller(store, query.country);
    const verified = await this.identity.isCustomerVerified(seller.id, mode, caller.customer.id);
    const latest = verified ? null : await this.identity.customerVerification(seller.id, mode, caller.customer.id).catch(() => null);
    return { object: 'customer_verification_status' as const, country: seller.country, verified, latest };
  }

  @UseGuards(CustomerGuard)
  @Post('verification')
  async startVerification(@CurrentCustomer() caller: CustomerCaller, @Body() body: VerificationDto) {
    const store = caller.customer.store;
    const seller = await this.stores.seller(store, body.country);
    return this.identity.startCustomerVerification(seller.id, this.stores.mode(store), caller.customer.id, { ...body, country: seller.country! });
  }
}

/** Buying on a hosted store (bitocard.com or a reseller's): payment methods, checkouts and the customer's orders. */
@ApiExcludeController()
@Public()
@Controller('store')
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly stores: StoreSellers,
    private readonly settings: SettingsService,
  ) {}

  /** How the store's customer account app looks (bitocard.com, or the store named): its desktop menu. */
  @Get('app')
  @Header('Cache-Control', 'public, max-age=60')
  async app(@StoreKey() key: string | null) {
    const store = await this.stores.resolve(key);
    return { object: 'store_app' as const, desktop_nav: await desktopNavFor(this.settings, store) };
  }

  /** The customer's figures for their account home: what they spent, their orders, and deliveries this month. */
  @UseGuards(CustomerGuard)
  @Get('account/summary')
  summary(@CurrentCustomer() caller: CustomerCaller) {
    return this.checkout.summary(caller.customer);
  }

  /** How customers in a country can pay (no sign-in needed, for showing on product pages). A reseller's store: its own. */
  @Get('payment-methods')
  async methods(@StoreKey() store: string | null, @Query() query: CountryQueryDto) {
    return this.checkout.methodsFor(await this.stores.resolve(store), query.country);
  }

  @UseGuards(CustomerGuard)
  @Post('checkouts')
  start(@CurrentCustomer() caller: CustomerCaller, @Body() body: StartCheckoutDto) {
    return this.checkout.start(caller.customer, body);
  }

  @UseGuards(CustomerGuard)
  @Get('checkouts')
  list(@CurrentCustomer() caller: CustomerCaller, @Query() page: CheckoutListDto) {
    return this.checkout.list(caller.customer, page);
  }

  @UseGuards(CustomerGuard)
  @Get('checkouts/:id')
  get(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.checkout.get(caller.customer, id);
  }

  /** Sandbox checkouts only (Settings > Integrations > Customer checkout > Sandbox). */
  @UseGuards(CustomerGuard)
  @Post('checkouts/:id/simulate')
  @HttpCode(HttpStatus.OK)
  simulate(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SimulateDto) {
    return this.checkout.simulate(caller.customer, id, body.outcome, body.order);
  }
}
