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
  {
    key: 'CRYPTO_PRICE_SECONDARY',
    label: 'Check against Coinbase',
    secret: false,
    kind: 'flag',
    required: false,
    help: 'On: every exchange price is also read from Coinbase’s public spot prices; a coin whose two prices differ by more than the divergence below is paused and operations are told.',
  },
  { key: 'CRYPTO_PRICE_DIVERGENCE_BPS', label: 'Largest divergence (basis points)', secret: false, kind: 'number', required: false, help: 'Default 100 (1%).' },
  { key: 'COINBASE_PRICE_URL', label: 'Coinbase address', secret: false, kind: 'url', required: false, help: 'Leave empty for https://api.coinbase.com.' },
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

/** The default largest difference between CoinGecko's and Coinbase's prices before a coin's exchange pair pauses. */
export const defaultDivergenceBps = 100;

/**
 * Coinbase's public spot price of a coin in US dollars (`/v2/prices/<COIN>-USD/spot`, no key), the second opinion on
 * CoinGecko for the exchange. Null when Coinbase does not price the coin or cannot be reached: then CoinGecko alone
 * decides, as without the check.
 */
export async function secondaryPrice(values: Record<string, string | undefined>, asset: string): Promise<bigint | null> {
  const base = (values.COINBASE_PRICE_URL || 'https://api.coinbase.com').replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/v2/prices/${encodeURIComponent(asset)}-USD/spot`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { amount?: string } };
    const amount = Number(body?.data?.amount);
    return priceE8(amount);
  } catch {
    return null;
  }
}

/** How far apart two prices are, in basis points of the second. */
export function divergenceBps(a: bigint, b: bigint) {
  const gap = a > b ? a - b : b - a;
  return Number((gap * 10_000n) / b);
}
