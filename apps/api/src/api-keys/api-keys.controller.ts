import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { type Caller, CurrentCaller, Roles, SessionOnly } from '../auth/caller';
import { ApiError } from '../common/errors/api-error';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor';
import { ApiKeysService, apiKeyScopes } from './api-keys.service';

class CreateApiKeyDto {
  @ApiProperty({ description: 'A name to recognise the key by, such as the system that uses it.', minLength: 1, maxLength: 60, example: 'Website backend' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiProperty({ enum: ['test', 'live'], description: 'test keys use the sandbox; live keys move real money.' })
  @IsIn(['test', 'live'])
  mode: 'test' | 'live';

  @ApiPropertyOptional({ enum: apiKeyScopes, isArray: true, description: 'What the key may do. Defaults to every scope.' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(apiKeyScopes, { each: true })
  scopes?: string[];
}

class RollApiKeyDto {
  @ApiPropertyOptional({ description: 'Hours the old key keeps working, so you can deploy the new one (0 to 72).', minimum: 0, maximum: 72, default: 24 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(72)
  overlap_hours?: number;
}

function sessionReseller(caller: Caller) {
  if (caller.kind !== 'session' || !caller.resellerId) {
    throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'not_permitted', 'Choose a reseller account first.');
  }
  return { resellerId: caller.resellerId, userId: caller.userId };
}

/** Managing API keys needs a signed-in owner, admin or developer; keys cannot manage keys. */
@ApiTags('API keys')
@SessionOnly()
@Roles('admin', 'developer')
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  /** Create a key. The secret is returned only in this response; store it safely. */
  @ApiOperation({ summary: 'Create a key', description: 'The secret is returned only in this response; store it safely.' })
  @Post()
  @SkipIdempotency()
  create(@CurrentCaller() caller: Caller, @Body() body: CreateApiKeyDto) {
    const { resellerId, userId } = sessionReseller(caller);
    return this.keys.create(resellerId, userId, body);
  }

  /** Every key, including revoked and expired ones. Secrets are never shown again. */
  @ApiOperation({ summary: 'Every key, including revoked and expired ones', description: 'Secrets are never shown again.' })
  @Get()
  list(@CurrentCaller() caller: Caller) {
    return this.keys.list(sessionReseller(caller).resellerId);
  }

  /** Replace a key with a new secret. The old one keeps working for the overlap period. */
  @ApiOperation({ summary: 'Replace a key with a new secret', description: 'The old one keeps working for the overlap period.' })
  @Post(':id/roll')
  @SkipIdempotency()
  @HttpCode(HttpStatus.CREATED)
  roll(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: RollApiKeyDto) {
    const { resellerId, userId } = sessionReseller(caller);
    return this.keys.roll(resellerId, userId, id, body.overlap_hours ?? 24);
  }

  /** Revoke a key immediately. */
  @ApiOperation({ summary: 'Revoke a key immediately' })
  @Delete(':id')
  revoke(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.keys.revoke(sessionReseller(caller).resellerId, id);
  }
}
