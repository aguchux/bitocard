import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Transform, Type } from 'class-transformer';
import { Allow, ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsPositive, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { maxDocumentBytes } from '../kyc/files.js';
import { Public } from '../auth/caller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { PageDto } from '../ledger/wallet.controller.js';
import { sendPhoto } from './chat-files.js';
import { ConversationsService, maxMessage } from './conversations.service.js';
import { LeadsService } from './leads.service.js';
import { ListingsService } from './listings.service.js';
import { type DisputeReason, disputeReasons, SafePayService } from './safe-pay.service.js';
import { FavouritesService } from './favourites.service.js';
import { ListingMediaService, type MediaUpload } from './media.service.js';
import { ModerationService, type ReportReason, reportReasons } from './moderation.service.js';
import { maxVideoBytes } from './video.js';
import { ClassifiedReferenceService } from './reference.service.js';
import { ShopDirectoryService } from './directory.service.js';
import { ListingSearchService, maxOffset, maxResults, type SearchSort, searchSorts } from './search.service.js';
import { conditions, contacts, deliveries, type ListingStatus, listingStatuses, maxDescription, maxFeatures, priceKinds } from './rules.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);

class CountryDto {
  @Transform(upper) @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter code' })
  country: string;
}

const list = ({ value }: { value: unknown }) => (value === undefined ? undefined : (Array.isArray(value) ? value : [value]).flatMap(item => String(item).split(',')).map(item => item.trim()).filter(Boolean));
const many = ({ value }: { value: unknown }) => (value === undefined ? undefined : Array.isArray(value) ? value.map(String) : [String(value)]);
const slug = /^[a-z0-9]+(-[a-z0-9]+)*$/;

class SearchDto extends CountryDto {
  @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @IsOptional() @Matches(slug)
  category?: string;

  /** The buyer's area (city or area slug), for local-first results; `state` narrows it or stands alone. */
  @IsOptional() @Matches(slug)
  area?: string;

  @IsOptional() @Matches(slug)
  state?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  price_min?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  price_max?: number;

  /** new, used, untested and parts, comma separated. */
  @IsOptional() @Transform(list) @IsArray() @ArrayMaxSize(4) @IsString({ each: true })
  condition?: string[];

  /** Feature filters, repeated: `f=memory:4..16&f=colour:black,white`. */
  @IsOptional() @Transform(many) @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(120, { each: true })
  f?: string[];

  @IsOptional() @IsIn(searchSorts)
  sort?: SearchSort;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(maxOffset)
  offset?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(maxResults)
  limit?: number;
}

class ShowcaseDto {
  @IsOptional() @Matches(slug)
  category?: string;
}

class SitemapDto extends CountryDto {
  /** Listings after this number (the previous page's `next_after`). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  after?: number;
}

class SuggestDto extends CountryDto {
  @IsString() @MaxLength(60)
  q: string;
}

class FeatureSearchDto {
  @IsOptional() @IsString() @MaxLength(60)
  q?: string;
}

class FeatureValueDto {
  @IsString() @MaxLength(60)
  key: string;

  /** Text, a number, a choice or yes or no, checked against the key's registry entry. */
  @Allow()
  value: unknown;
}

class ListingDto {
  @IsOptional() @IsUUID()
  category_id?: string | null;

  @IsOptional() @IsUUID()
  area_id?: string | null;

  @IsOptional() @IsString() @MaxLength(200)
  title?: string | null;

  @IsOptional() @IsString() @MaxLength(maxDescription + 1000)
  description?: string | null;

  @IsOptional() @IsIn(priceKinds)
  price_kind?: (typeof priceKinds)[number];

  /** In the currency's minor units (kobo). */
  @IsOptional() @IsInt()
  price?: number | null;

  @IsOptional() @IsIn(conditions)
  condition?: (typeof conditions)[number] | null;

  @IsOptional() @IsIn(deliveries)
  delivery?: (typeof deliveries)[number];

  @IsOptional() @IsIn(contacts)
  contact?: (typeof contacts)[number];

  @IsOptional() @IsArray() @ArrayMaxSize(maxFeatures + 5) @ValidateNested({ each: true }) @Type(() => FeatureValueDto)
  features?: FeatureValueDto[];
}

class PhotoOrderDto {
  @IsArray() @ArrayMaxSize(30) @IsUUID('all', { each: true })
  order: string[];
}

const photoUpload = FileInterceptor('file', { limits: { fileSize: maxDocumentBytes + 1, files: 1, fields: 1 } });
const videoUpload = FileInterceptor('file', { limits: { fileSize: maxVideoBytes + 1, files: 1, fields: 1 } });

class FavouriteDto {
  @IsUUID()
  listing_id: string;
}

class FavouritesPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

class ReportDto {
  @IsUUID()
  listing_id: string;

  @IsIn(reportReasons)
  reason: ReportReason;

  @IsOptional() @IsString() @MaxLength(1000)
  details?: string;
}

class StartChatDto {
  @IsUUID()
  listing_id: string;

  @IsString() @MaxLength(maxMessage + 500)
  body: string;
}

class MessageDto {
  @IsString() @MaxLength(maxMessage + 500)
  body: string;
}

class PhotoCaptionDto {
  @IsOptional() @IsString() @MaxLength(500)
  caption?: string;
}

class ChatsDto {
  @IsOptional() @IsIn(['buying', 'selling'])
  role?: 'buying' | 'selling';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

class ChatPageDto {
  /** Messages after this one (polling). */
  @IsOptional() @IsUUID()
  after?: string;

  /** Messages before this one (paging back). */
  @IsOptional() @IsUUID()
  before?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}

class ChatReportDto {
  @IsIn(reportReasons)
  reason: ReportReason;

  @IsOptional() @IsString() @MaxLength(1000)
  details?: string;
}

class OfferDto {
  /** In the currency's minor units (kobo). */
  @IsInt() @IsPositive()
  price: number;
}

class MyListingsDto extends PageDto {
  @IsOptional() @IsIn(listingStatuses)
  status?: ListingStatus;
}

/** BitoCard Shop's public reference data, cached a minute: the feature registry, a country's categories and areas. */
@ApiExcludeController()
@Public()
@Controller('classifieds')
export class ClassifiedReferenceController {
  constructor(
    private readonly reference: ClassifiedReferenceService,
    private readonly search: ListingSearchService,
    private readonly directory: ShopDirectoryService,
  ) {}

  /** The countries BitoCard Shop is open in, with their live listings, and whether the global showcase is on. */
  @Get('markets')
  @Header('Cache-Control', 'public, max-age=60')
  markets() {
    return this.directory.markets();
  }

  /** The global showcase (from the second market): countries, categories, recent and trending listings, never prices. */
  @Get('showcase')
  @Header('Cache-Control', 'public, max-age=60')
  showcase(@Query() query: ShowcaseDto) {
    return this.directory.showcase(query.category);
  }

  /** What a country's sitemap lists: category and place counts, and its listings a page at a time. */
  @Get('sitemap')
  @Header('Cache-Control', 'public, max-age=300')
  sitemap(@Query() query: SitemapDto) {
    return this.directory.sitemap(query.country, query.after);
  }

  /** Live listings in one country: words, category, price, condition and feature filters; local first from `area`. */
  @Get('listings')
  @Header('Cache-Control', 'public, max-age=60')
  listings(@Query() query: SearchDto) {
    return this.search.search(query);
  }

  /** A listing's public page by its number (`/ng/l/<ref>-<slug>`); 410 once gone. */
  @Get('listings/:ref')
  @Header('Cache-Control', 'public, max-age=60')
  listing(@Param('ref', ParseIntPipe) ref: number, @Query() query: CountryDto) {
    return this.search.listing(query.country, ref);
  }

  @Get('search/suggest')
  @Header('Cache-Control', 'public, max-age=60')
  suggest(@Query() query: SuggestDto) {
    return this.search.suggest(query.country, query.q);
  }

  @Get('features')
  @Header('Cache-Control', 'public, max-age=60')
  features(@Query() query: FeatureSearchDto) {
    return this.reference.features(query.q);
  }

  @Get('categories')
  @Header('Cache-Control', 'public, max-age=60')
  categories(@Query() query: CountryDto) {
    return this.reference.categories(query.country);
  }

  @Get('areas')
  @Header('Cache-Control', 'public, max-age=60')
  areas(@Query() query: CountryDto) {
    return this.reference.areas(query.country);
  }
}

/**
 * The seller's browser sending a listing's video with the link its store's server asked for (`listings/:id/video-upload`):
 * the link is the credential (no cookie or session header), so any page may call it (CORS without credentials, set in
 * `bootstrap.ts`), and repeating it is harmless (a listing has one video).
 */
@ApiExcludeController()
@Public()
@Controller('classifieds')
export class ClassifiedVideoUploadsController {
  constructor(private readonly media: ListingMediaService) {}

  @Post('video-uploads/:token')
  @HttpCode(HttpStatus.ACCEPTED)
  @SkipIdempotency()
  @UseInterceptors(videoUpload)
  upload(@Param('token') token: string, @UploadedFile() file?: MediaUpload) {
    return this.media.addVideoWithToken(token, file);
  }
}

/** A seller's own listings (bitocard.com customers, through the store's server). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('classifieds')
export class ClassifiedListingsController {
  constructor(
    private readonly listings: ListingsService,
    private readonly media: ListingMediaService,
    private readonly moderation: ModerationService,
    private readonly favourites: FavouritesService,
  ) {}

  /** Saved listings, newest saved first: live, sold (30 days) or gone, with any price drop since saving. */
  @Get('favourites')
  savedListings(@CurrentCustomer() caller: CustomerCaller, @Query() query: FavouritesPageDto) {
    return this.favourites.list(caller.customer, query);
  }

  @Post('favourites')
  @HttpCode(HttpStatus.OK)
  save(@CurrentCustomer() caller: CustomerCaller, @Body() body: FavouriteDto) {
    return this.favourites.add(caller.customer, body.listing_id);
  }

  @Delete('favourites/:listing')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unsave(@CurrentCustomer() caller: CustomerCaller, @Param('listing', ParseUUIDPipe) listing: string) {
    await this.favourites.remove(caller.customer, listing);
  }

  /** Reports a listing to BitoCard's moderators (once per listing while open; three reporters send it to review). */
  @Post('reports')
  async report(@CurrentCustomer() caller: CustomerCaller, @Body() body: ReportDto) {
    await this.listings.sellerCountry(caller.customer);
    return this.moderation.report(caller.customer, body);
  }

  @Get('me/listings')
  mine(@CurrentCustomer() caller: CustomerCaller, @Query() query: MyListingsDto) {
    return this.listings.list(caller.customer, query);
  }

  @Get('me/listings/:id')
  one(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.get(caller.customer, id);
  }

  @Post('listings')
  create(@CurrentCustomer() caller: CustomerCaller, @Body() body: ListingDto) {
    return this.listings.create(caller.customer, body);
  }

  @Patch('listings/:id')
  update(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ListingDto) {
    return this.listings.update(caller.customer, id, body);
  }

  @Post('listings/:id/submit')
  @HttpCode(HttpStatus.OK)
  submit(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.submit(caller.customer, id);
  }

  @Post('listings/:id/renew')
  @HttpCode(HttpStatus.OK)
  renew(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.renew(caller.customer, id);
  }

  @Post('listings/:id/sold')
  @HttpCode(HttpStatus.OK)
  sold(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.markSold(caller.customer, id);
  }

  @Delete('listings/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    await this.listings.remove(caller.customer, id);
  }

  /** A photo (JPEG or PNG, at most 4 MB), its metadata removed. Sending the same photo again returns it. */
  @Post('listings/:id/photos')
  @SkipIdempotency()
  @UseInterceptors(photoUpload)
  addPhoto(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: MediaUpload) {
    return this.media.addPhoto(caller.customer, id, file);
  }

  /** The video (MP4, MOV or WebM, at most 50 MB and 60 seconds): accepted as processing, re-encoded after the reply. */
  @Post('listings/:id/video')
  @HttpCode(HttpStatus.ACCEPTED)
  @SkipIdempotency()
  @UseInterceptors(videoUpload)
  addVideo(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: MediaUpload) {
    return this.media.addVideo(caller.customer, id, file);
  }

  /** A 15-minute link for the browser to send the video to the API directly (`POST video-uploads/<token>`). */
  @Post('listings/:id/video-upload')
  @HttpCode(HttpStatus.OK)
  videoUploadLink(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.videoUploadLink(caller.customer, caller.sessionId, id);
  }

  @Patch('listings/:id/photos')
  reorder(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: PhotoOrderDto) {
    return this.media.reorder(caller.customer, id, body.order);
  }

  @Delete('listings/:id/media/:media')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMedia(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Param('media', ParseUUIDPipe) media: string) {
    await this.media.remove(caller.customer, id, media);
  }
}

/** BitoCard Shop's chats between buyers and sellers, offers, and Show phone (bitocard.com customers). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('classifieds')
export class ClassifiedChatsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly leads: LeadsService,
    private readonly directory: ShopDirectoryService,
  ) {}

  /** What the signed-in buyer already has with a listing: saved, a chat, an open Safe pay request or order. */
  @Get('listings/:id/viewer')
  viewer(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.directory.viewer(caller.customer, id);
  }

  /** The seller's confirmed number (a few new listings an hour); each buyer counts once as a lead. */
  @Post('listings/:id/phone')
  @HttpCode(HttpStatus.OK)
  phone(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.revealPhone(caller.customer, id);
  }

  /** Views, leads, phone reveals, chats and offers on one of the seller's listings. */
  @Get('me/listings/:id/stats')
  stats(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.stats(caller.customer, id);
  }

  @Get('conversations')
  chats(@CurrentCustomer() caller: CustomerCaller, @Query() query: ChatsDto) {
    return this.conversations.list(caller.customer, query);
  }

  @Get('conversations/unread')
  unread(@CurrentCustomer() caller: CustomerCaller) {
    return this.conversations.unreadCount(caller.customer);
  }

  /** The buyer's first message about a listing opens the chat (or continues theirs). */
  @Post('conversations')
  start(@CurrentCustomer() caller: CustomerCaller, @Body() body: StartChatDto) {
    return this.conversations.start(caller.customer, body);
  }

  /** The latest messages (reading them marks the chat read), `after` to poll, `before` to page back. */
  @Get('conversations/:id')
  chat(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Query() query: ChatPageDto) {
    return this.conversations.get(caller.customer, id, query);
  }

  @Post('conversations/:id/messages')
  send(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: MessageDto) {
    return this.conversations.send(caller.customer, id, body.body);
  }

  /** A photo (JPEG or PNG, at most 4 MB), its metadata removed, with an optional `caption`. */
  @Post('conversations/:id/photos')
  @SkipIdempotency()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: maxDocumentBytes + 1, files: 1, fields: 2 } }))
  sendPhoto(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: PhotoCaptionDto, @UploadedFile() file?: MediaUpload) {
    return this.conversations.sendPhoto(caller.customer, id, file, body.caption);
  }

  @Get('conversations/:id/photos/:message')
  async photo(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Param('message', ParseUUIDPipe) message: string, @Res() res: Response) {
    sendPhoto(res, await this.conversations.photo(caller.customer, id, message));
  }

  @Post('conversations/:id/block')
  @HttpCode(HttpStatus.OK)
  block(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.block(caller.customer, id, true);
  }

  @Post('conversations/:id/unblock')
  @HttpCode(HttpStatus.OK)
  unblock(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.block(caller.customer, id, false);
  }

  /** Reports the other person; moderators may then read the chat. */
  @Post('conversations/:id/report')
  reportChat(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ChatReportDto) {
    return this.conversations.report(caller.customer, id, body);
  }

  /** A price offer (either side); it replaces an open one and stays open 48 hours. */
  @Post('conversations/:id/offers')
  offer(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: OfferDto) {
    return this.conversations.makeOffer(caller.customer, id, body.price);
  }

  @Post('offers/:id/accept')
  @HttpCode(HttpStatus.OK)
  accept(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.acceptOffer(caller.customer, id);
  }

  @Post('offers/:id/decline')
  @HttpCode(HttpStatus.OK)
  decline(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.declineOffer(caller.customer, id);
  }

  @Post('offers/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  withdraw(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.withdrawOffer(caller.customer, id);
  }
}

class SafePayQuoteDto {
  @IsOptional() @IsUUID()
  offer_id?: string;
}

class SafePayRequestDto {
  @IsUUID()
  listing_id: string;

  /** An offer the seller accepted (its price), else the listed price. */
  @IsOptional() @IsUUID()
  offer_id?: string;

  @IsIn(['meet_up', 'delivery'])
  fulfilment: 'meet_up' | 'delivery';

  @IsOptional() @IsString() @MaxLength(500)
  delivery_address?: string;
}

class ReasonOptionalDto {
  @IsOptional() @IsString() @MaxLength(300)
  reason?: string;
}

class ReleaseDto {
  @IsString() @Matches(/^\s*\d{6}\s*$/, { message: 'code must be the 6 digits the buyer shows you' })
  code: string;
}

class SentDto {
  @IsOptional() @IsString() @MaxLength(300)
  tracking_note?: string;
}

class DisputeDto {
  @IsIn(disputeReasons)
  reason: DisputeReason;

  @IsString() @MaxLength(2000)
  details: string;
}

class DisputeMessageDto {
  @IsOptional() @IsString() @MaxLength(2000)
  body?: string;
}

class OrdersDto {
  @IsOptional() @IsIn(['buying', 'selling'])
  role?: 'buying' | 'selling';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

/** BitoCard Shop's Safe pay: the buyer's request and payment from the wallet, the seller's acceptance and hand-over, disputes. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('classifieds')
export class ClassifiedSafePayController {
  constructor(private readonly safePay: SafePayService) {}

  /** The buyer's price, Safe pay fee and total for a listing (or an accepted offer), and what it covers. */
  @Get('listings/:id/safe-pay')
  quote(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Query() query: SafePayQuoteDto) {
    return this.safePay.quote(caller.customer, id, query.offer_id);
  }

  /** What a seller still needs before accepting Safe pay orders. */
  @Get('me/safe-pay')
  readiness(@CurrentCustomer() caller: CustomerCaller) {
    return this.safePay.readiness(caller.customer);
  }

  @Get('orders')
  orders(@CurrentCustomer() caller: CustomerCaller, @Query() query: OrdersDto) {
    return this.safePay.list(caller.customer, query);
  }

  @Post('orders')
  request(@CurrentCustomer() caller: CustomerCaller, @Body() body: SafePayRequestDto) {
    return this.safePay.request(caller.customer, body);
  }

  @Get('orders/:id')
  order(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.safePay.get(caller.customer, id);
  }

  @Post('orders/:id/accept')
  @HttpCode(HttpStatus.OK)
  accept(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.safePay.accept(caller.customer, id);
  }

  @Post('orders/:id/decline')
  @HttpCode(HttpStatus.OK)
  decline(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonOptionalDto) {
    return this.safePay.decline(caller.customer, id, body.reason);
  }

  /** The buyer pays the total from their wallet into escrow (`wallet_balance_low` says how much to add). */
  @Post('orders/:id/pay')
  @HttpCode(HttpStatus.OK)
  pay(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.safePay.pay(caller.customer, id);
  }

  /** The buyer's release code for a meet-up (never shown to the seller). */
  @Get('orders/:id/release-code')
  @Header('Cache-Control', 'no-store')
  releaseCode(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.safePay.releaseCode(caller.customer, id);
  }

  /** The seller enters the buyer's code at the meet-up: the money is released at once (5 tries). */
  @Post('orders/:id/release')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  release(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReleaseDto) {
    return this.safePay.release(caller.customer, id, body.code);
  }

  @Post('orders/:id/sent')
  @HttpCode(HttpStatus.OK)
  sent(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SentDto) {
    return this.safePay.markSent(caller.customer, id, body.tracking_note);
  }

  @Post('orders/:id/received')
  @HttpCode(HttpStatus.OK)
  received(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.safePay.received(caller.customer, id);
  }

  /** Either side, before the hand-over; once paid, the buyer is refunded in full. */
  @Post('orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonOptionalDto) {
    return this.safePay.cancel(caller.customer, id, body.reason);
  }

  @Post('orders/:id/dispute')
  openDispute(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: DisputeDto) {
    return this.safePay.dispute(caller.customer, id, body);
  }

  @Get('orders/:id/dispute')
  disputeThread(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.safePay.disputeThread(caller.customer, id);
  }

  /** A message on the dispute, with an optional photo (multipart `file`, JPEG or PNG up to 4 MB). */
  @Post('orders/:id/dispute/messages')
  @SkipIdempotency()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: maxDocumentBytes + 1, files: 1, fields: 2 } }))
  disputeMessage(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: DisputeMessageDto, @UploadedFile() file?: MediaUpload) {
    return this.safePay.disputeMessage(caller.customer, id, body.body ?? '', file);
  }

  @Get('orders/:id/dispute/photos/:message')
  async disputePhoto(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Param('message', ParseUUIDPipe) message: string, @Res() res: Response) {
    sendPhoto(res, await this.safePay.disputePhoto(caller.customer, id, message));
  }
}
