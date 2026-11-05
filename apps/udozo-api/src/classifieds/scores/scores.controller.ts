import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../../auth/caller.js';
import { adminId } from '../../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../../customers/customer-session.js';
import { ProductOnly } from '../../products/product.js';
import { ListingsService } from '../listings.service.js';
import { SellerScoreReader } from './reader.js';
import { SellerScoresService } from './scores.service.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);

class ReportDto {
  @IsString() @Length(3, 500)
  details: string;
}

class ReasonDto {
  @IsString() @Length(3, 500)
  reason: string;
}

class ReportQueryDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;
}

/** The seller's own scores, numbers and tips (signed in), and saying Anjio's summary of them is wrong. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('classifieds/me/scores')
@ProductOnly('udozo')
export class SellerScoresController {
  constructor(
    private readonly reader: SellerScoreReader,
    private readonly scores: SellerScoresService,
    private readonly listings: ListingsService,
  ) {}

  @Get()
  async mine(@CurrentCustomer() caller: CustomerCaller) {
    const country = await this.listings.sellerCountry(caller.customer);
    return this.reader.forSeller(caller.customer.id, country);
  }

  @Post('summary/report')
  @HttpCode(HttpStatus.OK)
  async report(@CurrentCustomer() caller: CustomerCaller, @Body() body: ReportDto) {
    await this.listings.sellerCountry(caller.customer);
    return this.scores.report(caller.customer.id, body.details);
  }
}

/** Admins: a seller's scores with flags and the summary's cost, Recompute, the summary hidden or written again, the report. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations')
@Controller('admin/classifieds')
@ProductOnly('udozo')
export class AdminSellerScoresController {
  constructor(
    private readonly reader: SellerScoreReader,
    private readonly scores: SellerScoresService,
  ) {}

  @Get('scores/report')
  report(@Query() query: ReportQueryDto) {
    return this.scores.adminReport(query.country);
  }

  @Get('sellers/:customer/scores')
  get(@Param('customer', ParseUUIDPipe) customer: string) {
    return this.reader.forAdmin(customer);
  }

  @Post('sellers/:customer/scores/recompute')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  recompute(@CurrentCaller() caller: Caller, @Param('customer', ParseUUIDPipe) customer: string) {
    return this.scores.recompute(adminId(caller), customer);
  }

  @Post('sellers/:customer/scores/summary/hide')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  hide(@CurrentCaller() caller: Caller, @Param('customer', ParseUUIDPipe) customer: string, @Body() body: ReasonDto) {
    return this.scores.hideSummary(adminId(caller), customer, true, body.reason);
  }

  @Post('sellers/:customer/scores/summary/unhide')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  unhide(@CurrentCaller() caller: Caller, @Param('customer', ParseUUIDPipe) customer: string, @Body() body: ReasonDto) {
    return this.scores.hideSummary(adminId(caller), customer, false, body.reason);
  }

  @Post('sellers/:customer/scores/summary/regenerate')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  regenerate(@CurrentCaller() caller: Caller, @Param('customer', ParseUUIDPipe) customer: string) {
    return this.scores.regenerate(adminId(caller), customer);
  }
}
