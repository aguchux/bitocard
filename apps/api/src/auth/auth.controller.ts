import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { AddEmailDto, ChangePasswordDto, CodeDto, CreateResellerAccountDto, ForgotPasswordDto, SignupEmailDto, SignupEmailVerifyDto, PhoneDto, PrimaryEmailDto, ProfileDto, ResetPasswordDto, SignInDto, SignUpDto } from './auth.dto.js';
import { AuthService } from './auth.service.js';
import { type Caller, CurrentCaller, Public, SessionOnly } from './caller.js';
import { SessionsService } from './sessions.service.js';
import { SignupVerificationService } from './signup-verification.service.js';

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
    private readonly signupVerification: SignupVerificationService,
  ) {}

  /** Step-by-step sign-up, step 1: email a code to confirm the address before the account exists. */
  @ApiOperation({
    summary: 'Start sign-up: email a confirmation code',
    description: 'Sends a 6-digit code (30 minutes, 5 attempts, one a minute). Refused with `email_in_use` if an account already uses the email.',
  })
  @Public()
  @Post('signup/email')
  @HttpCode(HttpStatus.ACCEPTED)
  async startSignupEmail(@Body() body: SignupEmailDto) {
    await this.signupVerification.start(body.email);
    return { object: 'notice', message: 'A code is on its way.' };
  }

  /** Step-by-step sign-up, step 2: confirm the code; returns a one-hour token for `POST /v1/auth/signup`. */
  @ApiOperation({
    summary: 'Confirm the sign-up code',
    description: 'Returns `signup_token`, valid for one hour and once, to pass to `POST /v1/auth/signup` with the same email.',
  })
  @Public()
  @Post('signup/email/verify')
  @HttpCode(HttpStatus.OK)
  verifySignupEmail(@Body() body: SignupEmailVerifyDto) {
    return this.signupVerification.verify(body.email, body.code);
  }

  /** Create a reseller account and sign in. Without a `signup_token`, a 6-digit code is emailed to confirm the address. */
  @ApiOperation({
    summary: 'Create a reseller account and sign in',
    description: 'With a `signup_token` (from confirming the email first) the email is already confirmed; otherwise a 6-digit code is emailed to confirm it.',
  })
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

  /** Your email addresses: the primary one (sign-in and notices) first, then the others. */
  @ApiOperation({ summary: 'List your email addresses', description: 'The primary address (you sign in with it and notices go to it) first, then your other confirmed addresses.' })
  @SessionOnly()
  @Get('emails')
  listEmails(@CurrentCaller() caller: Caller) {
    return this.auth.listEmails(caller.kind === 'session' ? caller.userId : '');
  }

  /** Add an email address: a 6-digit code is sent to it. */
  @ApiOperation({ summary: 'Add an email address', description: 'A 6-digit code is sent to the address; confirm it to add the address. Up to five addresses in all.' })
  @SessionOnly()
  @Post('emails')
  @HttpCode(HttpStatus.ACCEPTED)
  async addEmail(@CurrentCaller() caller: Caller, @Body() body: AddEmailDto) {
    await this.auth.addEmail(caller.kind === 'session' ? caller.userId : '', body.email);
    return { object: 'notice', message: 'A code is on its way to the address.' };
  }

  /** Confirm an address you are adding with the code sent to it. */
  @ApiOperation({ summary: 'Confirm an email address', description: 'Adds the address the last code was sent to. Your primary address is told.' })
  @SessionOnly()
  @Post('emails/verify')
  @HttpCode(HttpStatus.OK)
  confirmEmail(@CurrentCaller() caller: Caller, @Body() body: CodeDto) {
    return this.auth.confirmEmail(caller.kind === 'session' ? caller.userId : '', body.code);
  }

  /** Sign in with another of your confirmed addresses from now on. */
  @ApiOperation({
    summary: 'Make an email address primary',
    description: 'You sign in with it and notices go to it. The old primary stays as another address. Needs your current password if your account has one; your old primary address is told.',
  })
  @SessionOnly()
  @Post('emails/primary')
  @HttpCode(HttpStatus.OK)
  makePrimary(@CurrentCaller() caller: Caller, @Body() body: PrimaryEmailDto) {
    return this.auth.makePrimary(caller.kind === 'session' ? caller.userId : '', body.email, body.password);
  }

  /** Remove one of your other addresses. The primary one cannot be removed. */
  @ApiOperation({ summary: 'Remove an email address', description: 'Your primary address cannot be removed: make another address primary first.' })
  @SessionOnly()
  @Delete('emails/:email')
  removeEmail(@CurrentCaller() caller: Caller, @Param('email') email: string) {
    return this.auth.removeEmail(caller.kind === 'session' ? caller.userId : '', email.trim().toLowerCase());
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
