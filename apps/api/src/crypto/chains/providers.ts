import { createHmac, timingSafeEqual } from 'node:crypto';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { IntegrationField } from '../../integrations/definitions.js';
import type { IntegrationLink } from '../../integrations/links.js';
import { BitcoinRpcClient, BlockCypherClient, type Chain, type ChainClient, type Endpoint, EsploraClient, EvmClient, SolanaClient, TronClient } from './client.js';

/**
 * The blockchain providers BitoCard rents to read chains (Settings > Integrations > Blockchain). Each is an
 * integration whose credentials an admin sets, with a Sandbox switch that points it at the chains' test networks
 * (serving sandbox stores) instead of the main networks (live). Providers only read and broadcast; they never hold
 * BitoCard's keys. Fields are named `<PROVIDER>_<FIELD>`, stored like any secret, admin-set only.
 *
 * Addresses and signature schemes follow each provider's published documentation; confirm them against the account
 * before relying on a provider for live deposits (as for suppliers).
 */
export type ChainProviderValues = Record<string, string | undefined>;
type Environment = 'live' | 'sandbox';

export type ChainProvider = {
  id: string;
  name: string;
  description: string;
  fields: IntegrationField[];
  links: IntegrationLink[];
  /** The chains it serves, and how to reach each in an environment (null: not offered there or not set up). */
  endpoints: (values: ChainProviderValues, environment: Environment) => Partial<Record<Chain, ChainClient | null>>;
  /** Checks a webhook's signature with the provider's secret; providers without webhooks have none. */
  verify?: (input: { headers: Record<string, string | undefined>; body: string; url: URL }, values: ChainProviderValues) => boolean;
  /** How the provider is told where to send webhooks (shown on its card). */
  webhookHelp?: string;
};

const field = (key: string, label: string, options: Partial<IntegrationField> = {}): IntegrationField => ({ key, label, secret: false, kind: 'text', required: false, ...options });
const secret = (key: string, label: string, help?: string, required = true): IntegrationField => field(key, label, { secret: true, required, help });
const url = (key: string, label: string, help?: string): IntegrationField => field(key, label, { secret: true, kind: 'url', help });
const flag = (key: string, label: string, help: string): IntegrationField => field(key, label, { kind: 'flag', help });
const sandbox = (id: string, help: string) => flag(`${id}_SANDBOX`, 'Sandbox (test networks)', help);
const enabled = (id: string) => flag(`${id}_ENABLED`, 'Use this provider', 'On: BitoCard reads the chain through it (it needs no account).');

const evm = (endpoint: Endpoint | null) => (endpoint ? new EvmClient(endpoint) : null);
const tron = (endpoint: Endpoint | null) => (endpoint ? new TronClient(endpoint) : null);
const solana = (endpoint: Endpoint | null) => (endpoint ? new SolanaClient(endpoint) : null);
const bitcoinRpc = (endpoint: Endpoint | null) => (endpoint ? new BitcoinRpcClient(endpoint) : null);
/** An endpoint from a pasted address (null when not set). */
const pasted = (value: string | undefined, headers?: Record<string, string>): Endpoint | null => (value ? { url: value, headers } : null);
const header = (headers: Record<string, string | undefined>, name: string) => headers[name.toLowerCase()];

/** Constant-time comparison of two strings. */
export function same(a: string | undefined, b: string | undefined) {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
const hmac = (algorithm: 'sha256' | 'sha512', key: string, body: string, encoding: 'hex' | 'base64') => createHmac(algorithm, key).update(body).digest(encoding);

/** Per-chain address fields for providers that give one address per chain and network (QuickNode, GetBlock, Chainstack). */
const perChain = (id: string, chainsOffered: Chain[], where: string) =>
  chainsOffered.map(chain => url(`${id}_${chain}_URL`, `${chain === 'BSC' ? 'BNB Chain' : chain.charAt(0) + chain.slice(1).toLowerCase()} endpoint`, `${where} With the Sandbox switch on, paste the test network’s endpoint instead.`));

export const chainProviders: ChainProvider[] = [
  {
    id: 'alchemy',
    name: 'Alchemy',
    description: 'Ethereum, BNB Chain and Solana. Also finds plain ETH and BNB deposits (its transfers API), which standard nodes cannot list.',
    fields: [
      secret('ALCHEMY_API_KEY', 'API key', 'Alchemy dashboard > Apps > your app > API key. Enable Ethereum, BNB Smart Chain and Solana on the app.'),
      secret('ALCHEMY_WEBHOOK_SIGNING_KEY', 'Webhook signing key', 'Alchemy dashboard > Webhooks > your Address Activity webhook > Signing key.', false),
      sandbox('ALCHEMY', 'On: Sepolia, BNB testnet and Solana devnet (sandbox stores). Off: main networks (live).'),
    ],
    links: [{ label: 'Sign up', url: 'https://dashboard.alchemy.com/signup' }, { label: 'Webhooks', url: 'https://dashboard.alchemy.com/webhooks' }, { label: 'API docs', url: 'https://docs.alchemy.com/' }],
    endpoints: (values, environment) => {
      const key = values.ALCHEMY_API_KEY;
      const at = (live: string, test: string): Endpoint | null => (key ? { url: `https://${environment === 'live' ? live : test}.g.alchemy.com/v2/${key}`, flavor: 'alchemy' } : null);
      return { ETHEREUM: evm(at('eth-mainnet', 'eth-sepolia')), BSC: evm(at('bnb-mainnet', 'bnb-testnet')), SOLANA: solana(at('solana-mainnet', 'solana-devnet')) };
    },
    verify: ({ headers, body }, values) => Boolean(values.ALCHEMY_WEBHOOK_SIGNING_KEY) && same(header(headers, 'x-alchemy-signature'), hmac('sha256', values.ALCHEMY_WEBHOOK_SIGNING_KEY!, body, 'hex')),
    webhookHelp: 'Create an Address Activity webhook per network pointing here (add ?chain=ETHEREUM or ?chain=BSC).',
  },
  {
    id: 'quicknode',
    name: 'QuickNode',
    description: 'Every chain BitoCard uses: Ethereum, BNB Chain, TRON, Bitcoin and Solana, each through its own endpoint.',
    fields: [
      ...perChain('QUICKNODE', ['ETHEREUM', 'BSC', 'TRON', 'BITCOIN', 'SOLANA'], 'QuickNode dashboard > Endpoints > the endpoint’s HTTP Provider address (it includes your token).'),
      secret('QUICKNODE_WEBHOOK_SECRET', 'Streams security token', 'QuickNode > Streams > your stream > Security token.', false),
      sandbox('QUICKNODE', 'On: the endpoints pasted are test network endpoints (sandbox stores). Off: main networks (live).'),
    ],
    links: [{ label: 'Sign up', url: 'https://dashboard.quicknode.com/' }, { label: 'API docs', url: 'https://www.quicknode.com/docs' }],
    endpoints: values => ({
      ETHEREUM: evm(pasted(values.QUICKNODE_ETHEREUM_URL)),
      BSC: evm(pasted(values.QUICKNODE_BSC_URL)),
      TRON: tron(pasted(values.QUICKNODE_TRON_URL)),
      BITCOIN: bitcoinRpc(pasted(values.QUICKNODE_BITCOIN_URL)),
      SOLANA: solana(pasted(values.QUICKNODE_SOLANA_URL)),
    }),
    verify: ({ headers, body }, values) =>
      Boolean(values.QUICKNODE_WEBHOOK_SECRET) &&
      same(header(headers, 'x-qn-signature'), hmac('sha256', values.QUICKNODE_WEBHOOK_SECRET!, `${header(headers, 'x-qn-nonce') ?? ''}${header(headers, 'x-qn-timestamp') ?? ''}${body}`, 'hex')),
    webhookHelp: 'Create a Stream per chain with this destination (add ?chain=ETHEREUM, BSC, TRON or BITCOIN).',
  },
  {
    id: 'infura',
    name: 'Infura',
    description: 'Ethereum and BNB Chain nodes (standard JSON-RPC). No webhooks: deposits are found by scanning.',
    fields: [secret('INFURA_API_KEY', 'API key', 'Infura dashboard > API keys > your key. Enable Ethereum and BNB Smart Chain.'), sandbox('INFURA', 'On: Sepolia and BNB testnet (sandbox stores). Off: main networks (live).')],
    links: [{ label: 'Sign up', url: 'https://app.infura.io/register' }, { label: 'API docs', url: 'https://docs.metamask.io/services/' }],
    endpoints: (values, environment) => {
      const key = values.INFURA_API_KEY;
      const at = (live: string, test: string): Endpoint | null => (key ? { url: `https://${environment === 'live' ? live : test}.infura.io/v3/${key}` } : null);
      return { ETHEREUM: evm(at('mainnet', 'sepolia')), BSC: evm(at('bsc-mainnet', 'bsc-testnet')) };
    },
  },
  {
    id: 'ankr',
    name: 'Ankr',
    description: 'Low-cost nodes for Ethereum, BNB Chain, TRON and Solana.',
    fields: [secret('ANKR_API_KEY', 'API key', 'Ankr RPC dashboard > your project token.'), sandbox('ANKR', 'On: Sepolia, BNB testnet and Solana devnet (sandbox stores). Off: main networks (live).')],
    links: [{ label: 'Sign up', url: 'https://www.ankr.com/rpc/' }, { label: 'API docs', url: 'https://www.ankr.com/docs/rpc-service/' }],
    endpoints: (values, environment) => {
      const key = values.ANKR_API_KEY;
      const at = (live: string, test: string | null): Endpoint | null => (key && (environment === 'live' || test) ? { url: `https://rpc.ankr.com/${environment === 'live' ? live : test}/${key}` } : null);
      return {
        ETHEREUM: evm(at('eth', 'eth_sepolia')),
        BSC: evm(at('bsc', 'bsc_testnet_chapel')),
        SOLANA: solana(at('solana', 'solana_devnet')),
        TRON: tron(key && environment === 'live' ? { url: `https://rpc.ankr.com/premium-http/tron/${key}` } : null),
      };
    },
  },
  {
    id: 'nodereal',
    name: 'NodeReal',
    description: 'BNB Chain specialist nodes, plus Ethereum.',
    fields: [secret('NODEREAL_API_KEY', 'API key', 'NodeReal console > API keys.'), sandbox('NODEREAL', 'On: BNB testnet and Sepolia (sandbox stores). Off: main networks (live).')],
    links: [{ label: 'Sign up', url: 'https://nodereal.io/' }, { label: 'API docs', url: 'https://docs.nodereal.io/' }],
    endpoints: (values, environment) => {
      const key = values.NODEREAL_API_KEY;
      const at = (live: string, test: string): Endpoint | null => (key ? { url: `https://${environment === 'live' ? live : test}.nodereal.io/v1/${key}` } : null);
      return { BSC: evm(at('bsc-mainnet', 'bsc-testnet')), ETHEREUM: evm(at('eth-mainnet', 'eth-sepolia')) };
    },
  },
  {
    id: 'getblock',
    name: 'GetBlock',
    description: 'Shared or dedicated nodes for every chain BitoCard uses, each through its own endpoint.',
    fields: [...perChain('GETBLOCK', ['ETHEREUM', 'BSC', 'TRON', 'BITCOIN', 'SOLANA'], 'GetBlock dashboard > Endpoints > the endpoint address (it includes your access token).'), sandbox('GETBLOCK', 'On: the endpoints pasted are test network endpoints (sandbox stores). Off: main networks (live).')],
    links: [{ label: 'Sign up', url: 'https://account.getblock.io/sign-up' }, { label: 'API docs', url: 'https://docs.getblock.io/' }],
    endpoints: values => ({
      ETHEREUM: evm(pasted(values.GETBLOCK_ETHEREUM_URL)),
      BSC: evm(pasted(values.GETBLOCK_BSC_URL)),
      TRON: tron(pasted(values.GETBLOCK_TRON_URL)),
      BITCOIN: bitcoinRpc(pasted(values.GETBLOCK_BITCOIN_URL)),
      SOLANA: solana(pasted(values.GETBLOCK_SOLANA_URL)),
    }),
  },
  {
    id: 'chainstack',
    name: 'Chainstack',
    description: 'Dedicated or shared nodes for every chain BitoCard uses, each through its own endpoint.',
    fields: [...perChain('CHAINSTACK', ['ETHEREUM', 'BSC', 'TRON', 'BITCOIN', 'SOLANA'], 'Chainstack console > your node > Access and credentials > HTTPS endpoint.'), sandbox('CHAINSTACK', 'On: the endpoints pasted are test network endpoints (sandbox stores). Off: main networks (live).')],
    links: [{ label: 'Sign up', url: 'https://console.chainstack.com/user/account/create' }, { label: 'API docs', url: 'https://docs.chainstack.com/' }],
    endpoints: values => ({
      ETHEREUM: evm(pasted(values.CHAINSTACK_ETHEREUM_URL)),
      BSC: evm(pasted(values.CHAINSTACK_BSC_URL)),
      TRON: tron(pasted(values.CHAINSTACK_TRON_URL)),
      BITCOIN: bitcoinRpc(pasted(values.CHAINSTACK_BITCOIN_URL)),
      SOLANA: solana(pasted(values.CHAINSTACK_SOLANA_URL)),
    }),
  },
  {
    id: 'moralis',
    name: 'Moralis',
    description: 'Ethereum and BNB Chain nodes, and Streams: webhooks for transfers to watched addresses.',
    fields: [
      ...perChain('MORALIS', ['ETHEREUM', 'BSC'], 'Moralis admin > Nodes > the node address.'),
      secret('MORALIS_STREAM_SECRET', 'Streams secret', 'Moralis admin > Settings > Secrets (verifies Streams webhooks).', false),
      sandbox('MORALIS', 'On: the nodes pasted are test network nodes (sandbox stores). Off: main networks (live).'),
    ],
    links: [{ label: 'Sign up', url: 'https://admin.moralis.com/register' }, { label: 'API docs', url: 'https://docs.moralis.com/' }],
    endpoints: values => ({ ETHEREUM: evm(pasted(values.MORALIS_ETHEREUM_URL)), BSC: evm(pasted(values.MORALIS_BSC_URL)) }),
    verify: ({ headers, body }, values) => Boolean(values.MORALIS_STREAM_SECRET) && same(header(headers, 'x-signature'), `0x${bytesToHex(keccak_256(new TextEncoder().encode(body + values.MORALIS_STREAM_SECRET)))}`),
    webhookHelp: 'Create a Stream per chain with this webhook address (add ?chain=ETHEREUM or ?chain=BSC).',
  },
  {
    id: 'helius',
    name: 'Helius',
    description: 'Solana specialist: nodes and address webhooks (for USDC on Solana).',
    fields: [
      secret('HELIUS_API_KEY', 'API key', 'Helius dashboard > API keys.'),
      secret('HELIUS_WEBHOOK_AUTH', 'Webhook auth header', 'Choose a long random value and set it as the webhook’s Authentication header in Helius.', false),
      sandbox('HELIUS', 'On: Solana devnet (sandbox stores). Off: mainnet (live).'),
    ],
    links: [{ label: 'Sign up', url: 'https://dashboard.helius.dev/signup' }, { label: 'API docs', url: 'https://www.helius.dev/docs' }],
    endpoints: (values, environment) => ({ SOLANA: solana(values.HELIUS_API_KEY ? { url: `https://${environment === 'live' ? 'mainnet' : 'devnet'}.helius-rpc.com/?api-key=${values.HELIUS_API_KEY}` } : null) }),
    verify: ({ headers }, values) => same(header(headers, 'authorization'), values.HELIUS_WEBHOOK_AUTH),
    webhookHelp: 'Create an address webhook with this URL (add ?chain=SOLANA) and the auth header above.',
  },
  {
    id: 'trongrid',
    name: 'TronGrid',
    description: 'TRON’s own API (USDT on TRON). Lists each address’s token deposits, so TRON deposits are found quickly.',
    fields: [secret('TRONGRID_API_KEY', 'API key', 'TronGrid dashboard > API keys (sent as TRON-PRO-API-KEY).'), sandbox('TRONGRID', 'On: the Nile test network (sandbox stores). Off: mainnet (live).')],
    links: [{ label: 'Sign up', url: 'https://www.trongrid.io/register' }, { label: 'API docs', url: 'https://developers.tron.network/reference' }],
    endpoints: (values, environment) => ({
      TRON: tron(values.TRONGRID_API_KEY ? { url: environment === 'live' ? 'https://api.trongrid.io' : 'https://nile.trongrid.io', headers: { 'TRON-PRO-API-KEY': values.TRONGRID_API_KEY }, flavor: 'trongrid' } : null),
    }),
  },
  {
    id: 'tatum',
    name: 'Tatum',
    description: 'One API key for every chain BitoCard uses (its RPC gateways), with address notifications.',
    fields: [
      secret('TATUM_API_KEY', 'API key', 'Tatum dashboard > API keys. Mainnet and testnet keys differ.'),
      secret('TATUM_WEBHOOK_SECRET', 'Notification HMAC secret', 'Choose a long random value and enable HMAC for notifications in Tatum with it.', false),
      sandbox('TATUM', 'On: test networks with the testnet key (sandbox stores). Off: main networks (live).'),
    ],
    links: [{ label: 'Sign up', url: 'https://dashboard.tatum.io/' }, { label: 'API docs', url: 'https://docs.tatum.io/' }],
    endpoints: (values, environment) => {
      const key = values.TATUM_API_KEY;
      const at = (live: string, test: string): Endpoint | null => (key ? { url: `https://${environment === 'live' ? live : test}.gateway.tatum.io`, headers: { 'x-api-key': key } } : null);
      return {
        ETHEREUM: evm(at('ethereum-mainnet', 'ethereum-sepolia')),
        BSC: evm(at('bsc-mainnet', 'bsc-testnet')),
        TRON: tron(at('tron-mainnet', 'tron-testnet')),
        BITCOIN: bitcoinRpc(at('bitcoin-mainnet', 'bitcoin-testnet')),
        SOLANA: solana(at('solana-mainnet', 'solana-devnet')),
      };
    },
    verify: ({ headers, body }, values) => Boolean(values.TATUM_WEBHOOK_SECRET) && same(header(headers, 'x-payload-hash'), hmac('sha512', values.TATUM_WEBHOOK_SECRET!, body, 'base64')),
    webhookHelp: 'Subscribe address notifications to this URL (add ?chain=ETHEREUM, BSC, TRON or BITCOIN).',
  },
  {
    id: 'blockcypher',
    name: 'BlockCypher',
    description: 'Bitcoin (address history and webhooks). Lists each address’s deposits.',
    fields: [
      secret('BLOCKCYPHER_TOKEN', 'API token', 'BlockCypher accounts > your token.'),
      secret('BLOCKCYPHER_WEBHOOK_TOKEN', 'Webhook token', 'Choose a long random value; BitoCard adds it to the webhook address it gives BlockCypher (BlockCypher signs nothing).', false),
      sandbox('BLOCKCYPHER', 'On: Bitcoin testnet (sandbox stores). Off: mainnet (live).'),
    ],
    links: [{ label: 'Sign up', url: 'https://accounts.blockcypher.com/signup' }, { label: 'API docs', url: 'https://www.blockcypher.com/dev/bitcoin/' }],
    endpoints: (values, environment) => ({
      BITCOIN: values.BLOCKCYPHER_TOKEN ? new BlockCypherClient({ url: `https://api.blockcypher.com/v1/btc/${environment === 'live' ? 'main' : 'test3'}`, token: values.BLOCKCYPHER_TOKEN }) : null,
    }),
    verify: ({ url: address }, values) => same(address.searchParams.get('token') ?? undefined, values.BLOCKCYPHER_WEBHOOK_TOKEN),
    webhookHelp: 'Add a webhook for each address with this URL plus &token=<webhook token> (add ?chain=BITCOIN).',
  },
  {
    id: 'mempool',
    name: 'mempool.space',
    description: 'Bitcoin (Esplora API): address history and fee estimates. Needs no account.',
    fields: [enabled('MEMPOOL'), field('MEMPOOL_API_URL', 'API address', { kind: 'url', help: 'Default: https://mempool.space/api (sandbox: https://mempool.space/testnet4/api). Set your own instance or enterprise address here.' }), sandbox('MEMPOOL', 'On: Bitcoin testnet (sandbox stores). Off: mainnet (live).')],
    links: [{ label: 'Website', url: 'https://mempool.space/' }, { label: 'API docs', url: 'https://mempool.space/docs/api/rest' }],
    endpoints: (values, environment) => ({
      BITCOIN: values.MEMPOOL_ENABLED === 'on' ? new EsploraClient({ url: values.MEMPOOL_API_URL || (environment === 'live' ? 'https://mempool.space/api' : 'https://mempool.space/testnet4/api') }) : null,
    }),
  },
  {
    id: 'blockstream',
    name: 'Blockstream Esplora',
    description: 'Bitcoin (Esplora API), a second source for mempool.space. Needs no account.',
    fields: [enabled('BLOCKSTREAM'), field('BLOCKSTREAM_API_URL', 'API address', { kind: 'url', help: 'Default: https://blockstream.info/api (sandbox: https://blockstream.info/testnet/api).' }), sandbox('BLOCKSTREAM', 'On: Bitcoin testnet (sandbox stores). Off: mainnet (live).')],
    links: [{ label: 'Website', url: 'https://blockstream.info/' }, { label: 'API docs', url: 'https://github.com/Blockstream/esplora/blob/master/API.md' }],
    endpoints: (values, environment) => ({
      BITCOIN: values.BLOCKSTREAM_ENABLED === 'on' ? new EsploraClient({ url: values.BLOCKSTREAM_API_URL || (environment === 'live' ? 'https://blockstream.info/api' : 'https://blockstream.info/testnet/api') }) : null,
    }),
  },
];

/** BitoCard's wallet keys: account xpubs (public: they make addresses, never spend). */
export const walletKeyFields: IntegrationField[] = [
  ...(['BITCOIN', 'EVM', 'TRON'] as const).flatMap(family => {
    const path = { BITCOIN: "m/84'/0'/0' (zpub or xpub)", EVM: "m/44'/60'/0'", TRON: "m/44'/195'/0'" }[family];
    const testPath = { BITCOIN: "m/84'/1'/0' (vpub or tpub)", EVM: "m/44'/60'/0'", TRON: "m/44'/195'/0'" }[family];
    const name = { BITCOIN: 'Bitcoin', EVM: 'Ethereum and BNB Chain', TRON: 'TRON' }[family];
    return [
      secret(`CRYPTO_XPUB_${family}`, `${name} account key (live)`, `The account extended public key at ${path}, exported from the key vault. Customers' live addresses are derived from it. Changing it gives new customers new addresses; addresses already issued stay watched.`, false),
      secret(`CRYPTO_TEST_XPUB_${family}`, `${name} account key (sandbox)`, `A test network key at ${testPath}, for sandbox stores. Never a live key.`, false),
    ];
  }),
];

export const chainProvider = (id: string) => chainProviders.find(provider => provider.id === id);
/** Every chain a provider can serve (in either environment), for the admin app. */
export const providerChains = (provider: ChainProvider): Chain[] =>
  Object.keys({ ...provider.endpoints({ x: 'x' }, 'live'), ...provider.endpoints({ x: 'x' }, 'sandbox') }) as Chain[];
/** Whether its Sandbox switch is on. */
export const providerInSandbox = (provider: ChainProvider, values: ChainProviderValues) => values[`${provider.id.toUpperCase()}_SANDBOX`] === 'on';
