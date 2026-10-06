import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { type LedgerMode, Prisma, type Product, type Quote } from '../generated/prisma/client.js';
import { minor } from '../ledger/mode.js';
import type { RecipientCheck } from '../suppliers/adapter.js';
import { stockSupplier } from '../suppliers/stock.adapter.js';
import { SupplierAdapters } from '../suppliers/supplier-adapters.js';
import { TaxService } from '../tax/tax.service.js';
import { offersInclude } from './catalogue.service.js';
import { exactFeeNano, maxFeeMinor } from '../fees/platform-fees.service.js';
import { connectable } from '../reseller-integrations/connectable.js';
import { OwnSuppliersService } from '../reseller-integrations/own-suppliers.service.js';
import { type PricedOffer, PricingService } from './pricing.service.js';

/** How long a quote price is held. */
export const quoteLifetimeMs = 10 * 60 * 1000;
export const maxQuantity = 10;
/** Categories bought several at a time (each unit is its own code). */
const multiples = new Set(['gift_cards', 'software']);
/** Sandbox smartcard or meter number that is never recognised, for testing the failure. */
export const sandboxUnknownAccount = '0000000000';

export type QuoteInput = {
  product_id: string;
  face_value: number;
  quantity?: number;
  recipient?: { phone?: string; account_number?: string; transaction_type?: 'change' | 'renew' };
  customer_reference?: string;
};

type RecipientRecord = { phone?: string; account_number?: string; account_name?: string; [detail: string]: string | undefined };

/** A rate in parts per billion as a percentage string (exact). */
const percent = (ratePpb: number) => (ratePpb / 10_000_000).toFixed(7).replace(/\.?0+$/, '');

const invalid = (message: string, param: string, code = 'parameter_invalid') => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);

export function presentQuote(quote: Quote & { product: Product }, now = new Date()) {
  const recipient = (quote.recipient ?? null) as RecipientRecord | null;
  const unitWholesale = quote.wholesaleMinor / BigInt(quote.quantity);
  return {
    object: 'quote' as const,
    id: quote.id,
    mode: quote.mode,
    status: quote.status === 'open' && quote.expiresAt <= now ? 'expired' : quote.status,
    product: { id: quote.product.id, name: quote.product.name, category: quote.product.category },
    face_value: minor(quote.faceValueMinor),
    face_currency: quote.faceCurrency,
    quantity: quote.quantity,
    currency: quote.currency,
    /** What BitoCard charges your wallet, for the whole quantity. */
    wholesale: minor(quote.wholesaleMinor),
    unit_wholesale: minor(unitWholesale),
    /** What the customer pays, tax included. */
    price: minor(quote.priceMinor),
    tax: quote.taxName ? { name: quote.taxName, rate_percent: (quote.taxRateBps ?? 0) / 100, amount: minor(quote.taxMinor) } : null,
    reseller_profit: minor(quote.resellerProfitMinor),
    /** `own`: fulfilled through your own supplier account; BitoCard charges only its fee. */
    source: quote.source as 'bitocard' | 'own',
    integration: quote.source === 'own' ? { id: quote.supplierCode, name: connectable(quote.supplierCode)?.name ?? quote.supplierCode } : null,
    /** Own supplier: BitoCard's fee, at most this, taken from your wallet (fractions are carried, never rounded up). */
    bitocard_fee: quote.source === 'own' ? { rate_percent: percent(quote.feeRatePpb ?? 0), max: minor(quote.feeMaxMinor ?? 0n) } : null,
    recipient,
    customer_reference: quote.customerReference,
    expires_at: quote.expiresAt.toISOString(),
    created_at: quote.createdAt.toISOString(),
  };
}

/**
 * Quotes lock a price for a short time: product, face value, quantity, the exchange rate, tax and the reseller
 * margin. Pay-TV and bills numbers are validated first, so the customer can confirm the account name.
 */
@Injectable()
export class QuotesService {
  private readonly logger = new Logger('Quotes');

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly adapters: SupplierAdapters,
    private readonly tax: TaxService,
    private readonly own: OwnSuppliersService,
  ) {}

  async create(resellerId: string, mode: LedgerMode, input: QuoteInput) {
    const ctx = await this.pricing.context(resellerId, mode);
    const product = await this.prisma.product.findUnique({ where: { id: input.product_id }, include: offersInclude });
    if (!product) throw invalid('No such product.', 'product_id', 'resource_missing');
    const reason = this.pricing.unavailableReason(ctx, product);
    if (reason) throw reason;

    const face = BigInt(input.face_value);
    if (product.denominationType === 'fixed' ? !product.fixedValues.includes(face) : face < (product.minValueMinor ?? 1n) || face > (product.maxValueMinor ?? face)) {
      throw invalid('This face value is not offered for the product.', 'face_value');
    }
    const quantity = input.quantity ?? 1;
    if (quantity > 1 && !multiples.has(product.category)) throw invalid('Only gift cards and software licences can be bought several at a time; quote each top-up or payment separately.', 'quantity');
    const recipient: RecipientRecord = {};
    if (product.recipientType === 'phone') recipient.phone = this.phone(product, input.recipient?.phone);
    if (product.recipientType === 'smartcard' || product.recipientType === 'meter') {
      const number = input.recipient?.account_number?.trim();
      if (!number) throw invalid(`recipient.account_number is required (the ${product.recipientType} number).`, 'recipient.account_number');
      recipient.account_number = number;
      if (input.recipient?.phone) recipient.phone = this.phone(product, input.recipient.phone);
    }
    if (product.category === 'pay_tv') recipient.transaction_type = input.recipient?.transaction_type ?? 'change';

    let priced = await this.pricing.choose(ctx, product, face);
    if (priced.offer.supplierCode === stockSupplier && mode === 'live') {
      // BitoCard's own stock can only sell the codes it holds; another supplier may still cover the rest.
      const inStock = await this.prisma.stockCode.count({ where: { offerId: priced.offer.id, status: 'available' } });
      if (inStock < quantity) {
        priced = await this.pricing.price(ctx, product, face, new Set([stockSupplier])).catch(() => {
          throw new ApiError(HttpStatus.CONFLICT, 'invalid_request_error', 'insufficient_stock', `Only ${inStock} left. Lower the quantity.`, 'quantity');
        });
      }
    }
    const own = priced.source === 'own' && priced.fee ? priced.fee : null;
    // Some mobile money providers take whole amounts only.
    if ((priced.offer.meta as { whole_units?: boolean } | null)?.whole_units && face % 100n !== 0n) throw invalid('This provider takes whole amounts only.', 'face_value');
    if (recipient.account_number) Object.assign(recipient, await this.checkAccount(mode, product, priced.offer, recipient.account_number, resellerId, Boolean(own)));

    const net = priced.price * BigInt(quantity);
    // Own supplier: the fee is on the whole order (rounded once), so the wholesale price is cost plus that fee.
    const feeBase = own ? own.baseMinor * BigInt(quantity) : null;
    const feeMax = own && feeBase !== null ? maxFeeMinor(exactFeeNano(feeBase, own.ratePpb), own.minFeeMinor) : null;
    const wholesale = own && feeMax !== null ? priced.cost * BigInt(quantity) + feeMax : priced.wholesale * BigInt(quantity);
    let price = net;
    let taxAmount = 0n;
    let tax: { name: string; rateBps: number } | null = null;
    // The reseller is the seller of record for sales through their own supplier: BitoCard adds no tax.
    if (!own && ctx.country.categories.some(c => c.category === product.category && c.taxable)) {
      const breakdown = await this.tax.calculate(ctx.country.code, net, mode);
      price = breakdown.gross;
      taxAmount = breakdown.tax;
      tax = { name: breakdown.name, rateBps: breakdown.rateBps };
    }
    const profit = price - taxAmount - wholesale;
    if (profit < 0n) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'price_below_cost', 'Your price does not cover wholesale cost and tax. Raise your markup for this product.');
    }

    const quote = await this.prisma.quote.create({
      data: {
        resellerId,
        mode,
        productId: product.id,
        quantity,
        faceValueMinor: face,
        faceCurrency: product.faceCurrency,
        currency: ctx.currency,
        wholesaleMinor: wholesale,
        priceMinor: price,
        taxMinor: taxAmount,
        taxName: tax?.name ?? null,
        taxRateBps: tax?.rateBps ?? null,
        resellerProfitMinor: profit,
        supplierCode: priced.offer.supplierCode,
        supplierProductId: priced.offer.id,
        supplierCostMinor: priced.supplierCost * BigInt(quantity),
        supplierCurrency: priced.offer.costCurrency,
        fxRate: priced.fxRate,
        recipient: Object.keys(recipient).length ? (recipient as Prisma.InputJsonValue) : Prisma.JsonNull,
        customerReference: input.customer_reference ?? null,
        source: priced.source,
        connectionId: priced.connectionId ?? null,
        feeRuleId: own?.ruleId ?? null,
        feeRatePpb: own?.ratePpb ?? null,
        feeBaseMinor: feeBase,
        feeMinMinor: own?.minFeeMinor ?? null,
        feeMaxMinor: feeMax,
        expiresAt: new Date(Date.now() + quoteLifetimeMs),
      },
      include: { product: true },
    });
    return presentQuote(quote);
  }

  async get(resellerId: string, mode: LedgerMode, id: string) {
    const quote = await this.prisma.quote.findFirst({ where: { id, resellerId, mode }, include: { product: true } });
    if (!quote) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such quote.');
    return presentQuote(quote);
  }

  /** A mobile number for the product country, in international format. */
  private phone(product: Product, phone: string | undefined) {
    if (!phone) throw invalid('recipient.phone is required for this product.', 'recipient.phone');
    const parsed = parsePhoneNumberFromString(phone, product.country as CountryCode);
    if (!parsed?.isValid() || parsed.country !== product.country) {
      throw invalid(`recipient.phone must be a valid ${product.country} mobile number.`, 'recipient.phone');
    }
    return parsed.number;
  }

  /** Validates a smartcard or meter number with the routed supplier (simulated in the sandbox). */
  private async checkAccount(mode: LedgerMode, product: Product, offer: PricedOffer, accountNumber: string, resellerId: string, own: boolean) {
    let check: RecipientCheck;
    if (mode === 'test') {
      check =
        accountNumber === sandboxUnknownAccount
          ? { valid: false, reason: 'The number was not recognised.' }
          : { valid: true, accountName: 'SANDBOX CUSTOMER', details: product.recipientType === 'smartcard' ? { current_package: product.name } : {} };
    } else {
      // The reseller's own account checks numbers for their own orders.
      const adapter = own ? await this.own.adapterFor(resellerId, offer.supplierCode) : this.adapters.get(offer.supplierCode);
      if (!adapter?.validateRecipient) {
        check = { valid: true, accountName: '', details: {} };
      } else {
        try {
          check = await adapter.validateRecipient((offer.meta ?? {}) as Record<string, unknown>, accountNumber);
        } catch (error) {
          this.logger.warn({ err: error, productId: product.id }, 'Account check failed');
          throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'recipient_check_unavailable', 'The number could not be checked right now. Try again shortly.');
        }
      }
    }
    if (!check.valid) throw invalid(check.reason, 'recipient.account_number', 'recipient_invalid');
    return { account_name: check.accountName || undefined, ...check.details };
  }
}
