import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { adminId } from '../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { ProductOnly } from '../products/product.js';
import { type ReturnReason, returnReasons, ConnectReturnsService } from './connect-returns.service.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);
const statuses = ['requested', 'accepted', 'collected', 'cancelled'] as const;

class RequestDto {
  @IsIn(returnReasons)
  reason: ReturnReason;

  @IsOptional() @IsString() @MaxLength(300)
  note?: string | null;
}

class CodeDto {
  @Matches(/^\s*\d{6}\s*$/)
  code: string;
}

class StatusDto {
  @IsOptional() @IsIn(statuses)
  status?: (typeof statuses)[number];
}

class AdminListDto extends StatusDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;
}

/** A Connect Centre's returns to sellers: asking for one, the list, and handing an item back against the return code. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('connect/centres/:centre')
@ProductOnly('udozo')
export class ConnectCentreReturnsController {
  constructor(private readonly returns: ConnectReturnsService) {}

  @Post('orders/:order/return')
  request(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Param('order', ParseUUIDPipe) order: string, @Body() body: RequestDto) {
    return this.returns.request(caller.customer, centre, order, body);
  }

  @Get('returns')
  list(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Query() query: StatusDto) {
    return this.returns.forCentre(caller.customer, centre, query.status);
  }

  /** The seller's return code: never stored for replay (each try counts). */
  @Post('returns/:id/hand-back')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  handBack(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: CodeDto) {
    return this.returns.handBack(caller.customer, centre, id, body);
  }
}

/** The seller's side of a return: accepting it, and their return code. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('classifieds/orders/:id')
@ProductOnly('udozo')
export class SellerReturnsController {
  constructor(private readonly returns: ConnectReturnsService) {}

  @Post('return/accept')
  @HttpCode(HttpStatus.OK)
  accept(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.returns.accept(caller.customer, id);
  }

  @Get('return-code')
  @Header('Cache-Control', 'no-store')
  code(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.returns.returnCode(caller.customer, id);
  }
}

/** Udozo's team: every return to sellers, and approving one at any time. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations')
@Controller('admin/connect/returns')
@ProductOnly('udozo')
export class AdminReturnsController {
  constructor(private readonly returns: ConnectReturnsService) {}

  @Get()
  list(@Query() query: AdminListDto) {
    return this.returns.forAdmin(query);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  approve(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.returns.approve(adminId(caller), id);
  }
}
