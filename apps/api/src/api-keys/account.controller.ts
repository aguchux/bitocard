import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type Caller, CurrentCaller } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { presentPlan } from '../plans/plans.service.js';

/** The reseller account a request acts for. A simple first call to check an API key works. */
@ApiTags('Account')
@ApiBearerAuth()
@Controller('account')
export class AccountController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOperation({ summary: 'Retrieve the account', description: 'The reseller account and how the request is authenticated. A simple first call to check an API key.' })
  @Get()
  async account(@CurrentCaller() caller: Caller) {
    if (!caller.resellerId) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'not_permitted', 'Choose a reseller account first.');
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: caller.resellerId }, include: { plan: true } });
    return {
      object: 'account' as const,
      reseller: { object: 'reseller' as const, id: reseller.id, name: reseller.name, country: reseller.country, status: reseller.status },
      plan: presentPlan(reseller.plan),
      authenticated_as:
        caller.kind === 'api_key'
          ? { type: 'api_key' as const, api_key_id: caller.apiKeyId, mode: caller.mode, scopes: caller.scopes }
          : { type: 'session' as const, user_id: caller.userId, role: caller.role },
    };
  }
}
