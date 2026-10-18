import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, resellerOf, Roles, SessionOnly } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { recordTypes, type RecordType } from './dns.js';
import { DomainsService } from './domains.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class DomainSearchDto {
  @ApiProperty({ description: 'The name to look for, with or without an ending (`yourstore` or `yourstore.com`).', example: 'adadigital' })
  @Transform(trim) @IsString() @Length(2, 80)
  q: string;
}

class ConnectDomainDto {
  @ApiProperty({ description: 'A domain you own, for example `adadigital.com` or `shop.adadigital.com`.', example: 'adadigital.com' })
  @Transform(trim) @IsString() @Length(4, 253)
  domain: string;
}

class ContactDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) first_name: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) last_name: string;
  @ApiProperty() @Transform(trim) @Matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'email must be an email address' }) email: string;
  @ApiProperty({ description: 'In international form, for example +2348031234567.' }) @Transform(trim) @Matches(/^\+[1-9]\d{7,14}$/, { message: 'phone must be in international form, for example +2348031234567' }) phone: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) address1: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 200) address2?: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) city: string;
  @ApiProperty({ description: 'State, province or region.' }) @Transform(trim) @IsString() @Length(1, 100) state: string;
  @ApiProperty({ description: 'Postcode (use 00000 where there is none).' }) @Transform(trim) @IsString() @Length(1, 20) zip: string;
  @ApiProperty({ description: 'ISO country code.', example: 'NG' }) @Transform(trim) @Matches(/^[A-Za-z]{2}$/) country: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 200) company_name?: string;
}

class PurchaseDomainDto extends ConnectDomainDto {
  @ApiProperty({ description: 'The price you were shown, in US cents. A changed price is refused (`price_changed`), never charged.', example: 1350 })
  @IsInt() @Min(1) @Max(10_000_000)
  expected_price: number;

  @ApiProperty({ type: ContactDto, description: 'The domain’s registrant: you or your business. It is registered in this name.' })
  @ValidateNested() @Type(() => ContactDto)
  contact: ContactDto;
}

class UpdateDomainDto {
  @ApiPropertyOptional({ description: 'Make it the store’s main address (links, payment returns and emails use it).' })
  @IsOptional() @IsBoolean()
  primary?: boolean;

  @ApiPropertyOptional({ description: 'Domains bought here: renew it automatically from your wallet before it expires.' })
  @IsOptional() @IsBoolean()
  auto_renew?: boolean;
}

class RecordDto {
  @ApiProperty({ description: 'The name under the domain: empty or `@` for the domain itself, `blog` for blog.<domain>.', example: 'blog' })
  @Transform(trim) @IsString() @Length(0, 200)
  name: string;

  @ApiProperty({ enum: recordTypes })
  @IsIn(recordTypes)
  type: RecordType;

  @ApiProperty({ example: '203.0.113.10' })
  @Transform(trim) @IsString() @Length(1, 2048)
  value: string;

  @ApiPropertyOptional({ description: 'Seconds, 60 to 86,400 (default 3,600).' })
  @IsOptional() @IsInt() @Min(60) @Max(86400)
  ttl?: number;

  @ApiPropertyOptional({ description: 'MX records: their priority (lower is tried first).' })
  @IsOptional() @IsInt() @Min(0) @Max(65535)
  priority?: number;
}

class ImportRecordsDto {
  @ApiProperty({ type: [RecordDto], description: 'The records to copy to BitoCard’s DNS before you move the nameservers.' })
  @IsArray() @ArrayMaxSize(80) @ValidateNested({ each: true }) @Type(() => RecordDto)
  records: RecordDto[];
}

class MailProviderDto {
  @ApiProperty({ enum: ['google', 'microsoft', 'zoho'], nullable: true, description: 'Where your mailboxes are; null removes the records BitoCard wrote.' })
  @IsOptional() @IsIn(['google', 'microsoft', 'zoho', null])
  provider: 'google' | 'microsoft' | 'zoho' | null;

  @ApiPropertyOptional({ description: 'The verification TXT value the provider gives you, for example `google-site-verification=…`.' })
  @IsOptional() @Transform(trim) @IsString() @Length(1, 500)
  verification?: string;
}

class AdminDomainsQueryDto {
  @IsOptional() @IsIn(['purchasing', 'pending', 'active', 'failed', 'expired', 'suspended', 'removed']) status?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 100) q?: string;
}

class ReasonDto {
  @IsString() @Transform(trim) @Length(5, 500) reason: string;
}

/**
 * A store's own domains (SHQ only: buying spends from the wallet). Owners and admins manage them; the transfer code is
 * the owner's alone.
 */
@ApiTags('Stores')
@SessionOnly()
@Roles('admin')
@Controller('stores/:store/domains')
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  @ApiOperation({ summary: 'List a store’s domains', description: 'Each with its status, what to set at your DNS host while it is not connected, renewal and email settings.' })
  @Get()
  list(@CurrentCaller() caller: Caller, @Param('store', ParseUUIDPipe) store: string) {
    return this.domains.list(resellerOf(caller), store);
  }

  @ApiOperation({ summary: 'Find a domain to buy', description: 'The name in each ending BitoCard sells (only `.com` for now), with availability, the first year’s price and the renewal price in US dollars.' })
  @Get('search')
  search(@CurrentCaller() caller: Caller, @Param('store', ParseUUIDPipe) store: string, @Query() query: DomainSearchDto) {
    return this.domains.search(resellerOf(caller), store, query.q);
  }

  @ApiOperation({
    summary: 'Buy a domain for the store',
    description: 'Live only. The price (Vercel’s plus BitoCard’s disclosed margin) is held from your wallet in its currency at today’s rate and taken once the registrar confirms; a refused purchase returns it. The domain is registered in the contact’s name and connected to the store automatically.',
  })
  @Post('purchase')
  purchase(@CurrentCaller() caller: Caller, @Param('store', ParseUUIDPipe) store: string, @Body() body: PurchaseDomainDto) {
    const c = body.contact;
    return this.domains.purchase(resellerOf(caller), store, {
      domain: body.domain,
      expected_price: body.expected_price,
      contact: { firstName: c.first_name, lastName: c.last_name, email: c.email, phone: c.phone, address1: c.address1, ...(c.address2 ? { address2: c.address2 } : {}), city: c.city, state: c.state, zip: c.zip, country: c.country.toUpperCase(), ...(c.company_name ? { companyName: c.company_name } : {}) },
    });
  }

  @ApiOperation({ summary: 'Connect a domain you own', description: 'Adds it to your store. Then set the records shown (or point the nameservers to BitoCard) at your DNS host; HTTPS is issued once it resolves.' })
  @Post()
  connect(@CurrentCaller() caller: Caller, @Param('store', ParseUUIDPipe) store: string, @Body() body: ConnectDomainDto) {
    return this.domains.connect(resellerOf(caller), store, body);
  }

  @ApiOperation({ summary: 'Check a domain now', description: 'Reads its DNS, ownership and nameservers again (also checked automatically).' })
  @Post(':id/check')
  @HttpCode(HttpStatus.OK)
  check(@CurrentCaller() caller: Caller, @Param('store', ParseUUIDPipe) store: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.domains.check(resellerOf(caller), store, id);
  }

  @ApiOperation({ summary: 'Update a domain', description: 'Make it the main address, or switch automatic renewal on or off.' })
  @Patch(':id')
  update(@CurrentCaller() caller: Caller, @Param('store', ParseUUIDPipe) store: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateDomainDto) {
    return this.domains.update(resellerOf(caller), store, id, body);
  }

  @ApiOperation({ summary: 'Disconnect a domain', description: 'Connected domains only. A domain bought here stays with the store until it expires or is transferred.' })
  @Delete(':id')
  remove(@CurrentCaller() caller: Caller, @Param('store', ParseUUIDPipe) store: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.domains.remove(resellerOf(caller), store, id);
  }

  @ApiOperation({ summary: 'Renew a domain now', description: 'Domains bought here: a year more, paid from your wallet.' })
  @Post(':id/renew')
  @HttpCode(HttpStatus.OK)
  renew(@CurrentCaller() caller: Caller, @Param('store', ParseUUIDPipe) store: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.domains.renew(resellerOf(caller), store, id);
  }

  @ApiOperation({ summary: 'Get a domain’s transfer code', description: 'Owners only. Move a domain bought here to another registrar with it (not in its first 60 days).' })
  @Roles()
  @Post(':id/transfer-code')
  @HttpCode(HttpStatus.OK)
  transferCode(@CurrentCaller() caller: Caller, @Param('store', ParseUUIDPipe) store: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.domains.transferCode(resellerOf(caller), store, id);
  }

  @ApiOperation({ summary: 'List DNS records', description: 'Domains on BitoCard’s DNS. `protected` records keep your store and email working and cannot be changed here.' })
  @Get(':id/records')
  records(@CurrentCaller() caller: Caller, @Param('store', ParseUUIDPipe) store: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.domains.records(resellerOf(caller), store, id);
  }

  @ApiOperation({ summary: 'Add a DNS record', description: 'A, AAAA, CNAME, MX, TXT or CAA. The domain itself and www are your store’s and take no A, AAAA or CNAME.' })
  @Post(':id/records')
  addRecord(@CurrentCaller() caller: Caller, @Param('store', ParseUUIDPipe) store: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: RecordDto) {
    return this.domains.addRecord(resellerOf(caller), store, id, body);
  }

  @ApiOperation({ summary: 'Delete a DNS record' })
  @Delete(':id/records/:record')
  deleteRecord(@CurrentCaller() caller: Caller, @Param('store', ParseUUIDPipe) store: string, @Param('id', ParseUUIDPipe) id: string, @Param('record') record: string) {
    return this.domains.deleteRecord(resellerOf(caller), store, id, record);
  }

  @ApiOperation({ summary: 'Find records to copy before moving nameservers', description: 'Connected domains: the public records BitoCard found (email above all), and the nameservers to set afterwards.' })
  @Get(':id/dns-import')
  importPreview(@CurrentCaller() caller: Caller, @Param('store', ParseUUIDPipe) store: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.domains.importPreview(resellerOf(caller), store, id);
  }

  @ApiOperation({ summary: 'Copy records to BitoCard’s DNS', description: 'Copies the records you confirmed, so nothing breaks when you set the nameservers shown.' })
  @Post(':id/dns-import')
  @HttpCode(HttpStatus.OK)
  importRecords(@CurrentCaller() caller: Caller, @Param('store', ParseUUIDPipe) store: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: ImportRecordsDto) {
    return this.domains.importRecords(resellerOf(caller), store, id, body.records);
  }

  @ApiOperation({ summary: 'Point the domain’s email to a mailbox provider', description: 'Google Workspace, Microsoft 365 or Zoho Mail: on BitoCard’s DNS the records are written for you; otherwise they are listed to add at your DNS host.' })
  @Put(':id/mail-provider')
  mailProvider(@CurrentCaller() caller: Caller, @Param('store', ParseUUIDPipe) store: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: MailProviderDto) {
    return this.domains.setMailProvider(resellerOf(caller), store, id, { provider: body.provider ?? null, verification: body.verification });
  }

  @ApiOperation({ summary: 'Send order emails from the domain', description: 'Your store’s emails come from orders@<domain> once the domain is verified for sending (records written for you on BitoCard’s DNS).' })
  @Post(':id/email-sending')
  @HttpCode(HttpStatus.OK)
  emailSending(@CurrentCaller() caller: Caller, @Param('store', ParseUUIDPipe) store: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.domains.enableSending(resellerOf(caller), store, id);
  }
}

/** Public: the storefront app finds which store a custom domain serves. */
@ApiTags('Stores')
@Public()
@Controller('storefronts/domains')
export class StorefrontDomainsController {
  constructor(private readonly domains: DomainsService) {}

  @ApiOperation({ summary: 'Look up the store a custom domain serves' })
  @Get(':domain')
  @Header('Cache-Control', 'public, max-age=60')
  storefront(@Param('domain') domain: string) {
    return this.domains.storefrontFor(domain);
  }
}

@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/domains')
export class AdminDomainsController {
  constructor(private readonly domains: DomainsService) {}

  @AdminRoles('operations', 'support', 'finance')
  @Get()
  list(@Query() query: AdminDomainsQueryDto) {
    return this.domains.adminList(query);
  }

  @AdminRoles('operations')
  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.domains.adminSuspend(adminId(caller), id, body);
  }

  @AdminRoles('operations')
  @Post(':id/reinstate')
  @HttpCode(HttpStatus.OK)
  reinstate(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.domains.adminReinstate(adminId(caller), id, body);
  }
}
