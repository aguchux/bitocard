import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { Public } from '../auth/caller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { ProductOnly } from '../products/product.js';
import { levelOf } from './permissions.js';
import { CurrentStaff, PosAllows, PosGuard } from './pos.guard.js';
import { type ReportPeriod, reportPeriods, PosReportsService } from './reports.service.js';
import { PosShiftsService, type ShiftScope } from './shifts.service.js';
import type { PosStaffContext } from './staff.service.js';

const day = /^\d{4}-\d{2}-\d{2}$/;

class ShiftsDto {
  @IsOptional() @IsUUID()
  shop?: string;

  @IsOptional() @IsUUID()
  till?: string;

  @IsOptional() @IsIn(['open', 'closed'])
  status?: 'open' | 'closed';

  @IsOptional() @IsString() @MaxLength(40)
  from?: string;

  @IsOptional() @IsString() @MaxLength(40)
  to?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

class CurrentShiftDto {
  @IsUUID()
  till_id: string;
}

class OpenShiftDto {
  @IsUUID()
  till_id: string;

  /** The cash in the drawer as the shift opens, in minor units. */
  @IsOptional() @IsInt() @Min(0)
  opening_float?: number;

  @IsOptional() @IsString() @MaxLength(300)
  note?: string | null;
}

class ShiftCashDto {
  @IsIn(['in', 'out'])
  kind: 'in' | 'out';

  @IsInt() @Min(1)
  amount: number;

  @IsString() @MaxLength(200)
  reason: string;
}

class CloseShiftDto {
  /** The cash counted in the drawer, in minor units. */
  @IsInt() @Min(0)
  counted: number;

  @IsOptional() @IsString() @MaxLength(300)
  note?: string | null;
}

class OverviewDto {
  @IsOptional() @IsIn(reportPeriods)
  period?: ReportPeriod;

  @IsOptional() @Matches(day)
  from?: string;

  @IsOptional() @Matches(day)
  to?: string;

  @IsOptional() @IsUUID()
  shop?: string;
}

class DayDto {
  @IsOptional() @Matches(day)
  date?: string;

  @IsOptional() @IsUUID()
  shop?: string;
}

class ExportDto {
  @Matches(day)
  from: string;

  @Matches(day)
  to: string;

  @IsOptional() @IsUUID()
  shop?: string;

  @IsOptional() @IsIn(['sales', 'lines'])
  detail?: 'sales' | 'lines';
}

/** A report's file: a PDF shown in the browser, a CSV saved; never cached (it carries the shop's sales). */
function sendFile(res: Response, file: { bytes: Buffer; name: string; contentType: string }) {
  res.set({
    'content-type': file.contentType,
    'content-length': String(file.bytes.length),
    'cache-control': 'no-store, private',
    'content-disposition': `${file.contentType.startsWith('text/csv') ? 'attachment' : 'inline'}; filename="${file.name.replace(/[^\w.\- ]/g, '_')}"`,
    'x-content-type-options': 'nosniff',
  });
  res.end(file.bytes);
}

/** The owner's shifts and cash-up, overview, end of day and exports. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('pos/owner')
@ProductOnly('udozo')
export class PosOwnerReportsController {
  constructor(
    private readonly shifts: PosShiftsService,
    private readonly reports: PosReportsService,
  ) {}

  @Get('shifts')
  list(@CurrentCustomer() caller: CustomerCaller, @Query() query: ShiftsDto) {
    return this.shifts.list(caller.customer, query);
  }

  @Get('shifts/current')
  current(@CurrentCustomer() caller: CustomerCaller, @Query() query: CurrentShiftDto) {
    return this.shifts.current(caller.customer, query.till_id);
  }

  @Post('shifts')
  open(@CurrentCustomer() caller: CustomerCaller, @Body() body: OpenShiftDto) {
    return this.shifts.open(caller.customer, body);
  }

  @Get('shifts/:id')
  shift(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.shifts.get(caller.customer, id);
  }

  @Post('shifts/:id/cash')
  @HttpCode(HttpStatus.OK)
  cash(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ShiftCashDto) {
    return this.shifts.cash(caller.customer, id, body);
  }

  @Post('shifts/:id/close')
  @HttpCode(HttpStatus.OK)
  close(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: CloseShiftDto) {
    return this.shifts.close(caller.customer, id, body);
  }

  @Get('reports/overview')
  overview(@CurrentCustomer() caller: CustomerCaller, @Query() query: OverviewDto) {
    return this.reports.overview(caller.customer, query);
  }

  @Get('reports/day')
  day(@CurrentCustomer() caller: CustomerCaller, @Query() query: DayDto) {
    return this.reports.day(caller.customer, query);
  }

  @Get('reports/day.pdf')
  async dayPdf(@CurrentCustomer() caller: CustomerCaller, @Query() query: DayDto, @Res() res: Response) {
    sendFile(res, await this.reports.dayPdf(caller.customer, query));
  }

  @Get('reports/sales.csv')
  async csv(@CurrentCustomer() caller: CustomerCaller, @Query() query: ExportDto, @Res() res: Response) {
    sendFile(res, await this.reports.csv(caller.customer, query));
  }

  @Get('reports/summary.pdf')
  async summary(@CurrentCustomer() caller: CustomerCaller, @Query() query: ExportDto, @Res() res: Response) {
    sendFile(res, await this.reports.summaryPdf(caller.customer, query));
  }
}

/** The tills a member of staff works at: a linked device's alone, else theirs (every till: no limit). */
const tillsOf = (context: PosStaffContext): ShiftScope => (context.tillId ? { tills: [context.tillId] } : context.tills === 'all' ? {} : { tills: context.tills });
/** Staff without `cash_up` count blind: never what the drawer should hold. */
const viewOf = (context: PosStaffContext) => ({ scope: tillsOf(context), blind: levelOf(context.role, 'cash_up') !== 'yes', by: context.by });

/**
 * Staff's shifts and reports: opening, paying in and out and closing a shift at their tills (`till`, counting blind
 * without `cash_up`), the overview (`all_sales`), end of day (`cash_up`) and exports (`export`).
 */
@ApiExcludeController()
@Public()
@UseGuards(PosGuard)
@Controller('pos/staff')
@ProductOnly('udozo')
export class PosStaffReportsController {
  constructor(
    private readonly shifts: PosShiftsService,
    private readonly reports: PosReportsService,
  ) {}

  @Get('shifts')
  @PosAllows(['till', 'cash_up'])
  list(@CurrentStaff() context: PosStaffContext, @Query() query: ShiftsDto) {
    return this.shifts.list(context.owner, query, viewOf(context));
  }

  @Get('shifts/current')
  @PosAllows(['till', 'cash_up'])
  current(@CurrentStaff() context: PosStaffContext, @Query() query: CurrentShiftDto) {
    return this.shifts.current(context.owner, query.till_id, viewOf(context));
  }

  @Post('shifts')
  @PosAllows('till')
  open(@CurrentStaff() context: PosStaffContext, @Body() body: OpenShiftDto) {
    return this.shifts.open(context.owner, body, viewOf(context));
  }

  @Get('shifts/:id')
  @PosAllows(['till', 'cash_up'])
  shift(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.shifts.get(context.owner, id, viewOf(context));
  }

  @Post('shifts/:id/cash')
  @HttpCode(HttpStatus.OK)
  @PosAllows('till')
  cash(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ShiftCashDto) {
    return this.shifts.cash(context.owner, id, body, viewOf(context));
  }

  @Post('shifts/:id/close')
  @HttpCode(HttpStatus.OK)
  @PosAllows('till')
  close(@CurrentStaff() context: PosStaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: CloseShiftDto) {
    return this.shifts.close(context.owner, id, body, viewOf(context));
  }

  @Get('reports/overview')
  @PosAllows('all_sales')
  overview(@CurrentStaff() context: PosStaffContext, @Query() query: OverviewDto) {
    return this.reports.overview(context.owner, query);
  }

  @Get('reports/day')
  @PosAllows('cash_up')
  day(@CurrentStaff() context: PosStaffContext, @Query() query: DayDto) {
    return this.reports.day(context.owner, query);
  }

  @Get('reports/day.pdf')
  @PosAllows('cash_up')
  async dayPdf(@CurrentStaff() context: PosStaffContext, @Query() query: DayDto, @Res() res: Response) {
    sendFile(res, await this.reports.dayPdf(context.owner, query));
  }

  @Get('reports/sales.csv')
  @PosAllows('export')
  async csv(@CurrentStaff() context: PosStaffContext, @Query() query: ExportDto, @Res() res: Response) {
    sendFile(res, await this.reports.csv(context.owner, query));
  }

  @Get('reports/summary.pdf')
  @PosAllows('export')
  async summary(@CurrentStaff() context: PosStaffContext, @Query() query: ExportDto, @Res() res: Response) {
    sendFile(res, await this.reports.summaryPdf(context.owner, query));
  }
}
