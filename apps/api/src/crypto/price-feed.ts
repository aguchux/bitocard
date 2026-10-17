import type { IntegrationField } from '../integrations/definitions.js';
import type { IntegrationLink } from '../integrations/links.js';

/**
 * Crypto prices in US dollars from CoinGecko: the market base of every coin on the instant exchange (stablecoins
 * included, never assumed to be $1; BitoCard only adds its markup), and the size of Spin and win's BNB rewards. A free
 * demo key raises the rate limit; a Pro key (with the Pro API address) is used as such.
 */
export const priceFields: IntegrationField[] = [
  { key: 'COINGECKO_API_KEY', label: 'API key', secret: true, kind: 'text', required: false, help: 'CoinGecko > Developer dashboard > API keys. A free Demo key works; without one the public rate limit applies.' },
  { key: 'COINGECKO_API_URL', label: 'API address', secret: false, kind: 'url', required: false, help: 'Leave empty for https://api.coingecko.com. A Pro key needs https://pro-api.coingecko.com.' },
];

export const priceLinks: IntegrationLink[] = [
  { label: 'Get a key', url: 'https://www.coingecko.com/en/api/pricing' },
  { label: 'API docs', url: 'https://docs.coingecko.com/reference/simple-price' },
];

/** CoinGecko's ids for every coin BitoCard holds. */
export const coinIds: Record<string, string> = {
  USDT: 'tether',
  USDC: 'usd-coin',
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  POL: 'polygon-ecosystem-token',
  TRX: 'tron',
  LTC: 'litecoin',
  DOGE: 'dogecoin',
};
/** A price this recent is used without asking again (promotions). */
export const freshMs = 5 * 60_000;
/** A price older than this is never used: the reward falls back to a stablecoin instead. */
export const staleMs = 30 * 60_000;
/** The exchange asks again once its price is a minute old. */
export const liveMs = 60_000;
/** The exchange never trades on a price CoinGecko itself last updated longer ago than this. */
export const marketMaxAgeMs = 5 * 60_000;

/**
 * A US dollar price as an integer number of 1e-8 dollars (exact maths with BigInt). `at` is when BitoCard fetched it,
 * `updatedAt` when CoinGecko last updated it (null when it did not say), `change24h` its 24-hour change in per cent.
 */
export type UsdPrice = { asset: string; e8: bigint; text: string; at: number; updatedAt: number | null; change24h: number | null };

export function priceE8(value: number): bigint | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const [whole, fraction = ''] = value.toFixed(8).split('.');
  const e8 = BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0').slice(0, 8));
  return e8 > 0n ? e8 : null;
}

/** Base units of a coin worth `cents` US cents at `price`, rounded down. */
export function unitsForCents(cents: number, decimals: number, price: bigint) {
  return (BigInt(cents) * 10n ** BigInt(decimals) * 100_000_000n) / (100n * price);
}

export async function fetchPrices(values: Record<string, string | undefined>, assets: string[]) {
  const base = (values.COINGECKO_API_URL || 'https://api.coingecko.com').replace(/\/+$/, '');
  const ids = assets.map(asset => coinIds[asset]).filter(Boolean);
  const key = values.COINGECKO_API_KEY;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (key) headers[base.includes('pro-api') ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key'] = key;
  let res: Response;
  try {
    const query = `ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`;
    res = await fetch(`${base}/api/v3/simple/price?${query}`, { headers, signal: AbortSignal.timeout(10_000), redirect: 'error' });
  } catch (error) {
    throw new Error(`unreachable (${error instanceof Error ? error.name : 'error'})`);
  }
  if (res.status === 401 || res.status === 403) throw new Error(`refused the API key (HTTP ${res.status})`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, { usd?: number; usd_24h_change?: number; last_updated_at?: number }>;
  const at = Date.now();
  const prices: UsdPrice[] = [];
  for (const asset of assets) {
    const row = body?.[coinIds[asset]];
    const usd = row?.usd;
    const e8 = typeof usd === 'number' ? priceE8(usd) : null;
    if (!e8) continue;
    const change = row?.usd_24h_change;
    const updated = row?.last_updated_at;
    prices.push({
      asset,
      e8,
      text: usd!.toFixed(8).replace(/\.?0+$/, ''),
      at,
      updatedAt: typeof updated === 'number' && updated > 0 ? updated * 1000 : null,
      change24h: typeof change === 'number' && Number.isFinite(change) ? Math.round(change * 100) / 100 : null,
    });
  }
  return prices;
}

/** Test connection: BNB's price now. */
export async function checkPrices(values: Record<string, string | undefined>) {
  try {
    const [bnb] = await fetchPrices(values, ['BNB']);
    if (!bnb) return { environment: 'live' as const, ok: false, message: 'CoinGecko answered without a BNB price.', chains: [] };
    return { environment: 'live' as const, ok: true, message: `BNB is $${bnb.text}.`, chains: [] };
  } catch (error) {
    return { environment: 'live' as const, ok: false, message: `CoinGecko ${error instanceof Error ? error.message : 'failed'}.`, chains: [] };
  }
}
