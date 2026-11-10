import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, StepUp } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { ProductOnly } from '../products/product.js';
import { ConnectAuctionClaimsService } from './connect-auction-claims.service.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);

class FileDto {
  @IsOptional() @IsString() @MaxLength(500)
  note?: string | null;
}

class PayDto {
  @IsOptional() @IsString() @MaxLength(500)
  note?: string | null;
}

class RejectDto {
  @IsString() @MinLength(3) @MaxLength(500)
  reason: string;
}

class ListDto {
  @IsOptional() @IsIn(['requested', 'paid', 'rejected'])
  status?: string;

  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;
}

/** The seller claims, from their order, what the auction of their abandoned item left over. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('classifieds/orders/:id')
@ProductOnly('udozo')
export class SellerAuctionClaimsController {
  constructor(private readonly claims: ConnectAuctionClaimsService) {}

  @Post('auction-claim')
  file(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: FileDto) {
    return this.claims.file(caller.customer, id, body.note);
  }
}

/** Finance checks sellers' claims and pays or rejects them; operations and support read. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('finance', 'operations', 'support')
@Controller('admin/connect/claims')
@ProductOnly('udozo')
export class AdminAuctionClaimsController {
  constructor(private readonly claims: ConnectAuctionClaimsService) {}

  @Get()
  list(@Query() query: ListDto) {
    return this.claims.list(query);
  }

  /** Money out of what the sale holds: after the admin's authenticator code (the step-up window). */
  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('finance')
  @StepUp()
  pay(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: PayDto) {
    return this.claims.pay(adminId(caller), id, body.note);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('finance')
  reject(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: RejectDto) {
    return this.claims.reject(adminId(caller), id, body.reason);
  }
}
