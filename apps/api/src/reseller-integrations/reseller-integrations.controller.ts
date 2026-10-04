import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, Length, Matches } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, personOf, RealmOnly, resellerOf, Roles, SessionOnly } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import type { ConnectionStatus, LedgerMode } from '../generated/prisma/client.js';
import { Mode } from '../ledger/mode.js';
import { modeHeader } from '../ledger/wallet.controller.js';
import { type ConnectionDecision, ResellerIntegrationsService } from './reseller-integrations.service.js';
import { OwnSuppliersService } from './own-suppliers.service.js';

class ConnectDto {
  @ApiProperty({
    description: "The integration's credentials by field key (see `fields`). Secrets left blank keep the saved ones.",
    example: { client_id: 'abc123', client_secret: 's3cr3t' },
  })
  @IsObject()
  values: Record<string, unknown>;
}

class RoutingDto {
  @ApiProperty({ enum: ['preferred', 'fallback', 'off'], description: '`preferred`: used before BitoCard’s suppliers; `fallback`: only when BitoCard has no offer; `off`: never.' })
  @IsIn(['preferred', 'fallback', 'off'])
  routing: 'preferred' | 'fallback' | 'off';
}

class OfferDto {
  @ApiProperty({ description: 'Offered to resellers in every country.' })
  @IsBoolean()
  global: boolean;

  @ApiProperty({ description: 'Countries it is offered in when not global.', example: ['NG', 'GH'] })
  @IsArray()
  @ArrayMaxSize(250)
  @Matches(/^[A-Za-z]{2}$/, { each: true, message: 'countries must be 2-letter codes' })
  countries: string[];

  @ApiProperty({ enum: ['automatic', 'review'] })
  @IsIn(['automatic', 'review'])
  approval: 'automatic' | 'review';
}

class ConnectionFilterDto {
  @ApiPropertyOptional({ enum: ['pending_review', 'active', 'rejected', 'suspended', 'disconnected'] })
  @IsOptional()
  @IsIn(['pending_review', 'active', 'rejected', 'suspended', 'disconnected'])
  status?: ConnectionStatus;

  @ApiPropertyOptional({ enum: ['live', 'test'] })
  @IsOptional()
  @IsIn(['live', 'test'])
  mode?: LedgerMode;
}

class DecideDto {
  @ApiProperty({ enum: ['approve', 'reject', 'suspend', 'reinstate'] })
  @IsIn(['approve', 'reject', 'suspend', 'reinstate'])
  decision: ConnectionDecision;

  @ApiPropertyOptional({ description: 'Needed to reject or suspend; the reseller sees it.' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  reason?: string;
}

const integrationId = (value: string) => value.trim().toLowerCase();

/**
 * Your own integrations: connect your own supplier and payment gateway accounts, where BitoCard offers them in your
 * country. Dashboard only (never API keys); owners and admins manage them, every member can see them.
 */
@ApiTags('Integrations')
@modeHeader
@SessionOnly()
@Controller('integrations')
export class ResellerIntegrationsController {
  constructor(
    private readonly integrations: ResellerIntegrationsService,
    private readonly ownSuppliers: OwnSuppliersService,
  ) {}

  @ApiOperation({
    summary: 'Sync your supplier catalogue',
    description: 'Fetches your own supplier’s products and your prices with your credentials (simulated in the sandbox). Also runs daily.',
  })
  @Roles('admin')
  @Post(':id/connection/sync')
  @HttpCode(HttpStatus.OK)
  sync(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id') id: string) {
    return this.ownSuppliers.sync(resellerOf(caller), mode, integrationId(id));
  }

  @ApiOperation({ summary: 'Choose when your supplier is used', description: 'Before BitoCard’s suppliers, only when BitoCard has no offer, or never.' })
  @Roles('admin')
  @Put(':id/connection/routing')
  @HttpCode(HttpStatus.NO_CONTENT)
  routing(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id') id: string, @Body() body: RoutingDto) {
    return this.ownSuppliers.setRouting(resellerOf(caller), mode, integrationId(id), body.routing);
  }

  @ApiOperation({
    summary: 'List the integrations you can connect',
    description: 'Integrations offered in your country, each with its fields and your connection in this mode, plus whether your account may connect them (`access`).',
  })
  @Get()
  list(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    return this.integrations.list(resellerOf(caller), mode);
  }

  @ApiOperation({
    summary: 'Connect your own account',
    description:
      'Saves (or replaces) your credentials, encrypted; they are never returned. Live credentials are checked with the provider first; live connections may wait for BitoCard to review them.',
  })
  @Roles('admin')
  @Put(':id/connection')
  connect(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id') id: string, @Body() body: ConnectDto) {
    return this.integrations.connect(resellerOf(caller), mode, personOf(caller), integrationId(id), body.values);
  }

  @ApiOperation({ summary: 'Check a connection again', description: 'Live: asks the provider whether the saved credentials still work.' })
  @Roles('admin')
  @Post(':id/connection/check')
  @HttpCode(HttpStatus.OK)
  check(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id') id: string) {
    return this.integrations.check(resellerOf(caller), mode, integrationId(id));
  }

  @ApiOperation({ summary: 'Disconnect your account', description: 'Erases the saved credentials.' })
  @Roles('admin')
  @Delete(':id/connection')
  @HttpCode(HttpStatus.NO_CONTENT)
  disconnect(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id') id: string) {
    return this.integrations.disconnect(resellerOf(caller), mode, personOf(caller), integrationId(id));
  }
}

/** Admins: which integrations resellers may connect and where, and the connections to review. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin')
export class AdminResellerIntegrationsController {
  constructor(private readonly integrations: ResellerIntegrationsService) {}

  @AdminRoles('operations', 'support')
  @Get('integrations/reseller-availability')
  offers() {
    return this.integrations.adminOffers();
  }

  @AdminRoles('super_admin')
  @Put('integrations/:id/reseller-availability')
  setOffer(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body() body: OfferDto) {
    return this.integrations.setOffer(adminId(caller), integrationId(id), body);
  }

  @AdminRoles('operations', 'support')
  @Get('connections')
  connections(@Query() filter: ConnectionFilterDto) {
    return this.integrations.adminConnections(filter);
  }

  @AdminRoles('operations')
  @Post('connections/:id/decide')
  @HttpCode(HttpStatus.OK)
  decide(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: DecideDto) {
    return this.integrations.decide(adminId(caller), id, body.decision, body.reason);
  }
}
