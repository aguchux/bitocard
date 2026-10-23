import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, Matches } from 'class-validator';
import type { Response } from 'express';
import { type Caller, CurrentCaller, resellerOf, Roles, SessionOnly } from '../auth/caller.js';
import { toCsv } from '../common/csv.js';
import { Mode } from '../ledger/mode.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { type ResellerReportMetric, ResellerReportsService } from './reseller-reports.service.js';
import { statementPdf } from './statement-pdf.js';

class RangeDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  @IsOptional() @Matches(/^[A-Z]{3}$/i)
  currency?: string;
}

class GrowthDto extends RangeDto {
  @IsIn(['earnings', 'gross_sales', 'orders'])
  metric: ResellerReportMetric;
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

/**
 * A reseller's own earnings, growth and statement exports — built only from their own ledger postings, never
 * BitoCard's supplier costs or another reseller's data. Dashboard only (never an API key); never in the public
 * API description, since file downloads and a dashboard-only report don't fit the documented JSON model.
 */
@ApiExcludeController()
@SessionOnly()
@Roles('admin', 'finance', 'developer')
@Controller('reports')
export class ResellerReportsController {
  constructor(private readonly reports: ResellerReportsService) {}

  @Get('pnl')
  pnl(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: RangeDto) {
    return this.reports.pnl({ resellerId: resellerOf(caller), mode, from: new Date(query.from), to: new Date(query.to), currency: query.currency });
  }

  @Get('growth')
  growth(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: GrowthDto) {
    return this.reports.growth({ resellerId: resellerOf(caller), mode, from: new Date(query.from), to: new Date(query.to), metric: query.metric, currency: query.currency });
  }

  @Get('statement')
  statement(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: RangeDto) {
    return this.reports.statement({ resellerId: resellerOf(caller), mode, from: new Date(query.from), to: new Date(query.to), currency: query.currency });
  }

  @Get('statement.csv')
  async statementCsv(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: RangeDto, @Res() res: Response) {
    const { data, currency } = await this.reports.statement({ resellerId: resellerOf(caller), mode, from: new Date(query.from), to: new Date(query.to), currency: query.currency });
    const csv = toCsv(
      [
        { key: 'date', header: 'Date' },
        { key: 'type', header: 'Type' },
        { key: 'description', header: 'Description' },
        { key: 'amount', header: `Amount (${currency})` },
      ],
      data.map(row => ({ date: row.date, type: row.type, description: row.description, amount: (row.amount / 100).toFixed(2) })),
    );
    sendFile(res, 'text/csv; charset=utf-8', fileName('statement', query.from, query.to, 'csv'), csv);
  }

  @Get('statement.pdf')
  async statementPdf(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: RangeDto, @Res() res: Response) {
    const resellerId = resellerOf(caller);
    const from = new Date(query.from);
    const to = new Date(query.to);
    const [statement, pnl] = await Promise.all([
      this.reports.statement({ resellerId, mode, from, to, currency: query.currency }),
      this.reports.pnl({ resellerId, mode, from, to, currency: query.currency }),
    ]);
    const rows = statement.data.map(row => ({
      date: row.date,
      reference: row.type,
      type: row.type,
      description: row.description,
      label: row.description,
      currency: statement.currency,
      debit: row.amount < 0 ? -row.amount : null,
      credit: row.amount >= 0 ? row.amount : null,
    }));
    const pdf = await statementPdf({
      title: 'Statement',
      from: statement.from,
      to: statement.to,
      currency: pnl.currency,
      rows,
      totals: { revenue: pnl.revenue, cost_of_sales: 0, gross_profit: pnl.revenue, operating_expenses: pnl.operating_expenses, net_profit: pnl.net_profit },
    });
    sendFile(res, 'application/pdf', fileName('statement', query.from, query.to, 'pdf'), pdf);
  }
}
