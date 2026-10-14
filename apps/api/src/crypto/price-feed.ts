import type { IntegrationField } from '../integrations/definitions.js';
import type { IntegrationLink } from '../integrations/links.js';

/**
 * Crypto prices in US dollars from CoinGecko, for pricing promotions paid in coins that are not dollar stablecoins
 * (Spin and win's BNB). A free demo key raises the rate limit; a Pro key (with the Pro API address) is used as such.
 * Never used to move customers' money at a rate: only to size BitoCard's own rewards.
 */
export const priceFields: IntegrationField[] = [
  { key: 'COINGECKO_API_KEY', label: 'API key', secret: true, kind: 'text', required: false, help: 'CoinGecko > Developer dashboard > API keys. A free Demo key works; without one the public rate limit applies.' },
  { key: 'COINGECKO_API_URL', label: 'API address', secret: false, kind: 'url', required: false, help: 'Leave empty for https://api.coingecko.com. A Pro key needs https://pro-api.coingecko.com.' },
];

export const priceLinks: IntegrationLink[] = [
  { label: 'Get a key', url: 'https://www.coingecko.com/en/api/pricing' },
  { label: 'API docs', url: 'https://docs.coingecko.com/reference/simple-price' },
];

/** CoinGecko's ids for the coins BitoCard holds that are not priced at $1. */
export const coinIds: Record<string, string> = { BNB: 'binancecoin', BTC: 'bitcoin', ETH: 'ethereum' };
/** A price this recent is used without asking again. */
export const freshMs = 5 * 60_000;
/** A price older than this is never used: the reward falls back to a stablecoin instead. */
export const staleMs = 30 * 60_000;

/** A US dollar price as an integer number of 1e-8 dollars (exact maths with BigInt). */
export type UsdPrice = { asset: string; e8: bigint; text: string; at: number };

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
    res = await fetch(`${base}/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`, { headers, signal: AbortSignal.timeout(10_000), redirect: 'error' });
  } catch (error) {
    throw new Error(`unreachable (${error instanceof Error ? error.name : 'error'})`);
  }
  if (res.status === 401 || res.status === 403) throw new Error(`refused the API key (HTTP ${res.status})`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, { usd?: number }>;
  const at = Date.now();
  const prices: UsdPrice[] = [];
  for (const asset of assets) {
    const usd = body?.[coinIds[asset]]?.usd;
    const e8 = typeof usd === 'number' ? priceE8(usd) : null;
    if (e8) prices.push({ asset, e8, text: usd!.toFixed(8).replace(/\.?0+$/, ''), at });
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
