import type { AppConfig } from '../config/config.js';

/**
 * Live and sandbox addresses of the providers BitoCard calls, so an integration's Sandbox switch (Settings >
 * Integrations) picks the address by itself. An API address set to anything but the live default (an admin's own
 * value, or a test's fake) overrides both.
 *
 * Sandbox is for checking credentials before going live: an integration switched to its sandbox is never used for
 * BitoCard's live orders, syncs or payments (it serves BitoCard's own sandbox only), so sandbox products and payments
 * can never reach real customers or wallets.
 */
export type Environment = 'live' | 'sandbox';

type Address = { key: keyof AppConfig; live: string; sandbox: string };

const addresses: Record<string, Address[]> = {
  reloadly: [
    { key: 'RELOADLY_GIFTCARDS_URL', live: 'https://giftcards.reloadly.com', sandbox: 'https://giftcards-sandbox.reloadly.com' },
    { key: 'RELOADLY_TOPUPS_URL', live: 'https://topups.reloadly.com', sandbox: 'https://topups-sandbox.reloadly.com' },
  ],
  vtpass: [{ key: 'VTPASS_API_URL', live: 'https://vtpass.com/api', sandbox: 'https://sandbox.vtpass.com/api' }],
  didww: [{ key: 'DIDWW_API_URL', live: 'https://api.didww.com/v3', sandbox: 'https://sandbox-api.didww.com/v3' }],
  zendit: [{ key: 'ZENDIT_API_URL', live: 'https://api.zendit.io/v1', sandbox: 'https://test-api.zendit.io/v1' }],
  pawapay: [{ key: 'PAWAPAY_API_URL', live: 'https://api.pawapay.io', sandbox: 'https://api.sandbox.pawapay.io' }],
  monnify: [{ key: 'MONNIFY_API_URL', live: 'https://api.monnify.com', sandbox: 'https://sandbox.monnify.com' }],
  // Flutterwave test keys use the live address.
  flutterwave: [{ key: 'FLUTTERWAVE_API_URL', live: 'https://api.flutterwave.com/v3', sandbox: 'https://api.flutterwave.com/v3' }],
  // Stripe test keys (sk_test_…) use the live address too.
  stripe: [{ key: 'STRIPE_API_URL', live: 'https://api.stripe.com', sandbox: 'https://api.stripe.com' }],
};

/** Each integration's Sandbox switch. */
export const sandboxSwitches = {
  reloadly: 'RELOADLY_SANDBOX',
  vtpass: 'VTPASS_SANDBOX',
  didww: 'DIDWW_SANDBOX',
  zendit: 'ZENDIT_SANDBOX',
  pawapay: 'PAWAPAY_SANDBOX',
  monnify: 'MONNIFY_SANDBOX',
  flutterwave: 'FLUTTERWAVE_SANDBOX',
  stripe: 'STRIPE_SANDBOX',
} as const satisfies Record<string, keyof AppConfig>;

type Config = Partial<Record<keyof AppConfig, unknown>>;

/** Whether BitoCard's own account with this integration is switched to the provider's sandbox. */
export function inSandbox(config: Config, id: string) {
  const key = sandboxSwitches[id as keyof typeof sandboxSwitches];
  return Boolean(key && config[key] === true);
}

/** One provider address for an environment: an override when set, otherwise the live or sandbox address. */
function resolve(config: Config, address: Address, environment: Environment) {
  const set = config[address.key];
  if (typeof set === 'string' && set !== address.live) return set;
  return environment === 'sandbox' ? address.sandbox : address.live;
}

/** An integration's main address in an environment (`providerUrl(config, 'pawapay', 'sandbox')`). */
export function providerUrl(config: Config, id: string, environment: Environment) {
  const [address] = addresses[id] ?? [];
  if (!address) throw new Error(`No addresses for ${id}`);
  return resolve(config, address, environment);
}

/** Every provider address in one environment, in the configuration's names (what credential checks read). */
export function urlsFor<T extends Config>(config: T, environment: Environment): T {
  const urls: Config = { ...config };
  for (const list of Object.values(addresses)) for (const address of list) urls[address.key] = resolve(config, address, environment);
  return urls as T;
}

/** BitoCard's own addresses: each integration in the environment its Sandbox switch says. */
export function ownUrls<T extends Config>(config: T): T {
  const urls: Config = { ...config };
  for (const [id, list] of Object.entries(addresses)) for (const address of list) urls[address.key] = resolve(config, address, inSandbox(config, id) ? 'sandbox' : 'live');
  return urls as T;
}
