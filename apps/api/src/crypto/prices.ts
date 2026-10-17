import { Injectable, Logger } from '@nestjs/common';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { coinIds, fetchPrices, freshMs, liveMs, marketMaxAgeMs, priceFields, staleMs, type UsdPrice } from './price-feed.js';

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

  constructor(private readonly integrations: IntegrationsService) {}

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
    return prices;
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
  }
}

/** Whether the exchange may trade on a price: fetched within the minute and updated by CoinGecko within five. */
export function isLive(price: UsdPrice, now = Date.now()) {
  return now - price.at < liveMs && price.updatedAt !== null && now - price.updatedAt < marketMaxAgeMs;
}
