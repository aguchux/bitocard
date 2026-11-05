import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../../auth/caller.js';
import { ApiError } from '../../common/errors/api-error.js';
import { adminId } from '../../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../../customers/customer-session.js';
import { ProductOnly } from '../../products/product.js';
import { SellerProfilesService } from '../sellers.service.js';
import { sellerKeyPattern } from '../usernames.service.js';
import { maxPostBody, maxReviewBody, type ReviewRating, type ReviewReportReason, reviewRatings, reviewReportReasons, ReviewsService, reviewStances } from './reviews.service.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);

class ReviewDto {
  @IsIn(reviewRatings)
  rating: ReviewRating;

  /** { described, communication, handover }: up or down (checked by the service). */
  @IsOptional() @IsObject()
  aspects?: Record<string, 'up' | 'down'>;

  @IsOptional() @IsString() @MaxLength(maxReviewBody)
  body?: string;
}

class ReviewEditDto {
  @IsOptional() @IsIn(reviewRatings)
  rating?: ReviewRating;

  @IsOptional() @IsObject()
  aspects?: Record<string, 'up' | 'down'>;

  @IsOptional() @IsString() @MaxLength(maxReviewBody)
  body?: string;
}

class PostDto {
  @IsString() @Length(1, maxPostBody)
  body: string;

  @IsOptional() @IsIn(reviewStances)
  stance?: string;

  @IsOptional() @IsUUID()
  reply_to?: string;
}

class PostEditDto {
  @IsString() @Length(1, maxPostBody)
  body: string;
}

class ReportDto {
  @IsIn(reviewReportReasons)
  reason: ReviewReportReason;

  @IsOptional() @IsString() @MaxLength(500)
  details?: string;

  @IsOptional() @IsUUID()
  post_id?: string;
}

class PurchasesQueryDto {
  @IsOptional() @IsIn(['to_review', 'all'])
  state?: 'to_review' | 'all';

  @IsOptional() @IsUUID()
  order_id?: string;

  @IsOptional() @IsUUID()
  buy_order_id?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}

class MineQueryDto {
  @IsOptional() @IsIn(['given', 'received'])
  role?: 'given' | 'received';
}

class SellerReviewsQueryDto {
  @IsOptional() @IsString() @MaxLength(200)
  product?: string;

  @IsOptional() @IsIn(reviewRatings)
  rating?: string;

  @IsOptional() @IsIn(['safe_pay', 'buy_order'])
  source?: string;

  @IsOptional() @IsIn(['newest', 'negative'])
  sort?: 'newest' | 'negative';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000)
  offset?: number;
}

/** A buyer's purchases and reviews, and writing in reviews' conversations (signed in). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('classifieds')
@ProductOnly('udozo')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('me/purchases')
  purchases(@CurrentCustomer() caller: CustomerCaller, @Query() query: PurchasesQueryDto) {
    return this.reviews.purchases(caller.customer, query);
  }

  @Post('purchases/:id/review')
  write(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewDto) {
    return this.reviews.write(caller.customer, id, body);
  }

  @Post('purchases/:id/dismiss')
  @HttpCode(HttpStatus.OK)
  dismiss(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.dismiss(caller.customer, id);
  }

  @Get('me/reviews')
  mine(@CurrentCustomer() caller: CustomerCaller, @Query() query: MineQueryDto) {
    return this.reviews.mine(caller.customer, query.role ?? 'given');
  }

  @Patch('reviews/:id')
  edit(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewEditDto) {
    return this.reviews.edit(caller.customer, id, body);
  }

  @Delete('reviews/:id')
  withdraw(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.withdraw(caller.customer, id);
  }

  @Get('reviews/:id/viewer')
  viewer(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.viewer(caller.customer, id);
  }

  /** The review as its author or the seller sees it (whatever it stands at), with the whole conversation. */
  @Get('me/reviews/:id')
  own(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.get(id, caller.customer.id);
  }

  @Post('reviews/:id/posts')
  post(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: PostDto) {
    return this.reviews.post(caller.customer, id, body);
  }

  @Patch('review-posts/:id')
  editPost(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: PostEditDto) {
    return this.reviews.editPost(caller.customer, id, body);
  }

  @Delete('review-posts/:id')
  deletePost(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.deletePost(caller.customer, id);
  }

  @Post('reviews/:id/report')
  report(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReportDto) {
    return this.reviews.report(caller.customer, id, body);
  }
}

/** Sellers' reviews, public (a minute in caches). */
@ApiExcludeController()
@Public()
@Controller('classifieds')
@ProductOnly('udozo')
export class PublicReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly sellers: SellerProfilesService,
  ) {}

  @Get('sellers/:key/reviews')
  @Header('Cache-Control', 'public, max-age=60')
  async sellerReviews(@Param('key') key: string, @Query() query: SellerReviewsQueryDto) {
    if (!sellerKeyPattern.test(key)) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such seller.');
    const seller = await this.sellers.seller(key);
    if (!seller.country) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such seller.');
    return this.reviews.sellerReviews(seller.id, seller.country, query);
  }

  @Get('reviews/:id')
  @Header('Cache-Control', 'public, max-age=60')
  review(@Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.get(id, null);
  }
}

class AdminReviewsQueryDto {
  @IsOptional() @IsIn(['reported', 'held', 'removed', 'all'])
  tab?: 'reported' | 'held' | 'removed' | 'all';

  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional() @IsUUID()
  seller?: string;

  @IsOptional() @IsUUID()
  reviewer?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000)
  offset?: number;
}

class ReasonDto {
  @IsString() @Length(3, 500)
  reason: string;
}

class DecideDto {
  @IsIn(['upheld', 'dismissed'])
  decision: 'upheld' | 'dismissed';

  @IsString() @Length(3, 500)
  note: string;
}

class BlockDto {
  @IsBoolean()
  blocked: boolean;

  @IsString() @Length(3, 500)
  reason: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(730)
  days?: number;
}

/** Admin Marketplace > Reviews: the queue (reported, held), each review with its versions, conversation and reports. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations')
@Controller('admin/classifieds')
@ProductOnly('udozo')
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('reviews')
  list(@Query() query: AdminReviewsQueryDto) {
    return this.reviews.adminList(query);
  }

  @Get('reviews/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.adminGet(id);
  }

  /** publish (a held review), remove, restore, lock or unlock. */
  @Post('reviews/:id/:action')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  moderate(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Param('action') action: string, @Body() body: ReasonDto) {
    if (!['publish', 'remove', 'restore', 'lock', 'unlock'].includes(action)) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such action.');
    return this.reviews.moderate(adminId(caller), id, action as 'publish' | 'remove' | 'restore' | 'lock' | 'unlock', body.reason);
  }

  @Post('review-posts/:id/remove')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  removePost(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.reviews.removePost(adminId(caller), id, body.reason);
  }

  @Post('review-reports/:id/decide')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  decide(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: DecideDto) {
    return this.reviews.decideReport(adminId(caller), id, body.decision, body.note);
  }

  @Post('sellers/:customer/reviews-block')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  block(@CurrentCaller() caller: Caller, @Param('customer', ParseUUIDPipe) customer: string, @Body() body: BlockDto) {
    return this.reviews.block(adminId(caller), customer, body.blocked, body.reason, body.days);
  }
}
