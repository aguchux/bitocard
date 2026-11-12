import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { Public } from '../auth/caller.js';
import { StoreSellers } from '../checkout/store-sellers.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { ProductOnly } from '../products/product.js';
import { TrackSignup } from '../signups/track.js';
import { AccountDeletionService } from './account-deletion.service.js';
import { CustomerAppleService } from './customer-apple.service.js';
import { CustomerFacebookService } from './customer-facebook.service.js';
import { CustomerGoogleService } from './customer-google.service.js';
import { AllowPhonePending, CurrentCustomer, type CustomerCaller, CustomerGuard } from './customer-session.js';
import { StoreKey } from './store-key.js';

const nonce = { message: 'nonce must be 16 to 128 letters, digits, dots, dashes or underscores' };
const ref = { message: 'ref must be a short code' };

class GoogleNativeDto {
  @IsString() @Length(20, 4096)
  id_token: string;

  /** The nonce the app gave Google's SDK. */
  @Matches(/^[\w.-]{16,128}$/, nonce)
  nonce: string;

  @IsOptional() @Matches(/^[\w.~-]{1,64}$/, ref)
  ref?: string;
}

class FacebookNativeDto {
  /** Android, and iPhones that allowed tracking: the SDK's access token. */
  @IsOptional() @IsString() @Length(20, 4096)
  access_token?: string;

  /** iPhones that declined tracking: Limited Login's signed token, for the app's nonce. */
  @IsOptional() @IsString() @Length(20, 4096)
  id_token?: string;

  @IsOptional() @Matches(/^[\w.-]{16,128}$/, nonce)
  nonce?: string;

  @IsOptional() @Matches(/^[\w.~-]{1,64}$/, ref)
  ref?: string;
}

class AppleNativeDto {
  @IsString() @Length(20, 4096)
  identity_token: string;

  @Matches(/^[\w.-]{16,128}$/, nonce)
  nonce: string;

  /** Apple's one-time code, exchanged so access can be revoked when the account is deleted. */
  @IsOptional() @IsString() @Length(1, 1000)
  authorization_code?: string;

  /** Apple gives the name only the first time: the app passes it on. */
  @IsOptional() @IsString() @MaxLength(60)
  first_name?: string;

  @IsOptional() @IsString() @MaxLength(60)
  last_name?: string;

  @IsOptional() @Matches(/^[\w.~-]{1,64}$/, ref)
  ref?: string;
}

class DeleteAccountDto {
  @IsIn(['DELETE'], { message: 'Type DELETE to confirm.' })
  confirm: string;

  @IsOptional() @IsString() @MaxLength(256)
  password?: string;
}

/**
 * Udozo's app (docs/UDOZO_MOBILE_APP_PLAN.md): native sign-in, where Google's, Facebook's and Apple's SDKs hand the app
 * a token it sends here (the web's round trips stay on `…/start` and `…/finish`), and deleting the account, which the
 * App Store and Google Play require inside the app (udozo.com can use it too). Each sign-in answers as the web's finish
 * does: the customer, a session, and `signed_up` for a new account, which then onboards.
 */
@ApiExcludeController()
@Public()
@ProductOnly('udozo')
@Controller('store/account')
export class AppAccountController {
  constructor(
    private readonly stores: StoreSellers,
    private readonly google: CustomerGoogleService,
    private readonly facebook: CustomerFacebookService,
    private readonly apple: CustomerAppleService,
    private readonly deletion: AccountDeletionService,
  ) {}

  @SkipIdempotency()
  @TrackSignup('udozo', 'google')
  @Post('google/native')
  @HttpCode(HttpStatus.OK)
  async googleNative(@StoreKey() store: string | null, @Body() body: GoogleNativeDto) {
    return this.google.native(await this.stores.accountStore(store), { idToken: body.id_token, nonce: body.nonce, ref: body.ref });
  }

  @SkipIdempotency()
  @TrackSignup('udozo', 'facebook')
  @Post('facebook/native')
  @HttpCode(HttpStatus.OK)
  async facebookNative(@StoreKey() store: string | null, @Body() body: FacebookNativeDto) {
    return this.facebook.native(await this.stores.accountStore(store), { accessToken: body.access_token, idToken: body.id_token, nonce: body.nonce, ref: body.ref });
  }

  @SkipIdempotency()
  @TrackSignup('udozo', 'apple')
  @Post('apple/native')
  @HttpCode(HttpStatus.OK)
  async appleNative(@StoreKey() store: string | null, @Body() body: AppleNativeDto) {
    return this.apple.native(await this.stores.accountStore(store), {
      identityToken: body.identity_token,
      nonce: body.nonce,
      authorizationCode: body.authorization_code,
      firstName: body.first_name,
      lastName: body.last_name,
      ref: body.ref,
    });
  }

  /** What stands in the way of deleting the account (money, open orders), shown before asking. */
  @UseGuards(CustomerGuard)
  @AllowPhonePending()
  @Get('delete')
  deletionCheck(@CurrentCustomer() caller: CustomerCaller) {
    return this.deletion.check(caller.customer);
  }

  /** Deletes the account for good: `confirm: "DELETE"`, and the password when the account has one. */
  @UseGuards(CustomerGuard)
  @AllowPhonePending()
  @SkipIdempotency()
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentCustomer() caller: CustomerCaller, @Body() body: DeleteAccountDto) {
    return this.deletion.delete(caller.customer, body);
  }
}
