import { Body, Controller, Get, HttpCode, HttpStatus, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { adminId } from '../countries/countries.controller.js';
import { PrismaService } from '../database/prisma.service.js';
import { ProductOnly } from '../products/product.js';
import { advocacies, channels, invitePattern, loggedKinds, MarketingService, type Outcome, outcomes, type Stage, stages, type StageStatus, stageStatuses } from './marketing.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

class ListDto {
  @IsOptional() @IsIn(stages)
  stage?: Stage;

  @IsOptional() @IsIn(stageStatuses)
  status?: StageStatus;

  /** me, none (unassigned) or an admin's id. */
  @IsOptional() @IsString() @Length(2, 36)
  owner?: string;

  @IsOptional() @IsIn(['overdue', 'today', 'week', 'none'])
  due?: string;

  @IsOptional() @IsIn([...outcomes, 'none'])
  outcome?: string;

  @IsOptional() @IsIn(['yes', 'no'])
  linked?: string;

  @IsOptional() @IsString() @Length(1, 80)
  category?: string;

  @IsOptional() @Transform(trim) @IsString() @Length(1, 100)
  q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

class CreateDto {
  @Transform(trim) @IsString() @Length(2, 120)
  name: string;

  @IsOptional() @IsString() @MaxLength(120)
  store_name?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) @MaxLength(30, { each: true })
  phones?: string[];

  @IsOptional() @Transform(trim) @IsEmail() @Length(3, 254)
  email?: string;

  @IsOptional() @IsString() @MaxLength(120)
  location?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(80, { each: true })
  categories?: string[];

  @IsOptional() @IsString() @MaxLength(60)
  source?: string;

  @IsOptional() @IsString() @MaxLength(5000)
  notes?: string;

  @IsOptional() @IsUUID()
  owner_id?: string;

  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;
}

class ImportRowDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(200) store_name?: string;
  @IsOptional() @IsString() @MaxLength(200) phone?: string;
  @IsOptional() @IsString() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(120) category?: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsString() @MaxLength(600) advert_url?: string;
  @IsOptional() @IsString() @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(60) price?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class ImportDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ImportRowDto)
  rows: ImportRowDto[];

  @IsOptional() @IsUUID()
  owner_id?: string;

  @IsOptional() @IsString() @Length(2, 60)
  source?: string;

  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;
}

class UpdateDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 120)
  name?: string;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(120)
  store_name?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) @MaxLength(30, { each: true })
  phones?: string[];

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsEmail() @Length(3, 254)
  email?: string | null;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(120)
  location?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(80, { each: true })
  categories?: string[];

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(5000)
  notes?: string | null;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsUUID()
  owner_id?: string | null;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(200)
  next_action?: string | null;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsISO8601()
  next_action_at?: string | null;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsIn(outcomes)
  outcome?: Outcome | null;

  @IsOptional() @IsBoolean()
  do_not_contact?: boolean;
}

class LogDto {
  @IsIn(loggedKinds)
  kind: (typeof loggedKinds)[number];

  @IsOptional() @IsIn(channels)
  channel?: string;

  @IsOptional() @IsString() @MaxLength(60)
  template?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  body?: string;

  @IsOptional() @IsBoolean()
  replied?: boolean;

  @IsOptional() @IsIn(outcomes)
  outcome?: Outcome;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(200)
  next_action?: string | null;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsISO8601()
  next_action_at?: string | null;
}

class StageDto {
  @IsIn(stages)
  stage: Stage;

  @IsIn(stageStatuses)
  status: StageStatus;

  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

class FeedbackDto {
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(5)
  rating?: number | null;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsBoolean()
  would_recommend?: boolean | null;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(2000)
  notes?: string | null;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(500)
  reason?: string | null;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsIn(advocacies)
  advocacy?: (typeof advocacies)[number] | null;
}

class LinkDto {
  @IsOptional() @Transform(trim) @IsEmail() @Length(3, 254)
  email?: string;

  @IsOptional() @IsString() @Length(6, 30)
  phone?: string;

  @IsOptional() @IsBoolean()
  unlink?: boolean;
}

class InviteEmailDto {
  @IsOptional() @Transform(trim) @IsEmail() @Length(3, 254)
  email?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  message?: string;
}

class InviteAnyoneDto {
  @Transform(trim) @IsEmail() @Length(3, 254)
  email: string;

  @IsOptional() @Transform(trim) @IsString() @Length(2, 120)
  name?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  message?: string;

  @IsOptional() @IsUUID()
  owner_id?: string;
}

/** Marketplace > Marketing in Udozo's admin: every admin role works it (no `@AdminRoles`). */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/marketing')
@ProductOnly('udozo')
export class AdminMarketingController {
  constructor(
    private readonly marketing: MarketingService,
    private readonly prisma: PrismaService,
  ) {}

  private async actor(caller: Caller) {
    const id = adminId(caller);
    const user = id ? await this.prisma.user.findUnique({ where: { id }, select: { name: true } }) : null;
    return { id, name: user?.name ?? 'The Udozo team' };
  }

  @Get('summary')
  summary() {
    return this.marketing.summary();
  }

  @Get('prospects')
  list(@CurrentCaller() caller: Caller, @Query() query: ListDto) {
    return this.marketing.list(adminId(caller), query);
  }

  @Post('prospects')
  create(@CurrentCaller() caller: Caller, @Body() body: CreateDto) {
    return this.marketing.create(adminId(caller), body);
  }

  @Post('prospects/import')
  @HttpCode(HttpStatus.OK)
  import(@CurrentCaller() caller: Caller, @Body() body: ImportDto) {
    return this.marketing.import(adminId(caller), body);
  }

  @Get('prospects/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.marketing.get(id);
  }

  @Patch('prospects/:id')
  update(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateDto) {
    return this.marketing.update(adminId(caller), id, body);
  }

  @Post('prospects/:id/activities')
  @HttpCode(HttpStatus.OK)
  log(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: LogDto) {
    return this.marketing.log(adminId(caller), id, body);
  }

  @Post('prospects/:id/stage')
  @HttpCode(HttpStatus.OK)
  stage(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: StageDto) {
    return this.marketing.setStage(adminId(caller), id, body);
  }

  @Post('prospects/:id/feedback')
  @HttpCode(HttpStatus.OK)
  feedback(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: FeedbackDto) {
    return this.marketing.feedback(adminId(caller), id, body);
  }

  @Post('prospects/:id/link')
  @HttpCode(HttpStatus.OK)
  link(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: LinkDto) {
    return this.marketing.link(adminId(caller), id, body);
  }

  @Post('prospects/:id/invite-email')
  @HttpCode(HttpStatus.OK)
  async inviteEmail(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: InviteEmailDto) {
    return this.marketing.emailInvite(await this.actor(caller), id, body);
  }

  /** Invites anyone by email to sign up and sell on Udozo (an ordinary account), added to Marketing to track. */
  @Post('invites')
  @HttpCode(HttpStatus.OK)
  async invite(@CurrentCaller() caller: Caller, @Body() body: InviteAnyoneDto) {
    return this.marketing.inviteByEmail(await this.actor(caller), body);
  }
}

/** udozo.com's invite link (/i/<code>) tells the API it was opened, then opens sign-up with the code. */
@ApiExcludeController()
@Controller('marketing')
@ProductOnly('udozo')
export class MarketingInvitesController {
  constructor(private readonly marketing: MarketingService) {}

  @Public()
  @SkipIdempotency()
  @Post('invites/:code/open')
  @HttpCode(HttpStatus.NO_CONTENT)
  async open(@Param('code') code: string) {
    if (invitePattern.test(code)) await this.marketing.opened(code);
  }
}

@Module({ controllers: [AdminMarketingController, MarketingInvitesController], providers: [MarketingService], exports: [MarketingService] })
export class MarketingModule {}
