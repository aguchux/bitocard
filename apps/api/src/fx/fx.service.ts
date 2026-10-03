import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { EmailService } from '../notifications/email.service.js';
import { conversionsPausedEmail } from '../notifications/templates.js';
import { PaymentProviders } from '../payments/payment-providers.js';
import { providerRequest } from '../payments/provider-error.js';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export const rateSources = ['open_exchange_rates', 'flutterwave'] as const;

/** Effective rates for one currency, in units per US dollar. */
export type FxRate = {
  currency: string;
  /** Charging this currency for a USD amount (the less favourable rate for the payer, plus the margin). */
  pay: Decimal;
  /** Converting USD into this currency (the less favourable rate for the receiver, minus the margin). */
  receive: Decimal;
  marginBps: number;
  asOf: Date;
};

export const conversionUnavailable = (currency: string) =>
  new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'conversion_unavailable', `Conversions to and from ${currency} are paused. Try again later.`);

/**
 * Exchange rates. Open Exchange Rates is the reference, checked against the rates Flutterwave offers. Conversions
 * use the less favourable of the two plus an admin-set margin, so movements between quote and settlement never
 * lose money. If the sources disagree by more than the admin threshold, conversions pause and admins are alerted.
 */
@Injectable()
export class FxService {
  private readonly logger = new Logger('Fx');

  /** Admin integration settings over the environment, read fresh on every use. */
  private get config() {
    return this.integrations.config;
  }

  constructor(
    private readonly integrations: IntegrationsService,
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviders,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  /** Fetches the latest rates from every configured source, then checks them against each other. */
  async refresh() {
    const settings = await this.prisma.currencySetting.findMany();
    const currencies = settings.map(s => s.currency);
    const fetched: Record<string, number> = {};
    const errors: string[] = [];
    const now = new Date();

    if (this.config.OPEN_EXCHANGE_RATES_APP_ID) {
      try {
        const url = `${this.config.OPEN_EXCHANGE_RATES_API_URL}/latest.json?app_id=${encodeURIComponent(this.config.OPEN_EXCHANGE_RATES_APP_ID)}&symbols=${currencies.join(',')}`;
        const body = await providerRequest<{ rates: Record<string, number> }>('open_exchange_rates', url);
        for (const currency of currencies) {
          if (body.rates[currency]) await this.store(currency, 'open_exchange_rates', body.rates[currency], now);
        }
        fetched.open_exchange_rates = currencies.filter(c => body.rates[c]).length;
      } catch (error) {
        errors.push((error as Error).message);
      }
    }
    if (this.providers.flutterwave) {
      let count = 0;
      for (const currency of currencies) {
        try {
          await this.store(currency, 'flutterwave', await this.providers.flutterwave.unitsPerUsd(currency), now);
          count += 1;
        } catch (error) {
          errors.push((error as Error).message);
        }
      }
      fetched.flutterwave = count;
    }
    if (errors.length) this.logger.warn({ errors }, 'Some exchange rates could not be fetched');

    const paused: string[] = [];
    for (const setting of settings) {
      const divergence = await this.divergenceBps(setting.currency);
      if (divergence !== null && divergence > setting.divergenceBps && !setting.paused) {
        await this.pause(setting.currency, `Rate sources differ by ${(divergence / 100).toFixed(2)}% (limit ${(setting.divergenceBps / 100).toFixed(2)}%).`);
        paused.push(setting.currency);
      }
    }
    return { fetched, errors: errors.length, paused };
  }

  private store(currency: string, source: string, unitsPerUsd: number, fetchedAt: Date) {
    if (!(unitsPerUsd > 0)) throw new Error(`${source}: invalid ${currency} rate`);
    const value = new Decimal(unitsPerUsd).toDecimalPlaces(10);
    return this.prisma.exchangeRate.upsert({
      where: { currency_source: { currency, source } },
      create: { currency, source, unitsPerUsd: value, fetchedAt },
      update: { unitsPerUsd: value, fetchedAt },
    });
  }

  private async freshRates(currency: string) {
    const since = new Date(Date.now() - this.config.FX_MAX_AGE_MINUTES * 60_000);
    return this.prisma.exchangeRate.findMany({ where: { currency, fetchedAt: { gte: since } } });
  }

  /** How far apart the two fresh sources are, in basis points of the reference; null without both. */
  private async divergenceBps(currency: string) {
    const rates = await this.freshRates(currency);
    const reference = rates.find(r => r.source === 'open_exchange_rates');
    const offered = rates.find(r => r.source === 'flutterwave');
    if (!reference || !offered) return null;
    return offered.unitsPerUsd.minus(reference.unitsPerUsd).abs().div(reference.unitsPerUsd).mul(10_000).toNumber();
  }

  private async pause(currency: string, reason: string) {
    const before = await this.prisma.currencySetting.findUnique({ where: { currency } });
    const after = await this.prisma.currencySetting.update({ where: { currency }, data: { paused: true, pausedReason: reason } });
    await this.audit.record({ actorId: null, action: 'currency.paused', targetType: 'currency', targetId: currency, before, after });
    this.logger.error({ currency, reason }, 'Conversions paused');
    await this.email.send(conversionsPausedEmail(this.config.ALERT_EMAIL, currency, reason)).catch(error => this.logger.error({ err: error }, 'Could not send the alert'));
  }

  /** Current effective rates for a currency; fails if conversions are paused or no fresh rate exists. */
  async rate(currency: string): Promise<FxRate> {
    if (currency === 'USD') return { currency, pay: new Decimal(1), receive: new Decimal(1), marginBps: 0, asOf: new Date() };
    const setting = await this.prisma.currencySetting.findUnique({ where: { currency } });
    if (!setting || setting.paused) throw conversionUnavailable(currency);
    const rates = await this.freshRates(currency);
    if (rates.length === 0) throw conversionUnavailable(currency);
    const values = rates.map(r => r.unitsPerUsd);
    const highest = Decimal.max(...values);
    const lowest = Decimal.min(...values);
    const margin = new Decimal(setting.marginBps).div(10_000);
    return {
      currency,
      pay: highest.mul(new Decimal(1).plus(margin)),
      receive: lowest.mul(new Decimal(1).minus(margin)),
      marginBps: setting.marginBps,
      asOf: new Date(Math.min(...rates.map(r => r.fetchedAt.getTime()))),
    };
  }

  /** What to charge in `currency` (minor units, rounded up) for a price in US cents. Returns the rate used. */
  async chargeForUsdCents(cents: number, currency: string) {
    const rate = await this.rate(currency);
    return { amount: BigInt(rate.pay.mul(cents).toDecimalPlaces(0, Decimal.ROUND_UP).toFixed(0)), rate };
  }

  async list() {
    const settings = await this.prisma.currencySetting.findMany({ orderBy: { currency: 'asc' } });
    const data = [];
    for (const setting of settings) {
      try {
        const rate = await this.rate(setting.currency);
        data.push(presentRate(rate));
      } catch {
        data.push({ object: 'exchange_rate' as const, base: 'USD', currency: setting.currency, available: false, pay: null, receive: null, margin_percent: setting.marginBps / 100, as_of: null });
      }
    }
    return { object: 'list' as const, data };
  }

  /** Admin view: settings with each source's latest rate. */
  async adminList() {
    const settings = await this.prisma.currencySetting.findMany({ orderBy: { currency: 'asc' } });
    const rates = await this.prisma.exchangeRate.findMany();
    return {
      object: 'list' as const,
      data: settings.map(s => ({
        object: 'currency_setting' as const,
        currency: s.currency,
        margin_bps: s.marginBps,
        divergence_bps: s.divergenceBps,
        paused: s.paused,
        paused_reason: s.pausedReason,
        sources: rates.filter(r => r.currency === s.currency).map(r => ({ source: r.source, units_per_usd: r.unitsPerUsd.toString(), fetched_at: r.fetchedAt.toISOString() })),
      })),
    };
  }

  async update(actorId: string | null, currency: string, input: { margin_bps?: number; divergence_bps?: number; paused?: boolean }) {
    const before = await this.prisma.currencySetting.findUnique({ where: { currency } });
    if (!before) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such currency.');
    const after = await this.prisma.currencySetting.update({
      where: { currency },
      data: { marginBps: input.margin_bps, divergenceBps: input.divergence_bps, paused: input.paused, pausedReason: input.paused === false ? null : undefined },
    });
    await this.audit.record({ actorId, action: 'currency.updated', targetType: 'currency', targetId: currency, before, after });
    return (await this.adminList()).data.find(s => s.currency === currency);
  }
}

export function presentRate(rate: FxRate) {
  return {
    object: 'exchange_rate' as const,
    base: 'USD',
    currency: rate.currency,
    available: true,
    /** Units of the currency charged per US dollar. */
    pay: rate.pay.toDecimalPlaces(6).toString(),
    /** Units of the currency received per US dollar. */
    receive: rate.receive.toDecimalPlaces(6).toString(),
    margin_percent: rate.marginBps / 100,
    as_of: rate.asOf.toISOString(),
  };
}
