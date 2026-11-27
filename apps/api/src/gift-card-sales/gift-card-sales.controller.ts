import { Body, Controller, Get, HttpCode, HttpStatus, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import type { Request } from 'express';
import { AdminRoles, type Caller, CurrentCaller, personOf, Public, RealmOnly, resellerOf, Roles, SessionOnly } from '../auth/caller.js';
import { Mode } from '../ledger/mode.js';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { TransactionPinGuard } from '../customers/transaction-pin.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { IdentityModule } from '../identity/identity.module.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { SupplierWebhooksService } from '../orders/supplier-webhooks.js';
import { ProductOnly } from '../products/product.js';
import { SettingsModule } from '../settings/settings.module.js';
import { GiftCardSalesService } from './gift-card-sales.service.js';
import { prestmitSignatureValid } from './prestmit.js';

class OffersQueryDto {
  @IsOptional() @Matches(/^gift_cards:[A-Z]{2}:[a-z0-9-]{1,80}$/, { message: 'product must be a gift card product key' })
  product?: string;

  @IsOptional() @Matches(/^[A-Za-z]{2}$/, { message: 'country must be a 2-letter country code' })
  country?: string;

  /** The store's server names its store (none: bitocard.com). Only BitoCard's own stores sell gift cards. */
  @IsOptional() @Matches(/^[a-z0-9-]{1,63}$/, { message: 'store must be a store subdomain' })
  store?: string;
}

class QuoteDto {
  @IsUUID() offer_id: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(10_000) amount: number;
}

/** Sent as multipart/form-data: the fields as text, photos as `photos`. */
class SaleDto {
  @IsUUID() offer_id: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(10_000) amount: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) expected_payout?: number;
  @IsOptional() @IsString() @MaxLength(200) code?: string;
}

class SimulateDto {
  @IsIn(['approved', 'rejected']) outcome: 'approved' | 'rejected';
}

type Photo = { buffer: Buffer; mimetype: string; size: number; originalname: string };
const photoUpload = FilesInterceptor('photos', 20, { limits: { fileSize: 4 * 1024 * 1024 + 1, files: 20, fields: 6 } });

/** What customers of BitoCard's own stores can sell (public: says nothing about anyone; hosted stores only, so left out of the OpenAPI document). */
@ApiExcludeController()
@Public()
@Controller('store/gift-card-sales/offers')
@ProductOnly('bitocard')
export class GiftCardSellOffersController {
  constructor(private readonly sales: GiftCardSalesService) {}

  @Get()
  offers(@Query() query: OffersQueryDto) {
    return this.sales.offersFor(query.product, query.country, query.store);
  }
}

/** A customer's gift cards sold through BitoCard (sessions only). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('store/gift-card-sales')
@ProductOnly('bitocard')
export class CustomerGiftCardSalesController {
  constructor(private readonly sales: GiftCardSalesService) {}

  @Get()
  list(@CurrentCustomer() caller: CustomerCaller) {
    return this.sales.list(caller.customer);
  }

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  quote(@CurrentCustomer() caller: CustomerCaller, @Body() body: QuoteDto) {
    return this.sales.quote(caller.customer, body.offer_id, body.amount);
  }

  @Post()
  @UseGuards(TransactionPinGuard)
  @UseInterceptors(photoUpload)
  create(@CurrentCustomer() caller: CustomerCaller, @Body() body: SaleDto, @UploadedFiles() files: Photo[] = []) {
    return this.sales.create(
      caller.customer,
      body,
      files.map(file => ({ name: file.originalname, type: file.mimetype, data: file.buffer })),
    );
  }

  @Get(':id')
  get(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.get(caller.customer, id);
  }

  /** BitoCard's sandbox only. */
  @Post(':id/simulate')
  @HttpCode(HttpStatus.OK)
  simulate(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SimulateDto) {
    return this.sales.simulate(caller.customer, id, body.outcome);
  }
}

/** Buy back on a reseller's stores: whether it is open, their cut and their customers' sales (SHQ sessions only). */
@ApiExcludeController()
@SessionOnly()
@Roles('admin', 'finance', 'support')
@Controller('gift-card-sales')
@ProductOnly('bitocard')
export class ResellerGiftCardSalesController {
  constructor(private readonly sales: GiftCardSalesService) {}

  @Get('buy-back')
  buyBack(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    return this.sales.resellerBuyBack(resellerOf(caller), mode);
  }
}

/**
 * Prestmit's trade notifications: signature-checked, then the trade is read back from Prestmit. Sell trades are
 * customers' gift card sales; buy trades are supplier orders, stored and checked like any supplier's notification.
 */
@ApiExcludeController()
@Public()
@SkipIdempotency()
@Controller('webhooks/prestmit')
@ProductOnly('bitocard')
export class PrestmitWebhookController {
  constructor(
    private readonly sales: GiftCardSalesService,
    private readonly integrations: IntegrationsService,
    private readonly modules: ModuleRef,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  receive(@Req() req: Request & { rawBody?: Buffer }) {
    if (!prestmitSignatureValid(this.integrations.config.PRESTMIT_WEBHOOK_SECRET, req.rawBody, req.get('x-prestmit-signature'))) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'signature_invalid', 'The signature does not match.');
    }
    let payload: unknown = null;
    try {
      payload = JSON.parse(req.rawBody!.toString('utf8'));
    } catch {
      return { received: true };
    }
    const event = (payload as { event?: unknown } | null)?.event;
    if (typeof event === 'string' && event.startsWith('giftcard-trade.buy.')) {
      return this.modules.get(SupplierWebhooksService, { strict: false }).receivePrestmitBuy(req.rawBody!, payload);
    }
    return this.sales.notified(payload);
  }
}

class AdminSalesQueryDto {
  @IsOptional() @IsIn(['submitting', 'pending', 'completed', 'rejected', 'failed']) status?: string;
  @IsOptional() @IsIn(['live', 'test']) mode?: LedgerMode;
}

class AdminOffersQueryDto {
  @IsOptional() @IsIn(['live', 'test']) mode?: LedgerMode;
}

class OfferUpdateDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @ValidateIf((_, value) => value !== null) @Matches(/^[a-z0-9-]{1,80}$/) brand?: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(0) @Max(5000) margin_bps?: number | null;
}

/** Admins: the cards Prestmit buys (brand, margin, on or off) and customers' sales. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/gift-card-sales')
@ProductOnly('bitocard')
export class AdminGiftCardSalesController {
  constructor(private readonly sales: GiftCardSalesService) {}

  @Get()
  @AdminRoles('operations', 'finance', 'support')
  list(@Query() query: AdminSalesQueryDto) {
    return this.sales.adminSales(query);
  }

  @Get('offers')
  @AdminRoles('operations', 'finance', 'support')
  offers(@Query() query: AdminOffersQueryDto) {
    return this.sales.adminOffers(query.mode);
  }

  @Post('offers/sync')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  sync() {
    return this.sales.sync();
  }

  @Patch('offers/:id')
  @AdminRoles('operations', 'finance')
  update(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: OfferUpdateDto) {
    return this.sales.updateOffer(personOf(caller), id, body);
  }
}

@Module({
  imports: [CheckoutModule, IdentityModule, SettingsModule],
  controllers: [GiftCardSellOffersController, CustomerGiftCardSalesController, ResellerGiftCardSalesController, PrestmitWebhookController, AdminGiftCardSalesController],
  providers: [GiftCardSalesService],
  exports: [GiftCardSalesService],
})
export class GiftCardSalesModule {}
