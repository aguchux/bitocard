import { Injectable, Logger } from '@nestjs/common';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { coinIds, defaultDivergenceBps, divergenceBps, fetchPrices, freshMs, liveMs, marketMaxAgeMs, priceFields, secondaryPrice, staleMs, type UsdPrice } from './price-feed.js';

export { unitsForCents } from './price-feed.js';

/**
 * Crypto prices in US dollars (CoinGecko, `price-feed.ts`). Promotions (`usd`) use one up to five minutes old and never
 * once 30 minutes old. The exchange (`live`) asks again once its price is a minute old and never trades on a price
 * CoinGecko last updated more than five minutes ago, nor falls back to an older one.
 */
@Injectable()
export class CryptoPricesService {
  private readonly logger = new Logger('CryptoPrices');
  private readonly cache = new Map<string, UsdPrice>();
  /** Coinbase's prices, asked at most once a minute per coin. */
  private readonly second = new Map<string, { e8: bigint | null; at: number }>();

  constructor(
    private readonly integrations: IntegrationsService,
    private readonly inbox: InboxService,
  ) {}

  /** A coin's US dollar price, at most 30 minutes old, or null when none can be had (the caller pays another way). */
  async usd(asset: string): Promise<UsdPrice | null> {
    if (!coinIds[asset]) return null;
    const cached = this.cache.get(asset);
    if (cached && Date.now() - cached.at < freshMs) return cached;
    await this.fetch([asset]);
    const latest = this.cache.get(asset);
    return latest && Date.now() - latest.at < staleMs ? latest : null;
  }

  /**
   * Live market prices for the exchange: each at most a minute old (fetched together when any is older), and only
   * while CoinGecko's own update is recent. A coin without one is missing from the map: its pair is closed.
   */
  async live(assets: string[]): Promise<Map<string, UsdPrice>> {
    const known = assets.filter(asset => coinIds[asset]);
    const due = known.filter(asset => {
      const cached = this.cache.get(asset);
      return !cached || Date.now() - cached.at >= liveMs;
    });
    if (due.length) await this.fetch(due);
    const prices = new Map<string, UsdPrice>();
    for (const asset of known) {
      const price = this.cache.get(asset);
      if (price && isLive(price)) prices.set(asset, price);
    }
    await this.crossCheck(prices);
    return prices;
  }

  /**
   * With the Coinbase check on, a coin whose CoinGecko price is further than the set divergence from Coinbase's is
   * left out (its pair closes) and operations are told, once an hour per coin. A coin Coinbase does not price is
   * decided by CoinGecko alone.
   */
  private async crossCheck(prices: Map<string, UsdPrice>) {
    const values = this.integrations.values(priceFields.map(field => field.key));
    if (!['true', 'on', '1'].includes(String(values.CRYPTO_PRICE_SECONDARY ?? '').toLowerCase())) return;
    const limit = Number(values.CRYPTO_PRICE_DIVERGENCE_BPS) > 0 ? Number(values.CRYPTO_PRICE_DIVERGENCE_BPS) : defaultDivergenceBps;
    for (const [asset, price] of [...prices]) {
      let second = this.second.get(asset);
      if (!second || Date.now() - second.at >= liveMs) {
        second = { e8: await secondaryPrice(values, asset), at: Date.now() };
        this.second.set(asset, second);
      }
      if (second.e8 === null) continue;
      const gap = divergenceBps(price.e8, second.e8);
      if (gap <= limit) continue;
      prices.delete(asset);
      this.logger.warn({ asset, coingecko: price.text, gap }, 'Exchange price sources disagree');
      await this.inbox.admins('admin.exchange.price_divergence', {
        subject: `${asset}:${new Date().toISOString().slice(0, 13)}`,
        title: `${asset} exchange paused: prices disagree`,
        body: `CoinGecko and Coinbase differ by ${(gap / 100).toFixed(2)}% (more than ${(limit / 100).toFixed(2)}%). ${asset} trading resumes once they agree.`,
        link: '/crypto/exchange',
      });
    }
  }

  private async fetch(assets: string[]) {
    try {
      for (const price of await fetchPrices(this.integrations.values(priceFields.map(field => field.key)), assets)) this.cache.set(price.asset, price);
    } catch (error) {
      this.logger.warn({ err: error, assets }, 'Could not read crypto prices');
    }
  }

  /** Forgets cached prices (tests). */
  forget() {
    this.cache.clear();
    this.second.clear();
  }
}

/** Whether the exchange may trade on a price: fetched within the minute and updated by CoinGecko within five. */
export function isLive(price: UsdPrice, now = Date.now()) {
  return now - price.at < liveMs && price.updatedAt !== null && now - price.updatedAt < marketMaxAgeMs;
}
