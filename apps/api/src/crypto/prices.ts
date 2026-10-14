import { Injectable, Logger } from '@nestjs/common';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { coinIds, fetchPrices, freshMs, priceFields, staleMs, type UsdPrice } from './price-feed.js';

export { unitsForCents } from './price-feed.js';

/** Crypto prices in US dollars (CoinGecko, `price-feed.ts`), cached five minutes and never used once 30 minutes old. */
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
    try {
      const [price] = await fetchPrices(this.integrations.values(priceFields.map(field => field.key)), [asset]);
      if (price) {
        this.cache.set(asset, price);
        return price;
      }
    } catch (error) {
      this.logger.warn({ err: error, asset }, 'Could not read a crypto price');
    }
    return cached && Date.now() - cached.at < staleMs ? cached : null;
  }

  /** Forgets cached prices (tests). */
  forget() {
    this.cache.clear();
  }
}
