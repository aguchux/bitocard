import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import type { Response } from 'express';
import { type Caller, CurrentCaller, resellerOf, Roles, SessionOnly } from '../auth/caller.js';
import { toCsv } from '../common/csv.js';
import { Mode } from '../ledger/mode.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { maxDailyRangeDays, reportRange, statementTooLarge } from './range.js';
import { type ResellerReportMetric, ResellerReportsService } from './reseller-reports.service.js';
import { ResaleReportsService } from './resale-reports.service.js';
import { statementPdf } from './statement-pdf.js';
import { ProductOnly } from '../products/product.js';

/** A PDF of more lines than this is refused (download the CSV, or choose a shorter period). */
const pdfMaxRows = 5_000;

class RangeDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  @IsOptional() @Matches(/^[A-Z]{3}$/i)
  currency?: string;
}

class ResaleDto extends RangeDto {
  @IsOptional() @IsUUID()
  store_id?: string;
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
  constructor(
    private readonly reports: ResellerReportsService,
    private readonly resale: ResaleReportsService,
  ) {}

  /** Resale orders on the reseller's Resale shops: by state, and the sales, margin, fee and earnings released in the period. */
  @Get('resale')
  @ProductOnly('udozo')
  resaleReport(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: ResaleDto) {
    return this.resale.reseller({ resellerId: resellerOf(caller), mode, ...reportRange(query.from, query.to), storeId: query.store_id });
  }

  @Get('pnl')
  pnl(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: RangeDto) {
    return this.reports.pnl({ resellerId: resellerOf(caller), mode, ...reportRange(query.from, query.to), currency: query.currency });
  }

  @Get('growth')
  growth(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: GrowthDto) {
    return this.reports.growth({ resellerId: resellerOf(caller), mode, ...reportRange(query.from, query.to, maxDailyRangeDays), metric: query.metric, currency: query.currency });
  }

  @Get('statement')
  statement(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: RangeDto) {
    return this.reports.statement({ resellerId: resellerOf(caller), mode, ...reportRange(query.from, query.to), currency: query.currency });
  }

  @Get('statement.csv')
  async statementCsv(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: RangeDto, @Res() res: Response) {
    const { data, currency } = await this.reports.statement({ resellerId: resellerOf(caller), mode, ...reportRange(query.from, query.to), currency: query.currency });
    const csv = toCsv(
      [
        { key: 'date', header: 'Date' },
        { key: 'reference', header: 'Reference' },
        { key: 'type', header: 'Type' },
        { key: 'description', header: 'Description' },
        { key: 'amount', header: `Amount (${currency})` },
      ],
      data.map(row => ({ date: row.date, reference: row.reference, type: row.type, description: row.description, amount: (row.amount / 100).toFixed(2) })),
    );
    sendFile(res, 'text/csv; charset=utf-8', fileName('statement', query.from, query.to, 'csv'), csv);
  }

  @Get('statement.pdf')
  async statementPdf(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: RangeDto, @Res() res: Response) {
    const resellerId = resellerOf(caller);
    const { from, to } = reportRange(query.from, query.to);
    const [statement, pnl, account] = await Promise.all([
      this.reports.statement({ resellerId, mode, from, to, currency: query.currency }),
      this.reports.pnl({ resellerId, mode, from, to, currency: query.currency }),
      this.reports.accountName(resellerId),
    ]);
    if (statement.data.length > pdfMaxRows) throw statementTooLarge(pdfMaxRows);
    const rows = statement.data.map(row => ({
      date: row.date,
      reference: row.reference,
      type: row.type,
      description: row.description,
      label: row.description,
      currency: statement.currency,
      debit: row.amount < 0 ? -row.amount : null,
      credit: row.amount >= 0 ? row.amount : null,
    }));
    const pdf = await statementPdf({
      title: mode === 'test' ? 'Statement (sandbox)' : 'Statement',
      preparedFor: account,
      from: statement.from,
      to: statement.to,
      currency: pnl.currency,
      rows,
      // A reseller's own lines: what they earned, what it cost them, and what is left. Never BitoCard's cost of sales.
      totals: [
        { label: 'Earnings from sales', value: pnl.revenue },
        { label: 'Expenses', value: -pnl.operating_expenses },
        ...pnl.breakdown.filter(line => line.group === 'adjustment').map(line => ({ label: line.label, value: line.amount })),
        { label: 'Net profit', value: pnl.net_profit, bold: true },
      ],
    });
    sendFile(res, 'application/pdf', fileName('statement', query.from, query.to, 'pdf'), pdf);
  }
}
