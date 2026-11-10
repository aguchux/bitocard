import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';
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

/** A centre's moves: sending a return on, and checking in what is sent to it. */
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
}
