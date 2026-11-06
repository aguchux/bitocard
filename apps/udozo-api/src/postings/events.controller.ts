import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Public } from '../auth/caller.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { ProductOnly } from '../products/product.js';
import { deviceOf } from '../signups/journeys.service.js';
import { type ClientEventType, clientEventTypes, PostingJourneysService, type PostStepKey, postStepKeys, type SellSource, sellSources, type WizardParam, wizardParams } from './journeys.service.js';

/** A step of Post an ad's wizard: closed lists only, so nothing a seller typed can be sent (unknown fields are refused). */
class PostingEventDto {
  @IsIn(clientEventTypes)
  type: ClientEventType;

  @IsOptional() @IsUUID()
  listing_id?: string;

  @IsOptional() @IsIn(postStepKeys)
  step?: PostStepKey;

  @IsOptional() @IsIn(wizardParams)
  param?: WizardParam;

  @IsOptional() @IsIn(sellSources)
  source?: SellSource;
}

/** udozo.com's Post an ad tells the API the step a signed-in seller reached or could not leave (never what they typed). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@ProductOnly('udozo')
@Controller('classifieds/posting-journeys')
export class PostingEventsController {
  constructor(private readonly journeys: PostingJourneysService) {}

  @SkipIdempotency()
  @Post('events')
  @HttpCode(HttpStatus.OK)
  event(@CurrentCustomer() caller: CustomerCaller, @Body() body: PostingEventDto, @Req() req: Request) {
    this.journeys.client({ id: caller.customer.id, country: caller.customer.country ?? null }, body, deviceOf(req.headers));
    return { object: 'notice' as const, message: 'Noted.' };
  }
}

