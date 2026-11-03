import { Body, Controller, Get, Global, HttpCode, HttpStatus, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { adminId } from '../countries/countries.controller.js';
import { ProductOnly } from '../products/product.js';
import { type JourneyStatus, journeyStatuses, SignupInsightsService, summaryDays } from './insights.service.js';
import { type Milestone, milestones, type SignupSurface, signupSurfaces, SignupJourneysService } from './journeys.service.js';
import { SignupJourneyInterceptor } from './track.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

class VisitDto {
  @IsIn(signupSurfaces)
  surface: SignupSurface;
}

class SummaryDto {
  @IsIn(signupSurfaces)
  surface: SignupSurface;

  @IsOptional() @Type(() => Number) @IsIn(summaryDays)
  days?: number;

  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;
}

class ListDto {
  @IsOptional() @IsIn(signupSurfaces)
  surface?: SignupSurface;

  @IsOptional() @IsIn(journeyStatuses)
  status?: JourneyStatus;

  @IsOptional() @IsIn(milestones)
  stuck_at?: Milestone;

  @IsOptional() @IsString() @Matches(/^[a-z0-9_]{2,60}$/)
  code?: string;

  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional() @Transform(trim) @IsString() @Length(1, 100)
  q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

/**
 * A sign-up page was opened (udozo.com's server, Seller HQ's browser): counted for the day, nothing about the visitor
 * kept, so it needs no consent. The top of the sign-up funnel.
 */
@ApiExcludeController()
@ProductOnly('udozo')
@Controller('signup-journeys')
export class SignupVisitsController {
  constructor(private readonly journeys: SignupJourneysService) {}

  @Public()
  @SkipIdempotency()
  @Post('visits')
  @HttpCode(HttpStatus.OK)
  visit(@Body() body: VisitDto) {
    return this.journeys.visit(body.surface);
  }
}

/** Reports > Sign-up journeys in Udozo's admin (operations and support): who gets stuck where, and why. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('operations', 'support')
@ProductOnly('udozo')
@Controller('admin/signup-journeys')
export class AdminSignupJourneysController {
  constructor(private readonly insights: SignupInsightsService) {}

  @Get('summary')
  summary(@Query() query: SummaryDto) {
    return this.insights.summary({ surface: query.surface, days: query.days ?? 7, country: query.country });
  }

  @Get()
  list(@Query() query: ListDto) {
    return this.insights.list(query);
  }

  @Get(':id')
  get(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.insights.get(id, adminId(caller));
  }
}

/** Global: Google's sign-in services record their own steps. */
@Global()
@Module({
  controllers: [SignupVisitsController, AdminSignupJourneysController],
  providers: [SignupJourneysService, SignupInsightsService, { provide: APP_INTERCEPTOR, useClass: SignupJourneyInterceptor }],
  exports: [SignupJourneysService],
})
export class SignupsModule {}
