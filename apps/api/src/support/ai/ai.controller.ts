import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseEnumPipe, Put, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly, resellerOf, Roles, SessionOnly } from '../../auth/caller.js';
import { adminId } from '../../countries/countries.controller.js';
import { AiService } from './ai.service.js';
import { type AiProviderName, aiProviders } from './providers.js';

class KeyDto {
  @IsString() @Length(16, 500)
  api_key: string;
}

class MonthDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}$/)
  month?: string;
}

const providerPipe = new ParseEnumPipe(Object.fromEntries(aiProviders.map(item => [item, item])));
const userOf = (caller: Caller) => (caller.kind === 'session' ? caller.userId : null);

/** SHQ: the AI behind the reseller's support bots: BitoCard's (Premium) or their own keys, and this month's use. */
@ApiExcludeController()
@SessionOnly()
@Roles('admin')
@Controller('support/ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get()
  overview(@CurrentCaller() caller: Caller) {
    return this.ai.overview(resellerOf(caller));
  }

  /** Saves the reseller's own key once the provider accepts it. */
  @Put('keys/:provider')
  saveKey(@CurrentCaller() caller: Caller, @Param('provider', providerPipe) provider: AiProviderName, @Body() body: KeyDto) {
    return this.ai.saveKey(resellerOf(caller), userOf(caller), provider, body.api_key);
  }

  @Delete('keys/:provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteKey(@CurrentCaller() caller: Caller, @Param('provider', providerPipe) provider: AiProviderName) {
    await this.ai.deleteKey(resellerOf(caller), userOf(caller), provider);
  }

  @Get('usage')
  usage(@CurrentCaller() caller: Caller, @Query() query: MonthDto) {
    return this.ai.usage({ resellerId: resellerOf(caller), month: query.month });
  }
}

/** Admin: AI use for support across resellers, with BitoCard's cost. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('operations', 'finance', 'support')
@Controller('admin/support/ai')
export class AdminAiController {
  constructor(private readonly ai: AiService) {}

  @Get('usage')
  usage(@CurrentCaller() caller: Caller, @Query() query: MonthDto) {
    adminId(caller);
    return this.ai.usage({ month: query.month });
  }
}
