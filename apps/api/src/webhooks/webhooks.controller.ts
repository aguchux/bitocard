import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUrl, Length, Max, MaxLength, Min } from 'class-validator';
import { type Caller, CurrentCaller, resellerOf, Roles, Scopes } from '../auth/caller';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor';
import type { LedgerMode, WebhookDeliveryStatus } from '../generated/prisma/client';
import { Mode } from '../ledger/mode';
import { modeHeader, PageDto } from '../ledger/wallet.controller';
import { WebhookEndpointsService } from './endpoints.service';
import { eventTypes } from './events';
import { EventsService } from './events.service';

const eventChoices = ['*', ...eventTypes];
const urlRules = { require_protocol: true, require_tld: false, protocols: ['https', 'http'] };

class CreateEndpointDto {
  @ApiProperty({ example: 'https://example.com/webhooks/bitocard', description: 'An HTTPS address on the public internet.' })
  @IsUrl(urlRules) @MaxLength(2048)
  url: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional() @IsString() @Length(1, 200)
  description?: string;

  @ApiPropertyOptional({ type: [String], enum: eventChoices, default: ['*'], description: 'Event types to receive; `*` for all, including types added later.' })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsIn(eventChoices, { each: true })
  events?: string[];
}

class UpdateEndpointDto {
  @ApiPropertyOptional()
  @IsOptional() @IsUrl(urlRules) @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional() @IsString() @Length(0, 200)
  description?: string;

  @ApiPropertyOptional({ type: [String], enum: eventChoices })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsIn(eventChoices, { each: true })
  events?: string[];

  @ApiPropertyOptional({ enum: ['enabled', 'disabled'], description: 'Enable an endpoint again after fixing it, or pause it.' })
  @IsOptional() @IsIn(['enabled', 'disabled'])
  status?: 'enabled' | 'disabled';
}

class RotateSecretDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 168, default: 24, description: 'Hours the old secret keeps signing alongside the new one; 0 stops it now.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(168)
  expire_previous_in_hours?: number;
}

class DeliveryFilterDto extends PageDto {
  @ApiPropertyOptional({ enum: ['pending', 'succeeded', 'failed'] })
  @IsOptional() @IsIn(['pending', 'succeeded', 'failed'])
  status?: WebhookDeliveryStatus;
}

class EventFilterDto {
  @ApiPropertyOptional({ description: 'The ID of the last event you handled, or an ISO 8601 time. Events after it are returned, oldest first.' })
  @IsOptional() @IsString() @MaxLength(64)
  since?: string;

  @ApiPropertyOptional({ enum: eventTypes })
  @IsOptional() @IsIn(eventTypes)
  type?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}

@ApiTags('Webhooks')
@ApiBearerAuth()
@modeHeader
@Scopes('webhooks:manage')
@Controller('webhook-endpoints')
export class WebhookEndpointsController {
  constructor(private readonly endpoints: WebhookEndpointsService) {}

  @ApiOperation({
    summary: 'Create a webhook endpoint',
    description:
      'Returns the signing secret (`whsec_…`) once; store it safely. Test-mode endpoints receive sandbox events, live endpoints live events. The URL must use HTTPS and reach the public internet.',
  })
  @Roles('admin', 'developer')
  @SkipIdempotency()
  @Post()
  create(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: CreateEndpointDto) {
    return this.endpoints.create(resellerOf(caller), mode, body);
  }

  @ApiOperation({ summary: 'List webhook endpoints' })
  @Get()
  list(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    return this.endpoints.list(resellerOf(caller), mode);
  }

  @ApiOperation({ summary: 'Get a webhook endpoint' })
  @Get(':id')
  get(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.endpoints.get(resellerOf(caller), mode, id);
  }

  @ApiOperation({ summary: 'Update a webhook endpoint', description: 'Change its URL, description or event types, or enable it again after it was disabled.' })
  @Roles('admin', 'developer')
  @Patch(':id')
  update(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateEndpointDto) {
    return this.endpoints.update(resellerOf(caller), mode, id, body);
  }

  @ApiOperation({ summary: 'Delete a webhook endpoint', description: 'Its delivery log is deleted too. Events stay available from `GET /v1/events`.' })
  @Roles('admin', 'developer')
  @Delete(':id')
  remove(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.endpoints.remove(resellerOf(caller), mode, id);
  }

  @ApiOperation({
    summary: 'Rotate the signing secret',
    description: 'Returns the new secret once. Until the old one expires, each delivery carries two `v1` signatures, one for each secret.',
  })
  @Roles('admin', 'developer')
  @SkipIdempotency()
  @Post(':id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  rotate(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: RotateSecretDto) {
    return this.endpoints.rotateSecret(resellerOf(caller), mode, id, body.expire_previous_in_hours ?? 24);
  }

  @ApiOperation({ summary: 'Send a test event', description: 'Sends a `ping` event to this endpoint now and returns the delivery with its result. Test events are not retried.' })
  @Roles('admin', 'developer')
  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  test(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.endpoints.sendTest(resellerOf(caller), mode, id);
  }

  @ApiOperation({ summary: 'List deliveries to an endpoint', description: 'The delivery log, newest first.' })
  @Get(':id/deliveries')
  deliveries(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Query() filter: DeliveryFilterDto) {
    return this.endpoints.listDeliveries(resellerOf(caller), mode, id, filter);
  }

  @ApiOperation({ summary: 'Get a delivery', description: 'Includes each attempt: response status, the start of the response body, any error and the time taken.' })
  @Get(':id/deliveries/:deliveryId')
  delivery(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Param('deliveryId', ParseUUIDPipe) deliveryId: string) {
    return this.endpoints.getDelivery(resellerOf(caller), mode, id, deliveryId);
  }

  @ApiOperation({ summary: 'Resend a delivery', description: 'Sends the same event (same ID and body, newly signed) again now, whatever its status.' })
  @Roles('admin', 'developer')
  @Post(':id/deliveries/:deliveryId/resend')
  @HttpCode(HttpStatus.OK)
  resend(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Param('deliveryId', ParseUUIDPipe) deliveryId: string) {
    return this.endpoints.resend(resellerOf(caller), mode, id, deliveryId);
  }
}

@ApiTags('Events')
@ApiBearerAuth()
@modeHeader
@Scopes('events:read')
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @ApiOperation({
    summary: 'List events',
    description:
      'Every event from the last 30 days, oldest first. Pass the ID of the last event you handled as `since` to catch up on anything missed; keep calling while `has_more` is true. Events appear here a few seconds after they happen. This list, not the webhook, is the source of truth.',
  })
  @Get()
  list(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() filter: EventFilterDto) {
    return this.events.list(resellerOf(caller), mode, filter);
  }

  @ApiOperation({ summary: 'Get an event' })
  @Get(':id')
  get(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.get(resellerOf(caller), mode, id);
  }
}
