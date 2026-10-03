import { Controller, Get, HttpStatus, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { type Caller, type CallerRequest, Public } from './caller.js';
import { type GoogleIntent, GoogleService } from './google.service.js';

/** Browser redirects for "Sign in with Google". Not for API keys; reseller accounts only. */
@ApiTags('Authentication')
@Public()
@Controller('auth/google')
export class GoogleController {
  constructor(private readonly google: GoogleService) {}

  /**
   * Redirects to Google. Afterwards the browser returns to `return_to` (a BitoCard app; defaults to the dashboard),
   * with `?auth_error=<code>` if it failed. `intent=signup` creates an account for a new Google account (the reseller
   * account is opened in onboarding afterwards); `signin` (the default) fails with `google_account_not_found` instead.
   * With `intent=link`, a signed-in person links Google to their account.
   */
  @ApiOperation({
    summary: 'Redirects to Google',
    description:
      'Afterwards the browser returns to `return_to` (a BitoCard app; defaults to the dashboard), with `?auth_error=<code>` if it failed. `intent=signup` creates an account for a new Google account (the reseller account is opened in onboarding afterwards); `signin` (the default) fails with `google_account_not_found` instead. With `intent=link`, a signed-in person links Google to their account.',
  })
  @Get('start')
  @ApiQuery({ name: 'return_to', required: false, description: 'A BitoCard app URL to return to.' })
  @ApiQuery({ name: 'intent', required: false, enum: ['signin', 'signup', 'link'] })
  async start(@Req() req: CallerRequest, @Res() res: Response, @Query('return_to') returnTo?: string, @Query('intent') intent?: string) {
    const caller: Caller | undefined = req.caller;
    const linkUserId = intent === 'link' && caller?.kind === 'session' ? caller.userId : null;
    const purpose: GoogleIntent = intent === 'signup' ? 'signup' : intent === 'link' ? 'link' : 'signin';
    res.redirect(HttpStatus.FOUND, await this.google.start(req, res, returnTo, purpose, linkUserId));
  }

  /** Google returns here. Not called directly. */
  @ApiOperation({ summary: 'Google returns here', description: 'Not called directly.' })
  @Get('callback')
  async callback(@Req() req: CallerRequest, @Res() res: Response) {
    res.redirect(HttpStatus.FOUND, await this.google.callback(req, res));
  }
}
