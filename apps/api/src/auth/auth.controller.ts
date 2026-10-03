import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { CodeDto, ForgotPasswordDto, PhoneDto, ResetPasswordDto, SignInDto, SignUpDto } from './auth.dto.js';
import { AuthService } from './auth.service.js';
import { type Caller, CurrentCaller, Public, SessionOnly } from './caller.js';
import { SessionsService } from './sessions.service.js';

/**
 * Reseller sign-in for the dashboard. These endpoints set or read the session cookie, so they skip idempotency keys:
 * a replayed response could not set the cookie again, and must never store credentials.
 */
@ApiTags('Authentication')
@SkipIdempotency()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  /** Create a reseller account and sign in. A 6-digit code is emailed to confirm the address. */
  @ApiOperation({ summary: 'Create a reseller account and sign in', description: 'A 6-digit code is emailed to confirm the address.' })
  @Public()
  @Post('signup')
  signUp(@Body() body: SignUpDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.signUp(body, req, res);
  }

  /** Sign in with email or verified mobile number and password. */
  @ApiOperation({ summary: 'Sign in with email or verified mobile number and password' })
  @Public()
  @Post('signin')
  @HttpCode(HttpStatus.OK)
  signIn(@Body() body: SignInDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.signIn(body.identifier, body.password, req, res);
  }

  /** End the current session. */
  @ApiOperation({ summary: 'End the current session' })
  @SessionOnly()
  @Post('signout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOut(@CurrentCaller() caller: Caller, @Res({ passthrough: true }) res: Response) {
    if (caller.kind === 'session') await this.sessions.revoke(caller.sessionId);
    this.sessions.clearCookie('reseller', res);
  }

  /** The signed-in person and the reseller accounts they belong to. */
  @ApiOperation({ summary: 'The signed-in person and the reseller accounts they belong to' })
  @SessionOnly()
  @Get('session')
  session(@CurrentCaller() caller: Caller) {
    return this.auth.describe(caller.kind === 'session' ? caller.userId : '');
  }

  /** Confirm your email address with the code that was sent to it. */
  @ApiOperation({ summary: 'Confirm your email address with the code that was sent to it' })
  @SessionOnly()
  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@CurrentCaller() caller: Caller, @Body() body: CodeDto) {
    return this.auth.verifyEmail(caller.kind === 'session' ? caller.userId : '', body.code);
  }

  /** Send a new email confirmation code (at most one a minute). */
  @ApiOperation({ summary: 'Send a new email confirmation code (at most one a minute)' })
  @SessionOnly()
  @Post('email/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(@CurrentCaller() caller: Caller) {
    await this.auth.resendVerification(caller.kind === 'session' ? caller.userId : '');
    return { object: 'notice', message: 'A new code is on its way.' };
  }

  /** Add or change your mobile number. A 6-digit code is sent by SMS; the number is used once confirmed. */
  @ApiOperation({ summary: 'Add or change your mobile number', description: 'A 6-digit code is sent by SMS; the number is used once confirmed.' })
  @SessionOnly()
  @Post('phone')
  @HttpCode(HttpStatus.ACCEPTED)
  async addPhone(@CurrentCaller() caller: Caller, @Body() body: PhoneDto) {
    const country = caller.kind === 'session' && caller.resellerId ? await this.auth.resellerCountry(caller.resellerId) : null;
    return this.auth.addPhone(caller.kind === 'session' ? caller.userId : '', body.phone, country);
  }

  /** Confirm your mobile number. You can then sign in with it. */
  @ApiOperation({ summary: 'Confirm your mobile number', description: 'You can then sign in with it.' })
  @SessionOnly()
  @Post('phone/verify')
  @HttpCode(HttpStatus.OK)
  verifyPhone(@CurrentCaller() caller: Caller, @Body() body: CodeDto) {
    return this.auth.verifyPhone(caller.kind === 'session' ? caller.userId : '', body.code);
  }

  /** Email a password reset code. Always reports success, whether or not the account exists. */
  @ApiOperation({ summary: 'Email a password reset code', description: 'Always reports success, whether or not the account exists.' })
  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    await this.auth.forgotPassword(body.email);
    return { object: 'notice', message: 'If an account uses this email, a reset code is on its way.' };
  }

  /** Choose a new password with the emailed code. Signs out every existing session. */
  @ApiOperation({ summary: 'Choose a new password with the emailed code', description: 'Signs out every existing session.' })
  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() body: ResetPasswordDto) {
    await this.auth.resetPassword(body.email, body.code, body.password);
    return { object: 'notice', message: 'Your password has been changed. Sign in with it now.' };
  }
}
