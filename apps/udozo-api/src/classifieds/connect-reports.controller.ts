import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches } from 'class-validator';
import { AdminRoles, RealmOnly } from '../auth/caller.js';
import { ProductOnly } from '../products/product.js';
import { ConnectReportsService } from './connect-reports.service.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);

class ReportDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional() @Type(() => Number) @IsInt() @IsIn([7, 30, 90, 365])
  days?: number;
}

/** Udozo's team: Connect's report (every centre's load and record, the money, the sellers and buyers behind problems) and what one centre holds. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations', 'finance')
@Controller('admin/connect')
@ProductOnly('udozo')
export class AdminConnectReportsController {
  constructor(private readonly reports: ConnectReportsService) {}

  @Get('report')
  report(@Query() query: ReportDto) {
    return this.reports.report(query);
  }

  @Get('centres/:id/items')
  items(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.centreItems(id);
  }
}
