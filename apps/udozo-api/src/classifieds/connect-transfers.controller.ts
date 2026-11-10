import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { ProductOnly } from '../products/product.js';
import { ConnectTransfersService } from './connect-transfers.service.js';

class ShipDto {
  @IsUUID()
  centre_id!: string;

  /** What the seller was shown, so a changed charge is refused rather than taken. */
  @IsOptional() @IsInt() @Min(0)
  expected_shipping?: number;
}

class LotShipDto {
  @IsUUID()
  centre_id!: string;

  /** The shipping and Connect fee the buyer was shown, so a changed total is refused rather than taken. */
  @IsOptional() @IsInt() @Min(0)
  expected_total?: number;
}

class CodeDto {
  @IsString() @Matches(/^\s*\d(\s*\d){5}\s*$/)
  code!: string;
}

class SendDto {
  @IsString() @MinLength(1) @MaxLength(80)
  courier!: string;

  @IsOptional() @IsString() @MaxLength(80)
  tracking_number?: string | null;
}

class ReceiveDto {
  @IsOptional() @IsUUID()
  shelf_id?: string | null;
}

class ReasonDto {
  @IsString() @MinLength(3) @MaxLength(300)
  reason!: string;
}

class ListDto {
  @IsOptional() @IsIn(['paid', 'sent', 'arrived', 'collected', 'cancelled'])
  status?: string;

  @IsOptional() @IsIn(['return', 'lot'])
  kind?: string;

  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value)) @Matches(/^[A-Z]{2}$/)
  country?: string;
}

/** A seller has their accepted return sent on to a Connect Centre near them. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('classifieds/orders/:id/return')
@ProductOnly('udozo')
export class SellerReturnTransfersController {
  constructor(private readonly transfers: ConnectTransfersService) {}

  @Get('ship-options')
  options(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.returnOptions(caller.customer, id);
  }

  @Post('ship')
  ship(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ShipDto) {
    return this.transfers.shipReturn(caller.customer, id, body);
  }

  @Post('ship/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.cancelReturn(caller.customer, id);
  }
}

/** The buyer of a Udozo auction lot has it sent from Udozo's warehouse to a Connect Centre near them. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('classifieds/auctions/:ref')
@ProductOnly('udozo')
export class LotTransfersController {
  constructor(private readonly transfers: ConnectTransfersService) {}

  @Get('ship-options')
  options(@CurrentCustomer() caller: CustomerCaller, @Param('ref') ref: string) {
    return this.transfers.lotOptions(caller.customer, ref);
  }

  @Post('ship')
  ship(@CurrentCustomer() caller: CustomerCaller, @Param('ref') ref: string, @Body() body: LotShipDto) {
    return this.transfers.shipLot(caller.customer, ref, body);
  }

  @Post('ship/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentCustomer() caller: CustomerCaller, @Param('ref') ref: string) {
    return this.transfers.cancelLot(caller.customer, ref);
  }
}

/** A centre's moves: sending a return on, checking in what is sent to it, and handing a lot to its buyer. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('connect/centres/:centre/transfers')
@ProductOnly('udozo')
export class ConnectCentreTransfersController {
  constructor(private readonly transfers: ConnectTransfersService) {}

  @Get()
  list(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string) {
    return this.transfers.forCentre(caller.customer, centre);
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  send(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: SendDto) {
    return this.transfers.send(caller.customer, centre, id, body);
  }

  /** The buyer's collection code: never stored for replay (each try counts). */
  @Post(':id/hand-over')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  handOver(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: CodeDto) {
    return this.transfers.handOverLot(caller.customer, centre, id, body);
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  receive(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReceiveDto) {
    return this.transfers.receive(caller.customer, centre, id, body);
  }
}

/** Udozo's team: every move between Connect places, and cancelling one not yet sent. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations', 'finance')
@Controller('admin/connect/transfers')
@ProductOnly('udozo')
export class AdminTransfersController {
  constructor(private readonly transfers: ConnectTransfersService) {}

  @Get()
  list(@Query() query: ListDto) {
    return this.transfers.forAdmin(query);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  cancel(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.transfers.adminCancel(adminId(caller), id, body.reason);
  }

  /** Sends a lot from Udozo's warehouse to the centre its buyer chose. */
  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  send(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SendDto) {
    return this.transfers.sendLot(adminId(caller), id, body);
  }
}
