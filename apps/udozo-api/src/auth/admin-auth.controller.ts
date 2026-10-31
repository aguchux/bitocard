import { Body, Controller, Get, HttpCode, HttpStatus, Injectable, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';
import type { Request, Response } from 'express';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { AdminAuthService } from './admin-auth.service.js';
import { type AdminRealm, type Caller, CurrentCaller, Public, RealmOnly } from './caller.js';
import { passwordLength } from './passwords.service.js';
import { SessionsService } from './sessions.service.js';

class AdminSignInDto {
  @ApiProperty({ format: 'email', example: 'ops@bitocard.com' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 1, maxLength: passwordLength.max })
  @IsString()
  @Length(1, passwordLength.max)
  password: string;
}

class ChallengeDto {
  @ApiProperty({ description: 'The challenge_token returned by sign-in.' })
  @IsString()
  @Length(40, 120)
  challenge_token: string;
}

class MfaVerifyDto extends ChallengeDto {
  @ApiProperty({ description: '6-digit authenticator code, or a recovery code (xxxx-xxxx).', example: '492817' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @Matches(/^(\d{6}|[a-z0-9]{4}-[a-z0-9]{4})$/, { message: 'code must be a 6-digit code or a recovery code' })
  code: string;
}

class StepUpDto {
  @ApiProperty({ description: 'The 6-digit code from the admin’s authenticator app.' })
  @Matches(/^\d{6}$/, { message: 'code must be the 6 digits from your authenticator app' })
  code: string;
}

class AdminEmailDto {
  @ApiProperty({ format: 'email', example: 'ops@bitocard.com' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email: string;
}

class PasswordLinkDto {
  @ApiProperty({ description: 'The token from the emailed set-password link.' })
  @IsString()
  @Length(40, 120)
  token: string;
}

class CompletePasswordLinkDto extends PasswordLinkDto {
  @ApiProperty({ minLength: passwordLength.min, maxLength: passwordLength.max })
  @IsString()
  @Length(passwordLength.min, passwordLength.max)
  password: string;

  @ApiProperty({ required: false, description: 'A new admin\'s name (first password only).' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @ApiProperty({ required: false, description: 'Also remove the authenticator, to set it up again at the next sign-in.' })
  @IsOptional()
  @IsBoolean()
  reset_authenticator?: boolean;
}

/**
 * Admin sign-in, two steps: password, then an authenticator code every time one is set up (team members other than
 * super admins may skip setting it up and turn it on later). The same routes serve both admin realms
 * (below), each only for its own accounts.
 */
@Injectable()
abstract class AdminAuthRoutes {
  protected abstract readonly realm: AdminRealm;

  constructor(
    protected readonly adminAuth: AdminAuthService,
    protected readonly sessions: SessionsService,
  ) {}

  /**
   * Step 0: the email. `link_sent` when an address in ADMIN_SETUP_EMAILS was set up and emailed a link to choose its
   * password; otherwise `password` (for every other address, admin or not).
   */
  @Public()
  @Post('start')
  @HttpCode(HttpStatus.OK)
  start(@Body() body: AdminEmailDto) {
    return this.adminAuth.startSignIn(body.email, this.realm);
  }

  /** Forgot password: emails a reset link to addresses in ADMIN_SETUP_EMAILS only. The same answer every time. */
  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() body: AdminEmailDto) {
    return this.adminAuth.forgotPassword(body.email, this.realm);
  }

  /** Step 1: email and password. Returns a 5-minute challenge to complete with an authenticator code. */
  @Public()
  @Post('signin')
  @HttpCode(HttpStatus.OK)
  signIn(@Body() body: AdminSignInDto) {
    return this.adminAuth.signIn(body.email, body.password, this.realm);
  }

  /** First sign-in only: get the authenticator secret (and a QR-code URI) to add to an authenticator app. */
  @Public()
  @Post('mfa/setup')
  @HttpCode(HttpStatus.OK)
  setup(@Body() body: ChallengeDto) {
    return this.adminAuth.setup(body.challenge_token, this.realm);
  }

  /** Step 2: authenticator or recovery code. Starts the session; the first time, returns 10 recovery codes once. */
  @Public()
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  verify(@Body() body: MfaVerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.adminAuth.verify(body.challenge_token, body.code, req, res, this.realm);
  }

  /**
   * "Not now" on the first sign-in's authenticator step: a team member who need not use one is signed in without it
   * (super admins must set it up).
   */
  @Public()
  @Post('mfa/skip')
  @HttpCode(HttpStatus.OK)
  skip(@Body() body: ChallengeDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.adminAuth.skipSetup(body.challenge_token, req, res, this.realm);
  }

  /** From their account: a new authenticator secret (and QR-code URI) to scan, until it is confirmed. */
  @Post('authenticator/setup')
  @HttpCode(HttpStatus.OK)
  startAuthenticator(@CurrentCaller() caller: Caller) {
    return this.adminAuth.startAuthenticator(caller.kind === 'session' ? caller.userId : '');
  }

  /** Confirms it with the first 6-digit code: 2-step verification is on, and 10 recovery codes are returned once. */
  @Post('authenticator/confirm')
  @HttpCode(HttpStatus.OK)
  confirmAuthenticator(@CurrentCaller() caller: Caller, @Body() body: StepUpDto) {
    return this.adminAuth.confirmAuthenticator(caller.kind === 'session' ? caller.userId : '', body.code);
  }

  /** The set-password page: whose link it is (the token is sent in the body, never in an address). */
  @Public()
  @Post('password-link')
  @HttpCode(HttpStatus.OK)
  passwordLink(@Body() body: PasswordLinkDto) {
    return this.adminAuth.describePasswordLink(body.token, this.realm);
  }

  /** Sets the password with the emailed link (once), optionally resetting the authenticator. Does not sign in. */
  @Public()
  @Post('password-link/complete')
  @HttpCode(HttpStatus.OK)
  completePasswordLink(@Body() body: CompletePasswordLinkDto) {
    return this.adminAuth.completePasswordLink(body.token, body.password, { resetAuthenticator: body.reset_authenticator, name: body.name }, this.realm);
  }

  @Get('session')
  async session(@CurrentCaller() caller: Caller) {
    const described = await this.adminAuth.describe(caller.kind === 'session' ? caller.userId : '');
    const until = caller.kind === 'session' && caller.stepUpUntil && caller.stepUpUntil > new Date() ? caller.stepUpUntil.toISOString() : null;
    return { ...described, step_up_until: until };
  }

  /** Opens 5 minutes of sensitive and money actions on this session with the admin's authenticator code. */
  @Post('step-up')
  @HttpCode(HttpStatus.OK)
  stepUp(@CurrentCaller() caller: Caller, @Body() body: StepUpDto) {
    if (caller.kind !== 'session') throw new Error('Admin step-up needs a session');
    return this.adminAuth.stepUp(caller.userId, caller.sessionId, body.code);
  }

  @Post('signout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOut(@CurrentCaller() caller: Caller, @Res({ passthrough: true }) res: Response) {
    if (caller.kind === 'session') await this.sessions.revoke(caller.sessionId);
    this.sessions.clearCookie(this.realm, res);
  }
}

/** BitoCard's admins (admin.bitocard.com). */
@ApiExcludeController()
@RealmOnly('admin')
@SkipIdempotency()
@Controller('admin/auth')
export class AdminAuthController extends AdminAuthRoutes {
  protected readonly realm = 'admin';
}

/**
 * Afrippa's admins (admin.afrippa.com, their own realm; docs/CRYPTO_SPINOFF_PLAN.md): `@afrippa.com` addresses
 * (`AFRIPPA_ADMIN_EMAIL_DOMAINS`), set up and reset only for `AFRIPPA_ADMIN_SETUP_EMAILS`, their own session cookie
 * (`afr_admin_session`), step-up and audit trail. BitoCard's admins cannot use these routes, nor they BitoCard's.
 */
@ApiExcludeController()
@RealmOnly('afrippa_admin')
@SkipIdempotency()
@Controller('afrippa/admin/auth')
export class AfrippaAdminAuthController extends AdminAuthRoutes {
  protected readonly realm = 'afrippa_admin';
}
