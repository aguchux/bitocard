import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, Matches } from 'class-validator';
import type { Response } from 'express';
import { AdminRoles, RealmOnly } from '../auth/caller.js';
import { toCsv } from '../common/csv.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { type ReportMetric, ReportsService } from './reports.service.js';
import { statementPdf } from './statement-pdf.js';

class RangeDto {
  @IsIn(['test', 'live'])
  mode: LedgerMode;

  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  @IsOptional() @Matches(/^[A-Z]{3}$/)
  currency?: string;
}

class GrowthDto extends RangeDto {
  @IsIn(['gross_sales', 'orders', 'platform_revenue', 'new_resellers'])
  metric: ReportMetric;
}

const fileName = (kind: string, from: string, to: string, ext: string) => `bitocard-${kind}-${from.slice(0, 10)}-${to.slice(0, 10)}.${ext}`;

function sendFile(res: Response, contentType: string, name: string, body: string | Buffer) {
  res.set({
    'content-type': contentType,
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store, private',
    'content-disposition': `attachment; filename="${name}"`,
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

/** Platform-wide P&L, growth and statement exports. Admin only; never in the public API description. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('finance', 'operations')
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('pnl')
  pnl(@Query() query: RangeDto) {
    return this.reports.pnl({ mode: query.mode, from: new Date(query.from), to: new Date(query.to), currency: query.currency });
  }

  @Get('growth')
  growth(@Query() query: GrowthDto) {
    return this.reports.growth({ mode: query.mode, from: new Date(query.from), to: new Date(query.to), metric: query.metric });
  }

  @Get('statement')
  statement(@Query() query: RangeDto) {
    return this.reports.statement({ mode: query.mode, from: new Date(query.from), to: new Date(query.to), currency: query.currency });
  }

  @Get('statement.csv')
  async statementCsv(@Query() query: RangeDto, @Res() res: Response) {
    const { data } = await this.reports.statement({ mode: query.mode, from: new Date(query.from), to: new Date(query.to), currency: query.currency });
    const csv = toCsv(
      [
        { key: 'date', header: 'Date' },
        { key: 'reference', header: 'Reference' },
        { key: 'label', header: 'Account' },
        { key: 'description', header: 'Description' },
        { key: 'currency', header: 'Currency' },
        { key: 'debit', header: 'Debit' },
        { key: 'credit', header: 'Credit' },
      ],
      data.map(row => ({ ...row, debit: row.debit === null ? null : (row.debit / 100).toFixed(2), credit: row.credit === null ? null : (row.credit / 100).toFixed(2) })),
    );
    sendFile(res, 'text/csv; charset=utf-8', fileName('statement', query.from, query.to, 'csv'), csv);
  }

  @Get('statement.pdf')
  async statementPdf(@Query() query: RangeDto, @Res() res: Response) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    const [statement, pnl] = await Promise.all([
      this.reports.statement({ mode: query.mode, from, to, currency: query.currency }),
      this.reports.pnl({ mode: query.mode, from, to, currency: query.currency }),
    ]);
    const pdf = await statementPdf({ title: 'Statement', from: statement.from, to: statement.to, currency: pnl.currency, rows: statement.data, totals: pnl });
    sendFile(res, 'application/pdf', fileName('statement', query.from, query.to, 'pdf'), pdf);
  }
}
