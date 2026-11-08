import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import type { Request } from 'express';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { adminId } from '../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { ProductOnly } from '../products/product.js';
import { WhatsappAdminService } from './admin.service.js';
import { WhatsappContactsService } from './contacts.service.js';
import { WhatsappNotices } from './notices.service.js';
import { WhatsappSignIns } from './sign-in.service.js';
import { deviceOf } from '../signups/journeys.service.js';
import { templateNames } from './templates.js';

/** Meta's webhook for Udozo's number: the address check, then signed notifications. */
@ApiExcludeController()
@Public()
@SkipIdempotency()
@Controller('webhooks/whatsapp')
@ProductOnly('udozo')
export class WhatsappWebhookController {
  constructor(private readonly notices: WhatsappNotices) {}

  @Get()
  @Header('content-type', 'text/plain; charset=utf-8')
  verify(@Query() query: Record<string, string | undefined>) {
    return this.notices.verify(query);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  receive(@Req() req: Request & { rawBody?: Buffer }) {
    return this.notices.receive(req.rawBody, req.get('x-hub-signature-256'));
  }
}

class CountryDto {
  @IsString() @Matches(/^[A-Za-z]{2}$/)
  country: string;
}

/** Public: whether WhatsApp and wanted requests are open in a market (udozo.com's links and pages). */
@ApiExcludeController()
@Public()
@Controller('classifieds/channels')
@ProductOnly('udozo')
export class ClassifiedChannelsController {
  constructor(private readonly contacts: WhatsappContactsService) {}

  @Get()
  @Header('cache-control', 'public, max-age=60, s-maxage=60')
  channels(@Query() query: CountryDto) {
    return this.contacts.channels(query.country);
  }
}

class PreferencesDto {
  @IsOptional() @IsBoolean()
  chats?: boolean;

  @IsOptional() @IsBoolean()
  alerts?: boolean;

  /** "Let buyers WhatsApp me directly": Contact seller on Udozo's WhatsApp gives buyers this number. */
  @IsOptional() @IsBoolean()
  direct?: boolean;
}

/** udozo.com's Profile > WhatsApp: connect the customer's number with a one-time code, their choices, disconnect. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('store/account/whatsapp')
@ProductOnly('udozo')
export class WhatsappAccountController {
  constructor(private readonly contacts: WhatsappContactsService) {}

  @Get()
  status(@CurrentCustomer() caller: CustomerCaller) {
    return this.contacts.status(caller.customer);
  }

  /** A one-time code and the wa.me link that sends it from their number (10 minutes). */
  @Post('link')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  link(@CurrentCustomer() caller: CustomerCaller) {
    return this.contacts.startLink(caller.customer);
  }

  @Patch()
  preferences(@CurrentCustomer() caller: CustomerCaller, @Body() body: PreferencesDto) {
    return this.contacts.setPreferences(caller.customer, body);
  }

  @Delete()
  disconnect(@CurrentCustomer() caller: CustomerCaller) {
    return this.contacts.disconnect(caller.customer);
  }
}

class SignInStartDto {
  @IsIn(['signin', 'signup'])
  intent: 'signin' | 'signup';

  /** The market udozo.com shows: WhatsApp must be open there. */
  @IsString() @Matches(/^[A-Za-z]{2}$/)
  country: string;

  /** A campaign's or invite's code, kept on an account made through it. */
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{1,40}$/)
  ref?: string;
}

class SignInFinishDto {
  @IsString() @Length(20, 200)
  token: string;
}

/**
 * udozo.com's "Continue with WhatsApp" (its server only): `start` gives the code to send from WhatsApp (and the wa.me
 * link filling it in) with a token the site keeps for that browser; `finish` brings the token back until the sign-in
 * is approved on WhatsApp, then answers the customer and a session, once. Neither is ever stored for replay.
 */
@ApiExcludeController()
@Public()
@SkipIdempotency()
@Controller('store/account/whatsapp-sign-in')
@ProductOnly('udozo')
export class WhatsappSignInController {
  constructor(private readonly signIns: WhatsappSignIns) {}

  @Post('start')
  @HttpCode(HttpStatus.OK)
  start(@Req() req: Request, @Body() body: SignInStartDto) {
    return this.signIns.start({ intent: body.intent, country: body.country, ref: body.ref ?? null, device: deviceOf(req.headers) });
  }

  @Post('finish')
  @HttpCode(HttpStatus.OK)
  finish(@Body() body: SignInFinishDto) {
    return this.signIns.finish(body.token);
  }
}

class NumberDto {
  @IsString() @Matches(/^\+?[\d\s()-]{8,20}$/)
  phone: string;
}

class SubmitDto {
  @IsOptional() @IsIn(templateNames)
  name?: string;
}

class ReasonDto {
  @IsString() @Length(3, 500)
  reason: string;
}

/** Udozo's admin Site > WhatsApp: the number's health, templates with their approval, the week's messages, contacts. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('operations', 'support')
@Controller('admin/whatsapp')
@ProductOnly('udozo')
export class WhatsappAdminController {
  constructor(private readonly admin: WhatsappAdminService) {}

  @Get()
  overview() {
    return this.admin.overview();
  }

  @Get('templates')
  templates() {
    return this.admin.templates();
  }

  /** Submits the templates Meta does not have yet (or one by name). */
  @Post('templates/submit')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  submit(@CurrentCaller() caller: Caller, @Body() body: SubmitDto) {
    return this.admin.submitTemplates(adminId(caller), body.name);
  }

  @Get('contacts')
  contact(@Query() query: NumberDto) {
    return this.admin.contact(query.phone);
  }

  @Post('contacts/:id/opt-out')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  optOut(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.admin.optOut(adminId(caller), id, body.reason);
  }
}
