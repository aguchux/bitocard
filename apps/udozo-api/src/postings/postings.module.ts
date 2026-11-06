import { Body, Controller, Get, Global, HttpCode, HttpStatus, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { adminId } from '../countries/countries.controller.js';
import { ProductOnly } from '../products/product.js';
import { type PostingStatus, postingStatuses, PostingInsightsService, summaryDays } from './insights.service.js';
import { PostingJourneysService, postingSources, type SellSource, sellSources, type StuckMilestone, stuckMilestones } from './journeys.service.js';
import { PostingJourneyInterceptor } from './track.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

class VisitDto {
  @IsIn(sellSources)
  source: SellSource;

  @IsBoolean()
  signed_in: boolean;
}

class SummaryDto {
  @IsOptional() @Type(() => Number) @IsIn(summaryDays)
  days?: number;

  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional() @IsIn(postingSources)
  source?: string;

  @IsOptional() @IsUUID()
  category?: string;
}

class ListDto {
  @IsOptional() @IsIn(postingStatuses)
  status?: PostingStatus;

  @IsOptional() @IsIn(stuckMilestones)
  stuck_at?: StuckMilestone;

  @IsOptional() @IsString() @Matches(/^[a-z0-9_]{2,60}$/)
  code?: string;

  @IsOptional() @IsIn(postingSources)
  source?: string;

  @IsOptional() @IsUUID()
  category?: string;

  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional() @Transform(trim) @IsString() @Length(1, 100)
  q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

/** Post an ad (or sign-in on the way to it) was opened: counted for the day by where Sell was pressed, nothing else kept. */
@ApiExcludeController()
@ProductOnly('udozo')
@Controller('posting-journeys')
export class PostingVisitsController {
  constructor(private readonly journeys: PostingJourneysService) {}

  @Public()
  @SkipIdempotency()
  @Post('visits')
  @HttpCode(HttpStatus.OK)
  visit(@Body() body: VisitDto) {
    return this.journeys.visit(body.source, body.signed_in);
  }
}

/** Reports > Posting journeys in Udozo's admin (operations and support): where sellers get stuck posting, and why. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('operations', 'support')
@ProductOnly('udozo')
@Controller('admin/posting-journeys')
export class AdminPostingJourneysController {
  constructor(private readonly insights: PostingInsightsService) {}

  @Get('summary')
  summary(@Query() query: SummaryDto) {
    return this.insights.summary({ days: query.days ?? 30, country: query.country, source: query.source, category: query.category });
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

/** Global: moderation and listing views record their own steps. */
@Global()
@Module({
  // The wizard's own steps are told to `PostingEventsController` (in the classifieds module, beside its customer guard).
  controllers: [PostingVisitsController, AdminPostingJourneysController],
  providers: [PostingJourneysService, PostingInsightsService, { provide: APP_INTERCEPTOR, useClass: PostingJourneyInterceptor }],
  exports: [PostingJourneysService],
})
export class PostingsModule {}
