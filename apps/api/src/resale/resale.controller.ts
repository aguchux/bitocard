import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { type Caller, CurrentCaller, Public, resellerOf, Roles, Scopes, storeScopeOf } from '../auth/caller.js';
import { ListingsService } from '../classifieds/listings.service.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { maxNote, type ResaleListingStatus, resaleListingStatuses, ResaleStoresService } from './resale-stores.service.js';
import { maxMessage, ResaleTradeService } from './resale-trade.service.js';

const slug = /^[a-z0-9]+(-[a-z0-9]+)*$/;

class PageQueryDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0, description: 'How many to skip.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000)
  offset?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, description: 'How many to return (catalogue default 24, listings 50).' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}

class CatalogueQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'A BitoCard Shop category slug (its subcategories included), for example `phones`.' })
  @IsOptional() @Matches(slug)
  category?: string;

  @ApiPropertyOptional({ description: 'Words in the title.', maxLength: 100 })
  @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Lowest supplier price, in minor units.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  min_price?: number;

  @ApiPropertyOptional({ description: 'Highest supplier price, in minor units.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  max_price?: number;

  @ApiPropertyOptional({ enum: ['new', 'used', 'untested', 'parts'] })
  @IsOptional() @IsIn(['new', 'used', 'untested', 'parts'])
  condition?: string;

  @ApiPropertyOptional({ description: 'Only this supplier’s listings.' })
  @IsOptional() @IsUUID()
  supplier_id?: string;

  @ApiPropertyOptional({ description: 'Mark which listings this store already carries (`in_stores`).' })
  @IsOptional() @IsUUID()
  store_id?: string;

  @ApiPropertyOptional({ enum: ['newest', 'price_asc', 'price_desc'], default: 'newest' })
  @IsOptional() @IsIn(['newest', 'price_asc', 'price_desc'])
  sort?: 'newest' | 'price_asc' | 'price_desc';
}

class PricingDto {
  @ApiPropertyOptional({ description: 'Your price as a markup over the supplier’s price, in basis points (1500 = 15%; negative only down to a deal’s floor). It follows the supplier’s price. Send this or `fixed_price`.', nullable: true })
  @IsOptional() @ValidateIf((_object, value) => value !== null) @IsInt() @Min(-10000) @Max(20000)
  markup_bps?: number | null;

  @ApiPropertyOptional({ description: 'Your price, fixed, in minor units; checked against the limits again whenever the supplier’s price or your deal changes. Send this or `markup_bps`.', nullable: true })
  @IsOptional() @ValidateIf((_object, value) => value !== null) @IsInt() @Min(1)
  fixed_price?: number | null;
}

class PreviewQueryDto {
  @ApiProperty({ description: 'The resale listing.' })
  @IsUUID()
  listing_id: string;

  @ApiPropertyOptional({ description: 'A markup to try, in basis points.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(-10000) @Max(20000)
  markup_bps?: number;

  @ApiPropertyOptional({ description: 'A fixed price to try, in minor units.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  fixed_price?: number;
}

class AddListingDto extends PricingDto {
  @ApiProperty({ description: 'Your store on the Resale shop template.' })
  @IsUUID()
  store_id: string;

  @ApiProperty({ description: 'The supplier’s resale listing, from the catalogue.' })
  @IsUUID()
  listing_id: string;
}

class UpdateListingDto extends PricingDto {
  @ApiPropertyOptional({ enum: ['active', 'paused'], description: '`paused` takes it off sale on your store; `active` puts it back.' })
  @IsOptional() @IsIn(['active', 'paused'])
  status?: 'active' | 'paused';
}

class ListingsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'One store’s listings.' })
  @IsOptional() @IsUUID()
  store_id?: string;

  @ApiPropertyOptional({ enum: resaleListingStatuses, description: 'Removed listings only when asked.' })
  @IsOptional() @IsIn(resaleListingStatuses)
  status?: ResaleListingStatus;
}

class NoteDto {
  @ApiProperty({ description: `Your one note on the listing, plain text, at most ${maxNote} characters: no links, phone numbers, email addresses or handles. It shows only once the supplier approves it.`, maxLength: maxNote })
  @IsString() @Length(1, maxNote + 20)
  note: string;
}

class RuleDto {
  @ApiProperty({ description: 'The Resale shop store listings are added to.' })
  @IsUUID()
  store_id: string;

  @ApiPropertyOptional({ description: 'A category slug (its subcategories included), or null for every category.', nullable: true })
  @IsOptional() @ValidateIf((_object, value) => value !== null) @Matches(slug)
  category?: string | null;

  @ApiProperty({ description: 'Your markup, in basis points; held to each listing’s markup limit.', minimum: 0, maximum: 20000 })
  @IsInt() @Min(0) @Max(20000)
  markup_bps: number;

  @ApiPropertyOptional({ description: 'Suppliers whose listings are never added.', type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true })
  excluded_supplier_ids?: string[];
}

class UpdateRuleDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 20000 })
  @IsOptional() @IsInt() @Min(0) @Max(20000)
  markup_bps?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true })
  excluded_supplier_ids?: string[];
}

class StartDto {
  @ApiProperty({ description: 'The supplier (from a catalogue listing’s `supplier.id`).' })
  @IsUUID()
  supplier_id: string;
}

class MessageDto {
  @ApiProperty({ description: 'The message.', maxLength: maxMessage })
  @IsString() @Length(1, maxMessage)
  body: string;
}

class AfterDto {
  @ApiPropertyOptional({ description: 'Only messages after this one (to poll for new ones).' })
  @IsOptional() @IsUUID()
  after?: string;
}

/**
 * B2B reselling for resellers (`/v1/resale`): BitoCard Shop suppliers' resale listings in your country, added to your
 * Resale shop stores at your own price inside each supplier's limits, your one note per listing (shown once the
 * supplier approves it), auto-listing rules, and your suppliers with their chat and deals.
 */
@ApiTags('Resale')
@ApiBearerAuth()
@Controller('resale')
export class ResaleController {
  constructor(
    private readonly stores: ResaleStoresService,
    private readonly trade: ResaleTradeService,
  ) {}

  @ApiOperation({ summary: 'Get your reselling status', description: 'Whether you can resell BitoCard Shop listings (and why not), your stores on the Resale shop template, and BitoCard’s fee on your margin.' })
  @Scopes('resale:read')
  @Get()
  account(@CurrentCaller() caller: Caller) {
    return this.stores.account(resellerOf(caller), storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'Browse the resale catalogue', description: 'Suppliers’ resale listings in your country, with each one’s discount, markup limit (and any deal of yours), the price range you may sell in and what you would keep at the top of it.' })
  @Scopes('resale:read')
  @Get('catalogue')
  catalogue(@CurrentCaller() caller: Caller, @Query() query: CatalogueQueryDto) {
    return this.stores.catalogue(resellerOf(caller), query, storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'Get a resale listing', description: 'One supplier’s listing exactly as they wrote it (photos, features, description), with its terms for you.' })
  @Scopes('resale:read')
  @Get('catalogue/:id')
  catalogueListing(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.stores.catalogueListing(resellerOf(caller), id);
  }

  @ApiOperation({ summary: 'Preview a resale price', description: 'What one sale at a markup or fixed price would give: your margin, BitoCard’s fee on it, your earnings and what the buyer pays. Nothing is saved.' })
  @Scopes('resale:read')
  @Get('price-preview')
  preview(@CurrentCaller() caller: Caller, @Query() query: PreviewQueryDto) {
    return this.stores.preview(resellerOf(caller), query);
  }

  @ApiOperation({ summary: 'List your resale listings', description: 'The listings on your stores with what each can do now (`state`: only `selling` is on sale), your price and earnings per sale, and your note.' })
  @Scopes('resale:read')
  @Get('listings')
  list(@CurrentCaller() caller: Caller, @Query() query: ListingsQueryDto) {
    return this.stores.list(resellerOf(caller), query, storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'Add a resale listing to a store', description: 'Sells a supplier’s listing on your Resale shop store at your price, inside the supplier’s limits. The store always shows the supplier’s own words and photos and names the supplier.' })
  @Roles('admin')
  @Scopes('resale:write')
  @Post('listings')
  add(@CurrentCaller() caller: Caller, @Body() body: AddListingDto) {
    return this.stores.add(resellerOf(caller), body, storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'Get a resale listing on your store' })
  @Scopes('resale:read')
  @Get('listings/:id')
  get(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.stores.get(resellerOf(caller), id, storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'Update a resale listing', description: 'Reprice it (a markup or a fixed price), pause it or put it back on sale.' })
  @Roles('admin')
  @Scopes('resale:write')
  @Patch('listings/:id')
  update(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateListingDto) {
    return this.stores.update(resellerOf(caller), id, body, storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'Remove a resale listing', description: 'Takes it off the store. Rules never add it back; add it by hand to sell it again.' })
  @Roles('admin')
  @Scopes('resale:write')
  @Delete('listings/:id')
  remove(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.stores.remove(resellerOf(caller), id, storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'Set your note on a resale listing', description: 'Your one note, shown on the store only once the supplier approves this exact text. Any change asks them again.' })
  @Roles('admin')
  @Scopes('resale:write')
  @Put('listings/:id/note')
  setNote(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: NoteDto) {
    return this.stores.setNote(resellerOf(caller), id, body.note, storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'Remove your note from a resale listing' })
  @Roles('admin')
  @Scopes('resale:write')
  @Delete('listings/:id/note')
  clearNote(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.stores.clearNote(resellerOf(caller), id, storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'List your auto-listing rules' })
  @Scopes('resale:read')
  @Get('rules')
  rules(@CurrentCaller() caller: Caller) {
    return this.stores.rules(resellerOf(caller), storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'Create an auto-listing rule', description: 'Adds every resale listing of a category (or every category) to a store at your markup, now and as new ones open, except excluded suppliers and listings you removed.' })
  @Roles('admin')
  @Scopes('resale:write')
  @Post('rules')
  createRule(@CurrentCaller() caller: Caller, @Body() body: RuleDto) {
    return this.stores.createRule(resellerOf(caller), body, storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'Update an auto-listing rule' })
  @Roles('admin')
  @Scopes('resale:write')
  @Patch('rules/:id')
  updateRule(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateRuleDto) {
    return this.stores.updateRule(resellerOf(caller), id, body, storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'Delete an auto-listing rule', description: 'Listings it added stay on the store.' })
  @Roles('admin')
  @Scopes('resale:write')
  @Delete('rules/:id')
  deleteRule(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.stores.deleteRule(resellerOf(caller), id, storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'List your suppliers', description: 'Suppliers whose listings you carry or you wrote to: their phone number, your deals and unread messages.' })
  @Scopes('resale:read')
  @Get('suppliers')
  suppliers(@CurrentCaller() caller: Caller) {
    return this.trade.suppliers(resellerOf(caller));
  }

  @ApiOperation({ summary: 'Start working with a supplier', description: 'Opens a chat with a supplier who has resale listings in your country.' })
  @Roles('admin', 'support')
  @Scopes('resale:write')
  @Post('suppliers')
  @HttpCode(HttpStatus.OK)
  async start(@CurrentCaller() caller: Caller, @Body() body: StartDto) {
    const resellerId = resellerOf(caller);
    return this.trade.start(resellerId, await this.stores.requireReseller(resellerId), body.supplier_id);
  }

  @ApiOperation({ summary: 'Get a supplier' })
  @Scopes('resale:read')
  @Get('suppliers/:id')
  supplier(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.trade.supplier(resellerOf(caller), id);
  }

  @ApiOperation({ summary: 'List messages with a supplier', description: 'The latest 100, oldest first, or those after `after`. Marks them read.' })
  @Scopes('resale:read')
  @Get('suppliers/:id/messages')
  messages(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Query() query: AfterDto) {
    return this.trade.resellerMessages(resellerOf(caller), id, query.after);
  }

  @ApiOperation({ summary: 'Write to a supplier' })
  @Roles('admin', 'support')
  @Scopes('resale:write')
  @Post('suppliers/:id/messages')
  send(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: MessageDto) {
    return this.trade.resellerSends(resellerOf(caller), id, body.body, caller.kind === 'session' ? caller.userId : null);
  }

  @ApiOperation({ summary: 'Close the chat with a supplier', description: 'Neither side can write until you reopen it; your listings of theirs stay on sale.' })
  @Roles('admin')
  @Scopes('resale:write')
  @Post('suppliers/:id/close')
  @HttpCode(HttpStatus.OK)
  close(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.trade.setResellerClosed(resellerOf(caller), id, true);
  }

  @ApiOperation({ summary: 'Reopen the chat with a supplier' })
  @Roles('admin')
  @Scopes('resale:write')
  @Post('suppliers/:id/reopen')
  @HttpCode(HttpStatus.OK)
  reopen(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.trade.setResellerClosed(resellerOf(caller), id, false);
  }

  @ApiOperation({ summary: 'Accept a deal', description: 'The supplier’s better terms apply to new orders from now, replacing your running deal for the same listing (or all).' })
  @Roles('admin')
  @Scopes('resale:write')
  @Post('deals/:id/accept')
  @HttpCode(HttpStatus.OK)
  accept(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.trade.answerDeal(resellerOf(caller), id, 'accept');
  }

  @ApiOperation({ summary: 'Decline a deal' })
  @Roles('admin')
  @Scopes('resale:write')
  @Post('deals/:id/decline')
  @HttpCode(HttpStatus.OK)
  decline(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.trade.answerDeal(resellerOf(caller), id, 'decline');
  }

  @ApiOperation({ summary: 'End a running deal', description: 'New orders use the listing’s own terms again; prices outside them stop selling until repriced.' })
  @Roles('admin')
  @Scopes('resale:write')
  @Post('deals/:id/end')
  @HttpCode(HttpStatus.OK)
  end(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.trade.resellerEndsDeal(resellerOf(caller), id);
  }
}

class DealDto {
  @IsOptional() @ValidateIf((_object, value) => value !== null) @IsUUID()
  listing_id?: string | null;

  @IsInt() @Min(1) @Max(10000)
  discount_bps: number;

  @IsOptional() @IsInt() @Min(0) @Max(10000)
  floor_bps?: number;

  @IsOptional() @ValidateIf((_object, value) => value !== null) @IsDateString()
  ends_at?: string | null;
}

class ApproveNoteDto {
  @IsString() @MaxLength(maxNote)
  note: string;
}

class ReasonDto {
  @IsOptional() @IsString() @MaxLength(300)
  reason?: string;
}

class SupplierMessageDto {
  @IsString() @Length(1, maxMessage)
  body: string;
}

class SupplierAfterDto {
  @IsOptional() @IsUUID()
  after?: string;
}

/** My Resellers in the Shop tab: suppliers' side (bitocard.com customers, through the store's server). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('classifieds/me')
export class SupplierResaleController {
  constructor(
    private readonly trade: ResaleTradeService,
    private readonly listings: ListingsService,
  ) {}

  @Get('resellers')
  async resellers(@CurrentCustomer() caller: CustomerCaller) {
    await this.listings.sellerCountry(caller.customer);
    return this.trade.resellers(caller.customer);
  }

  @Get('resellers/:id')
  async reseller(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    await this.listings.sellerCountry(caller.customer);
    return this.trade.reseller(caller.customer, id);
  }

  @Get('resellers/:id/messages')
  async messages(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Query() query: SupplierAfterDto) {
    await this.listings.sellerCountry(caller.customer);
    return this.trade.supplierMessages(caller.customer, id, query.after);
  }

  @Post('resellers/:id/messages')
  async send(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SupplierMessageDto) {
    await this.listings.sellerCountry(caller.customer);
    return this.trade.supplierSends(caller.customer, id, body.body);
  }

  /** Stop this reseller selling the supplier's listings (every store of theirs). */
  @Post('resellers/:id/stop')
  @HttpCode(HttpStatus.OK)
  async stop(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    await this.listings.sellerCountry(caller.customer);
    return this.trade.setStopped(caller.customer, id, true);
  }

  @Post('resellers/:id/resume')
  @HttpCode(HttpStatus.OK)
  async resume(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    await this.listings.sellerCountry(caller.customer);
    return this.trade.setStopped(caller.customer, id, false);
  }

  @Post('resellers/:id/deals')
  async offer(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: DealDto) {
    return this.trade.offerDeal(caller.customer, await this.listings.sellerCountry(caller.customer), id, body);
  }

  /** Withdraws an offered deal, or ends a running one. */
  @Post('resale-deals/:id/end')
  @HttpCode(HttpStatus.OK)
  async endDeal(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    await this.listings.sellerCountry(caller.customer);
    return this.trade.withdrawDeal(caller.customer, id);
  }

  @Post('resale-notes/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ApproveNoteDto) {
    await this.listings.sellerCountry(caller.customer);
    return this.trade.decideNote(caller.customer, id, 'approve', body);
  }

  @Post('resale-notes/:id/refuse')
  @HttpCode(HttpStatus.OK)
  async refuse(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    await this.listings.sellerCountry(caller.customer);
    return this.trade.decideNote(caller.customer, id, 'refuse', body);
  }

  @Post('resale-notes/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  async withdraw(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    await this.listings.sellerCountry(caller.customer);
    return this.trade.decideNote(caller.customer, id, 'withdraw', body);
  }
}
