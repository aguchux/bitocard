import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { ProductOnly } from '../products/product.js';
import { ConnectCentresService } from './centres.service.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);

class CentreDto {
  @IsOptional() @IsString() @MaxLength(300)
  hours?: string | null;

  @IsOptional() @IsString() @MaxLength(30)
  phone?: string | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000)
  capacity?: number | null;

  @IsOptional() @IsString() @MaxLength(200)
  landmark?: string | null;
}

class PauseDto {
  /** The day to open again (ISO 8601), or empty for until they reopen it. */
  @IsOptional() @IsString() @MaxLength(40)
  until?: string | null;

  @IsOptional() @IsString() @MaxLength(300)
  note?: string | null;
}

class MemberDto {
  @IsEmail() @MaxLength(200)
  email: string;

  @IsIn(['manager', 'staff'])
  role: 'manager' | 'staff';
}

class MemberRoleDto {
  @IsIn(['manager', 'staff'])
  role: 'manager' | 'staff';
}

class ShelfDto {
  @IsOptional() @IsString() @Length(1, 40)
  code?: string;

  @IsOptional() @IsString() @MaxLength(100)
  label?: string | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000)
  capacity?: number | null;

  @IsOptional() @IsBoolean()
  active?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000)
  position?: number;
}

class PublicDto {
  @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country: string;

  @IsOptional() @IsUUID()
  state?: string;
}

class ReasonDto {
  @IsString() @Length(1, 500)
  reason: string;
}

/** A Connect Centre's own people on connect.udozo.com (docs/UDOZO_CONNECT_PLAN.md, phase 3). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('connect/centres')
@ProductOnly('udozo')
export class ConnectCentresController {
  constructor(private readonly centres: ConnectCentresService) {}

  @Get('mine')
  mine(@CurrentCustomer() caller: CustomerCaller) {
    return this.centres.mine(caller.customer);
  }

  @Get(':id')
  get(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.centres.get(caller.customer, id);
  }

  @Patch(':id')
  update(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: CentreDto) {
    return this.centres.update(caller.customer, id, body);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  pause(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: PauseDto) {
    return this.centres.pause(caller.customer, id, body);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  resume(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.centres.resume(caller.customer, id);
  }

  @Get(':id/members')
  members(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.centres.members(caller.customer, id);
  }

  @Post(':id/members')
  addMember(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: MemberDto) {
    return this.centres.addMember(caller.customer, id, body);
  }

  @Patch(':id/members/:member')
  updateMember(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Param('member', ParseUUIDPipe) member: string, @Body() body: MemberRoleDto) {
    return this.centres.updateMember(caller.customer, id, member, body.role);
  }

  @Delete(':id/members/:member')
  removeMember(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Param('member', ParseUUIDPipe) member: string) {
    return this.centres.removeMember(caller.customer, id, member);
  }

  @Get(':id/shelves')
  shelves(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.centres.shelves(caller.customer, id);
  }

  @Post(':id/shelves')
  addShelf(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ShelfDto) {
    return this.centres.addShelf(caller.customer, id, body);
  }

  @Patch(':id/shelves/:shelf')
  updateShelf(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Param('shelf', ParseUUIDPipe) shelf: string, @Body() body: ShelfDto) {
    return this.centres.updateShelf(caller.customer, id, shelf, body);
  }
}

/** Active Connect Centres by market and state, for buyers and sellers (udozo.com's Connect Centres page). */
@ApiExcludeController()
@Public()
@Controller('connect')
@ProductOnly('udozo')
export class PublicConnectCentresController {
  constructor(private readonly centres: ConnectCentresService) {}

  @Get('centres')
  list(@Query() query: PublicDto, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'public, max-age=60');
    return this.centres.publicList(query.country, query.state);
  }
}

/** Udozo's team: one centre, its people and storage places, and pausing, reinstating or closing it. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations', 'finance')
@Controller('admin/connect/centres')
@ProductOnly('udozo')
export class AdminConnectCentresController {
  constructor(private readonly centres: ConnectCentresService) {}

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.centres.adminGet(id);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  pause(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.centres.adminStatus(adminId(caller), id, 'pause', body.reason);
  }

  @Post(':id/reinstate')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  reinstate(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.centres.adminStatus(adminId(caller), id, 'reinstate', body.reason);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  close(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.centres.adminStatus(adminId(caller), id, 'close', body.reason);
  }
}
