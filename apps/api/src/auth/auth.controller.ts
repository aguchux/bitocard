import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { ChangeEmailDto, ChangePasswordDto, CodeDto, CreateResellerAccountDto, ForgotPasswordDto, PhoneDto, ProfileDto, ResetPasswordDto, SignInDto, SignUpDto } from './auth.dto.js';
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

  /** Open a reseller account for the signed-in person, who becomes its owner. */
  @ApiOperation({
    summary: 'Open a reseller account for the signed-in person',
    description: 'For a person who joined through an invitation, or left a team, and now wants their own business. Needs a confirmed email; one owned account per person.',
  })
  @SessionOnly()
  @Post('reseller-account')
  createResellerAccount(@CurrentCaller() caller: Caller, @Body() body: CreateResellerAccountDto) {
    return this.auth.createResellerAccount(caller.kind === 'session' ? caller.userId : '', body);
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

  /** Change your name. */
  @ApiOperation({ summary: 'Change your name' })
  @SessionOnly()
  @Patch('profile')
  updateProfile(@CurrentCaller() caller: Caller, @Body() body: ProfileDto) {
    return this.auth.updateProfile(caller.kind === 'session' ? caller.userId : '', body.name);
  }

  /** Change your password with the current one. Signs out your other sessions. */
  @ApiOperation({ summary: 'Change your password', description: 'Needs your current password. Signs out your other sessions; this one stays signed in.' })
  @SessionOnly()
  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  async changePassword(@CurrentCaller() caller: Caller, @Body() body: ChangePasswordDto) {
    if (caller.kind === 'session') await this.auth.changePassword(caller.userId, caller.sessionId, body.current_password, body.new_password);
    return { object: 'notice', message: 'Your password was changed.' };
  }

  /** Change your sign-in email: a 6-digit code is sent to the new address. */
  @ApiOperation({ summary: 'Change your sign-in email', description: 'Needs your current password. A 6-digit code is sent to the new address; confirm it to finish.' })
  @SessionOnly()
  @Post('email/change')
  @HttpCode(HttpStatus.ACCEPTED)
  async changeEmail(@CurrentCaller() caller: Caller, @Body() body: ChangeEmailDto) {
    await this.auth.requestEmailChange(caller.kind === 'session' ? caller.userId : '', body.email, body.password);
    return { object: 'notice', message: 'A code is on its way to the new address.' };
  }

  /** Confirm the new sign-in email with the code sent to it. */
  @ApiOperation({ summary: 'Confirm your new sign-in email', description: 'Your old address is told about the change.' })
  @SessionOnly()
  @Post('email/change/verify')
  @HttpCode(HttpStatus.OK)
  confirmEmailChange(@CurrentCaller() caller: Caller, @Body() body: CodeDto) {
    return this.auth.confirmEmailChange(caller.kind === 'session' ? caller.userId : '', body.code);
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
