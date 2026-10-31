import { Controller, Get, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsDateString, IsIn } from 'class-validator';
import { AdminRoles, RealmOnly } from '../auth/caller.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { reportRange } from '../reports/range.js';
import { AfrippaBooksService } from './books.service.js';
import { ProductOnly } from '../products/product.js';

class BooksQueryDto {
  @IsIn(['test', 'live']) mode: LedgerMode;
  @IsDateString() from: string;
  @IsDateString() to: string;
}

/** Afrippa's books for its own admins (admin.afrippa.com): never BitoCard's, and never shown in BitoCard's admin. */
@ApiExcludeController()
@RealmOnly('afrippa_admin')
@AdminRoles('finance', 'operations')
@Controller('afrippa/admin/books')
@ProductOnly('bitocard')
export class AfrippaBooksController {
  constructor(private readonly books: AfrippaBooksService) {}

  @Get()
  read(@Query() query: BooksQueryDto) {
    return this.books.books({ mode: query.mode, ...reportRange(query.from, query.to) });
  }

  /** Every Afrippa account against its postings, and every Afrippa entry balanced. */
  @AdminRoles('finance')
  @Get('check')
  check() {
    return this.books.check();
  }
}
