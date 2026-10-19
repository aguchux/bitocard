import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID, Length, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly, resellerOf, Roles, SessionOnly } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { type AiProviderName, aiProviders } from './ai/providers.js';
import { type BotFunding, botFundings, type BotOwner, type BotRole, botRoles, BotsService } from './bots.service.js';
import { knowledgeTemplate, managedKeys, type ManagedKey, maxKnowledgeChars } from './knowledge.js';
import { type Tone, tones } from './prompt.js';

class BotProfileDto {
  @IsOptional() @IsString() @Length(2, 40)
  name?: string;

  @IsOptional() @IsArray() @ArrayMinSize(1) @IsIn(botRoles, { each: true })
  roles?: BotRole[];

  @IsOptional() @IsIn(aiProviders)
  provider?: AiProviderName;

  @IsOptional() @IsString() @Length(2, 100)
  model?: string;

  @IsOptional() @IsIn(botFundings)
  funding?: BotFunding;

  @IsOptional() @ValidateIf((_object, value) => value !== null) @IsUUID()
  store_id?: string | null;

  @IsOptional() @ValidateIf((_object, value) => value !== null) @IsString() @Length(0, 300)
  greeting?: string | null;

  @IsOptional() @IsIn(tones)
  tone?: Tone;

  @IsOptional() @ValidateIf((_object, value) => value !== null) @IsString() @Length(0, 2000)
  instructions?: string | null;

  @IsOptional() @IsIn(['auto', 'draft'])
  ticket_reply_mode?: 'auto' | 'draft';

  @IsOptional() @ValidateIf((_object, value) => value !== null) @IsUrl({ protocols: ['https'], require_protocol: true })
  avatar_url?: string | null;

  @IsOptional() @IsBoolean()
  auto_refresh?: boolean;
}

class CreateBotDto extends BotProfileDto {
  @IsString() @Length(2, 40)
  declare name: string;

  @IsArray() @ArrayMinSize(1) @IsIn(botRoles, { each: true })
  declare roles: BotRole[];

  @IsIn(aiProviders)
  declare provider: AiProviderName;

  @IsString() @Length(2, 100)
  declare model: string;

  @IsIn(botFundings)
  declare funding: BotFunding;

  @IsOptional() @IsIn(['store', 'platform'])
  scope?: 'store' | 'platform';
}

class KnowledgeDto {
  @IsString() @Length(1, maxKnowledgeChars * 2)
  content: string;

  @IsOptional() @IsIn(['md', 'csv'])
  format?: 'md' | 'csv';

  @IsOptional() @IsIn(['upload', 'edited', 'generated'])
  source?: 'upload' | 'edited' | 'generated';
}

class RefreshDto {
  @IsOptional() @IsArray() @IsIn(managedKeys, { each: true })
  apply?: ManagedKey[];
}

class RestoreDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000)
  version: number;
}

class TestMessageDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString() @Length(1, 2000)
  content: string;
}

class TestDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => TestMessageDto)
  messages: TestMessageDto[];
}

class TemplateDto {
  @IsOptional() @IsIn(['md', 'csv'])
  format?: 'md' | 'csv';
}

class SuspendDto {
  @IsString() @Length(5, 500)
  reason: string;
}

const resellerOwner = (caller: Caller): BotOwner => ({ kind: 'reseller', resellerId: resellerOf(caller), userId: caller.kind === 'session' ? caller.userId : null });
const adminOwner = (caller: Caller): BotOwner => ({ kind: 'admin', userId: adminId(caller) });

/** The routes both sides share: SHQ (a reseller's own stores) and admin (bitocard.com and BitoCard's assistant for resellers). */
function botRoutes(owner: (caller: Caller) => BotOwner) {
  class Routes {
    constructor(readonly bots: BotsService) {}

    @Get()
    list(@CurrentCaller() caller: Caller) {
      return this.bots.list(owner(caller));
    }

    @Post()
    create(@CurrentCaller() caller: Caller, @Body() body: CreateBotDto) {
      return this.bots.create(owner(caller), body);
    }

    @Get(':id')
    get(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
      return this.bots.get(owner(caller), id);
    }

    @Patch(':id')
    update(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: BotProfileDto) {
      return this.bots.update(owner(caller), id, body);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    async remove(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
      await this.bots.remove(owner(caller), id);
    }

    @Post(':id/activate')
    @HttpCode(HttpStatus.OK)
    activate(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
      return this.bots.activate(owner(caller), id);
    }

    @Post(':id/pause')
    @HttpCode(HttpStatus.OK)
    pause(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
      return this.bots.pause(owner(caller), id);
    }

    @Get(':id/knowledge')
    knowledge(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
      return this.bots.knowledgeOf(owner(caller), id);
    }

    @Put(':id/knowledge')
    saveKnowledge(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: KnowledgeDto) {
      return this.bots.saveKnowledge(owner(caller), id, body);
    }

    @Post(':id/knowledge/generate')
    @HttpCode(HttpStatus.OK)
    generate(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
      return this.bots.generate(owner(caller), id);
    }

    /** Without `apply`: what Update knowledge base would change. With it: those BitoCard sections are applied. */
    @Post(':id/knowledge/refresh')
    @HttpCode(HttpStatus.OK)
    async refresh(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: RefreshDto) {
      if (!body.apply) return this.bots.refreshPreview(owner(caller), id);
      const done = await this.bots.refreshApply(owner(caller), id, body.apply);
      return { object: 'support_bot_knowledge_refreshed' as const, ...done, knowledge: await this.bots.knowledgeOf(owner(caller), id) };
    }

    @Post(':id/knowledge/restore')
    @HttpCode(HttpStatus.OK)
    restore(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: RestoreDto) {
      return this.bots.restore(owner(caller), id, body.version);
    }

    @Post(':id/test')
    @HttpCode(HttpStatus.OK)
    test(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: TestDto) {
      return this.bots.test(owner(caller), id, body.messages);
    }
  }
  return Routes;
}

/** SHQ: the reseller's assistants (owners and admins, sessions only). */
@ApiExcludeController()
@SessionOnly()
@Roles('admin')
@Controller('support/bots')
export class BotsController extends botRoutes(resellerOwner) {
  constructor(bots: BotsService) {
    super(bots);
  }
}

/** The sample knowledge templates (Markdown, or CSV for FAQs), for any signed-in team member or admin to download. */
@ApiExcludeController()
@SessionOnly()
@Controller('support/knowledge-template')
export class KnowledgeTemplateController {
  @Get()
  template(@Query() query: TemplateDto) {
    const format = query.format ?? 'md';
    return { object: 'support_knowledge_template' as const, format, filename: format === 'csv' ? 'assistant-faqs-template.csv' : 'assistant-knowledge-template.md', content: knowledgeTemplate[format] };
  }
}

/** Admin: BitoCard's own assistants, and suspending any reseller's. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('operations', 'support')
@Controller('admin/support/bots')
export class AdminBotsController extends botRoutes(adminOwner) {
  constructor(bots: BotsService) {
    super(bots);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SuspendDto) {
    return this.bots.suspend(adminId(caller), id, body.reason);
  }

  @Post(':id/unsuspend')
  @HttpCode(HttpStatus.OK)
  unsuspend(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.bots.unsuspend(adminId(caller), id);
  }
}

@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/support/knowledge-template')
export class AdminKnowledgeTemplateController extends KnowledgeTemplateController {}
