import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Allow, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Public } from '../auth/caller.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { ProductOnly } from '../products/product.js';
import { CallsService, type SignalInput } from './calls.service.js';
import { ContactRequestsService, type ContactKind, maxNote } from './contact.service.js';
import { invalid } from './rules.js';

const answers = ['accept', 'decline', 'done', 'dismiss', 'cancel'] as const;
type Answer = (typeof answers)[number];

class RequestNoteDto {
  @IsOptional() @IsString() @MaxLength(maxNote)
  note?: string;
}

class RequestsQueryDto {
  @IsOptional() @IsIn(['contact', 'callback'])
  kind?: ContactKind;

  @IsOptional() @IsIn(['pending', 'accepted', 'declined', 'done', 'dismissed', 'cancelled'])
  status?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}

class CallPollDto {
  @IsOptional() @Matches(/^\d{1,18}$/)
  after?: string;
}

class SignalDto {
  @IsIn(['offer', 'answer', 'candidate'])
  kind: SignalInput['kind'];

  /** Checked field by field by the service. */
  @Allow()
  payload: unknown;
}

/**
 * Getting in touch with a seller without their details on the page: Request contact (shared once the seller accepts),
 * Request a call back (the buyer's details to the seller), and calls in the browser while both are on udozo.com.
 */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('classifieds')
@ProductOnly('udozo')
export class ClassifiedContactController {
  constructor(
    private readonly contacts: ContactRequestsService,
    private readonly calls: CallsService,
  ) {}

  /** The buyer asks for the seller's contact details (shown on all their listings once the seller accepts). */
  @Post('listings/:id/contact-requests')
  requestContact(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: RequestNoteDto) {
    return this.contacts.requestContact(caller.customer, id, body.note);
  }

  /** The buyer asks the seller to call them back: their name, confirmed mobile and email go to the seller. */
  @Post('listings/:id/callbacks')
  requestCallback(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: RequestNoteDto) {
    return this.contacts.requestCallback(caller.customer, id, body.note);
  }

  /** The seller's requests (contact requests and call backs), with how many wait. */
  @Get('me/contact-requests')
  incoming(@CurrentCustomer() caller: CustomerCaller, @Query() query: RequestsQueryDto) {
    return this.contacts.incoming(caller.customer, query);
  }

  /** The seller accepts or declines; marks a call back done or dismisses it; the buyer cancels their own. */
  @Post('contact-requests/:id/:action')
  @HttpCode(HttpStatus.OK)
  answer(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Param('action') action: string) {
    if (!answers.includes(action as Answer)) throw invalid('parameter_invalid', 'Accept, decline, done, dismiss or cancel.', 'action');
    return this.contacts.answer(caller.customer, id, action as Answer);
  }

  /** The buyers the seller's details are shared with. */
  @Get('me/contact-shares')
  shares(@CurrentCustomer() caller: CustomerCaller) {
    return this.contacts.shares(caller.customer);
  }

  @Delete('me/contact-shares/:buyer')
  stopSharing(@CurrentCustomer() caller: CustomerCaller, @Param('buyer', ParseUUIDPipe) buyer: string) {
    return this.contacts.stopSharing(caller.customer, buyer);
  }

  /** Every open page says the customer is here, every few seconds, and hears of a call ringing for them. */
  @Post('presence')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  presence(@CurrentCustomer() caller: CustomerCaller) {
    return this.calls.presence(caller.customer);
  }

  /** The buyer calls the seller of a listing (online now); answers the call and the relay's credentials. */
  @Post('listings/:id/calls')
  startCall(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.calls.start(caller.customer, id);
  }

  /** Either side of a chat calls the other (both on udozo.com now). */
  @Post('conversations/:id/calls')
  startChatCall(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.calls.startInChat(caller.customer, id);
  }

  @Get('me/calls')
  recentCalls(@CurrentCustomer() caller: CustomerCaller) {
    return this.calls.recent(caller.customer);
  }

  /** The call and the other side's connection details after `after` (polled while it lasts). */
  @Get('calls/:id')
  call(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Query() query: CallPollDto) {
    return this.calls.get(caller.customer, id, query.after);
  }

  @Post('calls/:id/answer')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  answerCall(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.calls.answer(caller.customer, id);
  }

  @Post('calls/:id/end')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  endCall(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.calls.end(caller.customer, id);
  }

  /** One side's connection detail (offer, answer or candidate), many a second while connecting. */
  @Post('calls/:id/signals')
  @SkipIdempotency()
  signal(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SignalDto) {
    return this.calls.signal(caller.customer, id, body);
  }
}
