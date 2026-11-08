import { Body, Controller, Get, Global, Headers, HttpCode, HttpStatus, Module, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsObject, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import type { Request } from 'express';
import { Public, RealmOnly } from '../auth/caller.js';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { ProductOnly } from '../products/product.js';
import { signatureValid, sourceParams, summaryPeriods, TrafficService } from './traffic.service.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

class VisitDto {
  /** The landing page's path, without its query. */
  @IsString() @MaxLength(500) @Matches(/^\//) path: string;
  /** The landing address's query parameters (only the source ones are read). */
  @IsOptional() @IsObject() params?: Record<string, unknown>;
  @ValidateIf((_object, value) => value !== null) @IsOptional() @IsString() @MaxLength(1000) referrer?: string | null;
  @IsString() @MaxLength(500) user_agent: string;
}

class AttributionDto {
  @IsString() @MaxLength(500) @Matches(/^\//) path: string;
  @IsOptional() @IsObject() params?: Record<string, unknown>;
  @ValidateIf((_object, value) => value !== null) @IsOptional() @IsString() @MaxLength(1000) referrer?: string | null;
}

class SummaryDto {
  @IsOptional() @Type(() => Number) @IsIn(summaryPeriods) days?: number;
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/) country?: string;
}

/**
 * A landing on udozo.com, from its server only (`Udozo-Traffic-Signature` over the body with `STORE_SERVER_SECRET`):
 * anything unsigned or wrongly signed is accepted and ignored, so nobody else can count visits or learn why.
 */
@ApiExcludeController()
@Public()
@ProductOnly('udozo')
@Controller('traffic')
export class TrafficVisitsController {
  constructor(private readonly traffic: TrafficService) {}

  @SkipIdempotency()
  @Post('visits')
  @HttpCode(HttpStatus.NO_CONTENT)
  async visit(@Req() req: Request & { rawBody?: Buffer }, @Headers('udozo-traffic-signature') signature: string | undefined, @Body() body: VisitDto) {
    if (!signatureValid(signature, req.rawBody, this.traffic.secret)) return;
    await this.traffic.recordVisit({ path: body.path, params: sourceParams(body.params), referrer: body.referrer ?? null, userAgent: body.user_agent });
  }
}

/** A new account credited to the visit that led to it (udozo.com's server, with the visitor's consent). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@ProductOnly('udozo')
@Controller('store/account/attribution')
export class AttributionController {
  constructor(private readonly traffic: TrafficService) {}

  @SkipIdempotency()
  @Post()
  @HttpCode(HttpStatus.OK)
  attribute(@CurrentCustomer() caller: CustomerCaller, @Body() body: AttributionDto) {
    return this.traffic.attribute(caller.customer, { path: body.path, params: sourceParams(body.params), referrer: body.referrer ?? null });
  }
}

/** Reports > Traffic sources in Udozo's admin: every admin role reads it (marketing uses it). */
@ApiExcludeController()
@RealmOnly('admin')
@ProductOnly('udozo')
@Controller('admin/traffic')
export class AdminTrafficController {
  constructor(private readonly traffic: TrafficService) {}

  @Get('summary')
  summary(@Query() query: SummaryDto) {
    return this.traffic.summary({ days: query.days ?? 30, country: query.country });
  }
}

/** Global: the daily `marketing` job purges old totals. */
@Global()
@Module({
  imports: [CheckoutModule],
  controllers: [TrafficVisitsController, AttributionController, AdminTrafficController],
  providers: [TrafficService, CustomerGuard],
  exports: [TrafficService],
})
export class TrafficModule {}
