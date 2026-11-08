import { Controller, Get, HttpStatus, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ProductOnly } from '../products/product.js';
import { Public } from './caller.js';
import { FacebookService } from './facebook.service.js';

/** Browser redirects for "Continue with Facebook" in Seller HQ. Not for API keys; reseller people only. */
@ApiTags('Authentication')
@ProductOnly('udozo')
@Public()
@Controller('auth/facebook')
export class FacebookController {
  constructor(private readonly facebook: FacebookService) {}

  @ApiOperation({
    summary: 'Redirects to Facebook',
    description:
      'Afterwards the browser returns to `return_to` (a Udozo app; defaults to Seller HQ), with `?auth_error=<code>` if it failed. A Facebook account no account uses yet signs up: only the person is made, and their email is confirmed with an emailed code before onboarding.',
  })
  @Get('start')
  @ApiQuery({ name: 'return_to', required: false, description: 'A Udozo app URL to return to.' })
  @ApiQuery({ name: 'intent', required: false, enum: ['signin', 'signup'] })
  async start(@Res() res: Response, @Query('return_to') returnTo?: string, @Query('intent') intent?: string) {
    res.redirect(HttpStatus.FOUND, await this.facebook.start(res, returnTo, intent === 'signup' ? 'signup' : 'signin'));
  }

  /** Facebook returns here. Not called directly. */
  @ApiOperation({ summary: 'Facebook returns here', description: 'Not called directly.' })
  @Get('callback')
  async callback(@Req() req: Request, @Res() res: Response) {
    res.redirect(HttpStatus.FOUND, await this.facebook.callback(req, res));
  }
}
