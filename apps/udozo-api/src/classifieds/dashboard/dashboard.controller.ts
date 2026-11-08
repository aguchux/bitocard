import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import type { Response } from 'express';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../../auth/caller.js';
import { adminId } from '../../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../../customers/customer-session.js';
import { ProductOnly } from '../../products/product.js';
import { type BoardTone, boardTones, BoardService } from './board.service.js';
import { type DashboardPeriod, dashboardPeriods, DashboardService } from './dashboard.service.js';

class DashboardQueryDto {
  @IsOptional() @Type(() => Number) @IsIn(dashboardPeriods) days?: DashboardPeriod;
}

class BoardListQueryDto {
  @IsOptional() @IsString() @Matches(/^(global|[A-Za-z]{2})$/) country?: string;
}

class BoardPostDto {
  /** A market's code, or null for every market. */
  @ValidateIf((_object, value) => value !== null) @IsOptional() @IsString() @Matches(/^[A-Za-z]{2}$/) country?: string | null;
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) body?: string;
  @IsOptional() @IsIn(boardTones) tone?: BoardTone;
  @ValidateIf((_object, value) => value !== null) @IsOptional() @IsString() @MaxLength(500) href?: string | null;
  @ValidateIf((_object, value) => value !== null) @IsOptional() @IsString() @MaxLength(80) link_label?: string | null;
  @IsOptional() @IsBoolean() pinned?: boolean;
  /** The gate: off, it never shows. */
  @IsOptional() @IsBoolean() enabled?: boolean;
  @ValidateIf((_object, value) => value !== null) @IsOptional() @IsString() @MaxLength(40) starts_at?: string | null;
  @ValidateIf((_object, value) => value !== null) @IsOptional() @IsString() @MaxLength(40) ends_at?: string | null;
}

/** A udozo.com customer's own dashboard: figures, charts, best listings and Udozo's message board (never cached). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('classifieds/me/dashboard')
@ProductOnly('udozo')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  read(@CurrentCustomer() caller: CustomerCaller, @Query() query: DashboardQueryDto, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    return this.dashboard.forCustomer(caller.customer, query.days ?? 30);
  }
}

/** Admins: the account dashboard's message board (operations write; support reads). */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/classifieds/board')
@ProductOnly('udozo')
export class AdminBoardController {
  constructor(private readonly board: BoardService) {}

  @AdminRoles('operations', 'support')
  @Get()
  list(@Query() query: BoardListQueryDto) {
    return this.board.list(query);
  }

  @AdminRoles('operations')
  @Post()
  create(@CurrentCaller() caller: Caller, @Body() body: BoardPostDto) {
    return this.board.create(adminId(caller), body);
  }

  @AdminRoles('operations')
  @Patch(':id')
  update(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: BoardPostDto) {
    return this.board.update(adminId(caller), id, body);
  }

  @AdminRoles('operations')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.board.remove(adminId(caller), id);
  }
}
