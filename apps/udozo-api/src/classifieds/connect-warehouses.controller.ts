import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { adminId } from '../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';

import { maxDocumentBytes } from '../kyc/files.js';
import { ProductOnly } from '../products/product.js';
import type { Response } from 'express';
import { sendPhoto } from './chat-files.js';
import type { MediaUpload } from './media.service.js';
import { invalid } from './rules.js';
import { ConnectReturnsService } from './connect-returns.service.js';
import { ConnectWarehousesService } from './connect-warehouses.service.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);

class WarehouseDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional() @IsUUID()
  state_id?: string;

  @IsOptional() @IsString() @MaxLength(120)
  name?: string;

  @IsOptional() @IsString() @MaxLength(300)
  address?: string;

  @IsOptional() @IsString() @MaxLength(120)
  hours?: string;

  @IsOptional() @IsString() @MaxLength(40)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(120)
  contact_name?: string | null;

  @IsOptional() @IsBoolean()
  active?: boolean;
}

class FraDto {
  @IsOptional() @IsUUID()
  warehouse_id?: string | null;
}

class ScheduleDto {
  @IsUUID()
  centre_id: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  day: string;

  @IsString() @MaxLength(120)
  collector: string;

  @IsOptional() @IsString() @MaxLength(300)
  note?: string | null;
}

class ReasonDto {
  @IsString() @MaxLength(300)
  reason: string;
}

class ReceiveDto {
  @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true })
  order_ids: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true })
  missing?: string[];
}

class HandOverDto {
  @Matches(/^\s*\d{6}\s*$/)
  code: string;

  @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true })
  order_ids: string[];
}

class CodeDto {
  @Matches(/^\s*\d{6}\s*$/)
  code: string;
}

class ListDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional() @IsIn(['scheduled', 'collected', 'delivered', 'cancelled'])
  status?: string;

  @IsOptional() @IsUUID()
  warehouse_id?: string;
}

/** Udozo's team: warehouses, centres' Final Return Addresses, pickups of abandoned items, and handing them back at the warehouse. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations')
@Controller('admin/connect')
@ProductOnly('udozo')
export class AdminWarehousesController {
  constructor(
    private readonly warehouses: ConnectWarehousesService,
    private readonly returns: ConnectReturnsService,
  ) {}

  @Get('warehouses')
  list(@Query() query: ListDto) {
    return this.warehouses.warehouses(query.country);
  }

  @Post('warehouses')
  @AdminRoles('operations')
  create(@CurrentCaller() caller: Caller, @Body() body: WarehouseDto) {
    return this.warehouses.createWarehouse(adminId(caller), body);
  }

  @Patch('warehouses/:id')
  @AdminRoles('operations')
  update(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: WarehouseDto) {
    return this.warehouses.updateWarehouse(adminId(caller), id, body);
  }

  @Get('centres/:id/final-return-address')
  fra(@Param('id', ParseUUIDPipe) id: string) {
    return this.warehouses.fraOf(id);
  }

  @Put('centres/:id/final-return-address')
  @AdminRoles('operations')
  setFra(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: FraDto) {
    return this.warehouses.setFra(adminId(caller), id, body.warehouse_id ?? null);
  }

  @Get('pickups/awaiting')
  awaiting(@Query() query: ListDto) {
    return this.warehouses.awaiting(query.country);
  }

  @Get('pickups')
  pickups(@Query() query: ListDto) {
    return this.warehouses.pickups(query);
  }

  @Get('pickups/:id')
  pickup(@Param('id', ParseUUIDPipe) id: string) {
    return this.warehouses.pickup(id);
  }

  /** A check-out photo the centre took at the hand-over (audited). */
  @Get('pickups/:id/photos/:photo')
  async photo(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Param('photo', ParseUUIDPipe) photo: string, @Res() res: Response) {
    sendPhoto(res, await this.warehouses.adminPhoto(adminId(caller), id, photo));
  }

  @Post('pickups')
  @AdminRoles('operations')
  schedule(@CurrentCaller() caller: Caller, @Body() body: ScheduleDto) {
    return this.warehouses.schedule(adminId(caller), body);
  }

  @Post('pickups/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  cancel(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.warehouses.cancel(adminId(caller), id, body.reason);
  }

  @Post('pickups/:id/receive')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  receive(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReceiveDto) {
    return this.warehouses.receive(adminId(caller), id, body);
  }

  @Get('warehouse-items')
  items(@Query() query: ListDto) {
    return this.warehouses.warehouseItems(query.warehouse_id);
  }

  /** The seller's return code: never stored for replay (each try counts). */
  @Post('returns/:id/hand-back')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  @SkipIdempotency()
  handBack(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: CodeDto) {
    return this.returns.handBackAtWarehouse(adminId(caller), id, body);
  }
}

/** A centre's side of pickups: what Udozo collects, and handing it over against the collector's code. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('connect/centres/:centre/pickups')
@ProductOnly('udozo')
export class ConnectCentrePickupsController {
  constructor(private readonly warehouses: ConnectWarehousesService) {}

  @Get()
  list(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string) {
    return this.warehouses.centrePickups(caller.customer, centre);
  }

  /** A check-out photo of what is handed over: multipart `file`, JPEG or PNG up to 4 MB. */
  @Post(':id/photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: maxDocumentBytes + 1, files: 1, fields: 1 } }))
  addPhoto(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: MediaUpload) {
    if (!file) throw invalid('parameter_missing', 'Choose a photo.', 'file');
    return this.warehouses.addPhoto(caller.customer, centre, id, file);
  }

  @Delete(':id/photos/:photo')
  removePhoto(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Param('id', ParseUUIDPipe) id: string, @Param('photo', ParseUUIDPipe) photo: string) {
    return this.warehouses.removePhoto(caller.customer, centre, id, photo);
  }

  @Get(':id/photos/:photo')
  async photo(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Param('id', ParseUUIDPipe) id: string, @Param('photo', ParseUUIDPipe) photo: string, @Res() res: Response) {
    sendPhoto(res, await this.warehouses.centrePhoto(caller.customer, centre, id, photo));
  }

  /** The collector's pickup code: never stored for replay (each try counts). */
  @Post(':id/hand-over')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  handOver(@CurrentCustomer() caller: CustomerCaller, @Param('centre', ParseUUIDPipe) centre: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: HandOverDto) {
    return this.warehouses.handOver(caller.customer, centre, id, body);
  }
}
