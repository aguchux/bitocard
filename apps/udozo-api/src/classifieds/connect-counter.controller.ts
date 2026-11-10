import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { Public } from '../auth/caller.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { ProductOnly } from '../products/product.js';
import { type CheckInRefusal, checkInRefusals, ConnectCounterService, type CounterView, counterViews } from './connect-counter.service.js';

class ViewDto {
  @IsOptional() @IsIn(Object.keys(counterViews))
  view?: CounterView;
}

class LookupDto {
  @IsString() @Length(1, 20)
  number: string;
}

class NoteDto {
  @IsOptional() @IsString() @MaxLength(300)
  note?: string | null;
}

class RefuseDto extends NoteDto {
  @IsIn(Object.keys(checkInRefusals))
  reason: CheckInRefusal;
}

class ShelveDto {
  @IsUUID()
  shelf_id: string;
}

class CodeDto {
  @Matches(/^\s*\d{6}\s*$/)
  code: string;
}

class ReasonDto {
  @IsString() @Length(1, 300)
  reason: string;
}

class UpdateDto {
  @IsString() @Length(1, 300)
  body: string;
}

/** A Connect Centre's counter on connect.udozo.com: the orders coming to it and at it (docs/UDOZO_CONNECT_PLAN.md, phase 5). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('connect/centres/:centre/orders')
@ProductOnly('udozo')
export class ConnectCounterController {
  constructor(private readonly counter: ConnectCounterService) {}

  @Get()
  list(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Query() query: ViewDto) {
    return this.counter.list(caller.customer, centre, query.view ?? 'expected');
  }

  @Get('lookup')
  lookup(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Query() query: LookupDto) {
    return this.counter.lookup(caller.customer, centre, query.number);
  }

  @Get(':order')
  get(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Param('order', ParseUUIDPipe) order: string) {
    return this.counter.get(caller.customer, centre, order);
  }

  @Post(':order/receive')
  @HttpCode(HttpStatus.OK)
  receive(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Param('order', ParseUUIDPipe) order: string, @Body() body: NoteDto) {
    return this.counter.receive(caller.customer, centre, order, body);
  }

  @Post(':order/refuse')
  @HttpCode(HttpStatus.OK)
  refuse(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Param('order', ParseUUIDPipe) order: string, @Body() body: RefuseDto) {
    return this.counter.refuse(caller.customer, centre, order, body);
  }

  @Post(':order/shelve')
  @HttpCode(HttpStatus.OK)
  shelve(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Param('order', ParseUUIDPipe) order: string, @Body() body: ShelveDto) {
    return this.counter.shelve(caller.customer, centre, order, body);
  }

  /** The buyer's release code: never stored for replay (each try counts). */
  @Post(':order/release')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  release(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Param('order', ParseUUIDPipe) order: string, @Body() body: CodeDto) {
    return this.counter.release(caller.customer, centre, order, body);
  }

  @Post(':order/refuse-collection')
  @HttpCode(HttpStatus.OK)
  refuseCollection(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Param('order', ParseUUIDPipe) order: string, @Body() body: ReasonDto) {
    return this.counter.refuseCollection(caller.customer, centre, order, body);
  }

  @Post(':order/updates')
  @HttpCode(HttpStatus.OK)
  update(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Param('order', ParseUUIDPipe) order: string, @Body() body: UpdateDto) {
    return this.counter.note(caller.customer, centre, order, body);
  }
}
