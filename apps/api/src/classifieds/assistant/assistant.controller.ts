import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import type { Request, Response } from 'express';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../../auth/caller.js';
import { ApiError } from '../../common/errors/api-error.js';
import { SkipIdempotency } from '../../common/idempotency/idempotency.interceptor.js';
import { clientHeader, signedClientIp } from '../../common/rate-limit/client-ip.js';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { adminId } from '../../countries/countries.controller.js';
import { customerFor, customerSignInRequired } from '../../customers/customer-session.js';
import { CustomersService } from '../../customers/customers.service.js';
import { type ShopRole, shopRoles } from '../../support/bots.service.js';
import { type Asker, maxQuestion, ShopAssistantService, type SuggestionKind, suggestionKinds, visitorHeader, visitorPattern } from './assistant.service.js';
import { ShopAssistantsService } from './shop-assistants.service.js';
import { ProductOnly } from '../../products/product.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);
const language = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

class ProfileDto {
  @Transform(upper) @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter code' })
  country: string;

  @IsOptional() @Matches(language)
  language?: string;

  @IsOptional() @IsIn(shopRoles)
  surface?: ShopRole;
}

class StartDto extends ProfileDto {
  @IsIn(shopRoles)
  declare surface: ShopRole;

  @IsOptional() @IsUUID()
  listing_id?: string;

  @IsOptional() @IsUUID()
  conversation_id?: string;
}

class MessageDto {
  @IsString() @Length(1, maxQuestion)
  body: string;

  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsUUID('all', { each: true })
  photo_ids?: string[];
}

class RatingDto {
  @IsIn(['up', 'down'])
  rating: 'up' | 'down';
}

class ReportDto {
  @IsString() @Length(3, 500)
  reason: string;
}

class SuggestDto {
  @IsIn(suggestionKinds)
  kind: SuggestionKind;

  @IsOptional() @IsUUID()
  listing_id?: string;

  @IsOptional() @IsUUID()
  conversation_id?: string;
}

/**
 * BitoCard Shop's assistants for customers and visitors (left out of the public OpenAPI document). A signed-in customer
 * is known by their session (`BitoCard-Customer-Session`, as for the Shop's other routes); a visitor by the token the
 * first thread returned (`BitoCard-Assistant-Visitor`, kept by the site's server in its own cookie). Answers stream as
 * server-sent events when asked (`Accept: text/event-stream`: `status` as each tool runs, `cards` as they return, then
 * `message`), else come as one JSON answer.
 */
@ApiExcludeController()
@Public()
@Controller('classifieds/assistant')
@ProductOnly('udozo')
export class ShopAssistantController {
  constructor(
    private readonly assistant: ShopAssistantService,
    private readonly customers: CustomersService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private async asker(req: Request): Promise<Asker> {
    const session = await customerFor(this.customers, req);
    const token = req.get(visitorHeader);
    return { customer: session?.customer ?? null, visitorToken: !session && token && visitorPattern.test(token) ? token : null, address: signedClientIp(req.get(clientHeader), this.config.STORE_SERVER_SECRET) ?? req.ip ?? null };
  }

  @Get()
  async profile(@Req() req: Request, @Query() query: ProfileDto) {
    return this.assistant.profile(await this.asker(req), query.country, query.language, query.surface);
  }

  @Post('threads')
  @SkipIdempotency()
  async start(@Req() req: Request, @Body() body: StartDto) {
    return this.assistant.start(await this.asker(req), body);
  }

  @Get('threads/:id')
  async thread(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.assistant.thread(await this.asker(req), id);
  }

  @Post('threads/:id/messages')
  @SkipIdempotency()
  async send(@Req() req: Request, @Res() res: Response, @Param('id', ParseUUIDPipe) id: string, @Body() body: MessageDto) {
    const asker = await this.asker(req);
    if (!(req.get('accept') ?? '').includes('text/event-stream')) {
      res.status(HttpStatus.OK).json(await this.assistant.send(asker, id, body));
      return;
    }
    let started = false;
    const write = (event: string, data: unknown) => {
      if (!started) {
        started = true;
        res.status(HttpStatus.OK).set({ 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
        res.flushHeaders();
      }
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      const message = await this.assistant.send(asker, id, body, item => write(item.event, item.data));
      write('message', message);
    } catch (error) {
      // Before anything was streamed, a refusal is an ordinary error response; after, it is the stream's last event.
      if (!started) throw error;
      const apiError = error instanceof ApiError ? error : null;
      write('error', { code: apiError?.code ?? 'assistant_unavailable', message: apiError?.message ?? 'The assistant can’t answer right now.' });
    }
    res.end();
  }

  @Post('messages/:id/rating')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  async rate(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: RatingDto) {
    return this.assistant.rate(await this.asker(req), id, body.rating === 'up' ? 1 : -1);
  }

  @Post('messages/:id/report')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  async report(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReportDto) {
    return this.assistant.report(await this.asker(req), id, body.reason);
  }

  @Post('threads/:id/human')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  async human(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.assistant.human(await this.asker(req), id);
  }

  /** A seller's suggestion in the Shop tab: from photos, a price range, improvements, or a reply in a chat. */
  @Post('suggestions')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  async suggest(@Req() req: Request, @Body() body: SuggestDto) {
    const asker = await this.asker(req);
    if (!asker.customer) throw customerSignInRequired();
    return this.assistant.suggest(asker.customer, body);
  }
}

class AssignmentDto {
  @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country: string;

  @IsOptional() @Matches(language)
  language?: string | null;
}

class AssignmentsDto {
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => AssignmentDto)
  assignments: AssignmentDto[];
}

class RefreshCountriesDto {
  @IsOptional() @IsArray() @ArrayMaxSize(60) @Matches(/^[A-Z]{2}$/, { each: true })
  countries?: string[];
}

class ThreadsDto {
  @IsOptional() @IsIn(['up', 'down'])
  rating?: 'up' | 'down';

  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean()
  reported?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @IsUUID()
  starting_after?: string;
}

class EvalRunDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;
}

/** Admin: shop assistants' countries and default, knowledge per country, conversations to review, and evals. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('operations', 'support')
@Controller('admin/support')
@ProductOnly('udozo')
export class AdminShopAssistantsController {
  constructor(
    private readonly shops: ShopAssistantsService,
    private readonly assistant: ShopAssistantService,
  ) {}

  /** Each country and language with the assistant answering there. */
  @Get('shop-coverage')
  coverage() {
    return this.shops.coverage();
  }

  @Put('bots/:id/assignments')
  @AdminRoles('operations')
  async assign(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: AssignmentsDto) {
    return { object: 'shop_bot_assignments' as const, assignments: await this.shops.assign(adminId(caller), id, body.assignments.map(item => ({ country: item.country, language: item.language ?? null }))) };
  }

  @Post('bots/:id/make-default')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  async makeDefault(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    await this.shops.makeDefault(adminId(caller), id);
    return { object: 'shop_bot_default' as const, id };
  }

  @Get('bots/:id/shop-knowledge')
  countryKnowledge(@Param('id', ParseUUIDPipe) id: string) {
    return this.shops.countryKnowledge(id);
  }

  @Post('bots/:id/shop-knowledge/refresh')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  refresh(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: RefreshCountriesDto) {
    return this.shops.refreshCountries(adminId(caller), id, body.countries);
  }

  @Get('bots/:id/threads')
  threads(@Param('id', ParseUUIDPipe) id: string, @Query() query: ThreadsDto) {
    return this.shops.threads(id, query);
  }

  @Get('bots/:id/threads/:thread')
  thread(@Param('id', ParseUUIDPipe) id: string, @Param('thread', ParseUUIDPipe) thread: string) {
    return this.shops.thread(id, thread);
  }

  @Post('bots/:id/evals/run')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  runEvals(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: EvalRunDto) {
    return this.assistant.runEvals(adminId(caller), id, body.country);
  }

  @Get('bots/:id/evals')
  evals(@Param('id', ParseUUIDPipe) id: string) {
    return this.shops.evals(id);
  }
}
