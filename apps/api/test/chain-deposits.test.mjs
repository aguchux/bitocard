// On-chain crypto deposits: customers' own addresses from BitoCard's xpubs, blockchain providers as admin integrations
// (fallback, health, Test connection), scanning and webhooks that only name transactions, confirmations, a second
// provider for large deposits, and crediting once.
import assert from 'node:assert/strict';
import { createHmac, pbkdf2Sync } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { HDKey } from '@scure/bip32';
import { adminClient, adminCode, fakeService, lastEmailCode, startApp } from './helpers.mjs';

let server;
let admin;
let prisma;
let chain;
let derive;

const seed = pbkdf2Sync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', 'mnemonic', 2048, 64, 'sha512');
const testnet = HDKey.fromMasterSeed(seed, { private: 0x04358394, public: 0x043587cf });
const keys = {
  CRYPTO_TEST_XPUB_EVM: testnet.derive("m/44'/60'/0'").publicExtendedKey,
  CRYPTO_TEST_XPUB_TRON: testnet.derive("m/44'/195'/0'").publicExtendedKey,
  CRYPTO_TEST_XPUB_BITCOIN: testnet.derive("m/84'/1'/0'").publicExtendedKey,
};
const usdtContract = '0x7169d38820dfd117c3fa1f22a697dba58d90ba06';
const bscUsdt = '0x337610d27c682e347c9cd60bd4b3b107c9d34ddd';
const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const pad = address => `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
const hex = value => `0x${BigInt(value).toString(16)}`;

/** One fake chain: EVM JSON-RPC at /evm1 and /evm2 (two providers), TRON's node API at /tron, Esplora at /btc. */
function fakeChain() {
  const state = { latest: 100n, logs: [], txs: new Map(), down: new Set(), tronLatest: 5000, tron: new Map(), btcTip: 800, btc: new Map() };
  const rpc = (prefix, body) => {
    if (state.down.has(prefix)) return { status: 503, body: 'down' };
    const result = (() => {
      switch (body.method) {
        case 'eth_blockNumber':
          return hex(state.latest);
        case 'eth_getLogs': {
          const [filter] = body.params;
          const to = filter.topics[2];
          return state.logs.filter(log => filter.address.includes(log.address) && to.includes(log.topics[2]) && BigInt(log.blockNumber) >= BigInt(filter.fromBlock) && BigInt(log.blockNumber) <= BigInt(filter.toBlock));
        }
        case 'eth_getTransactionByHash':
          return state.txs.get(body.params[0])?.tx ?? null;
        case 'eth_getTransactionReceipt':
          return state.txs.get(body.params[0])?.receipt ?? null;
        default:
          return null;
      }
    })();
    return { body: { jsonrpc: '2.0', id: body.id, result } };
  };
  return fakeService(call => {
    const path = new URL(call.url, 'http://x').pathname;
    if (path === '/evm1' || path === '/evm2') return rpc(path, call.body);
    if (path === '/tron/wallet/getnowblock') return { body: { block_header: { raw_data: { number: state.tronLatest } } } };
    if (path === '/tron/wallet/gettransactioninfobyid') return { body: state.tron.get(call.body.value) ?? {} };
    if (path === '/btc/blocks/tip/height') return { headers: { 'content-type': 'text/plain' }, body: String(state.btcTip) };
    const address = /^\/btc\/address\/([^/]+)\/txs$/.exec(path);
    if (address) return { body: [...state.btc.values()].filter(tx => tx.vout.some(out => out.scriptpubkey_address === address[1])) };
    const tx = /^\/btc\/tx\/([^/]+)$/.exec(path);
    if (tx) return state.btc.has(tx[1]) ? { body: state.btc.get(tx[1]) } : { status: 404, body: 'not found' };
    return { status: 404, body: {} };
  }).then(service => Object.assign(service, { state }));
}

/** A token transfer on the fake EVM chain, in a block, findable by its logs and by its hash. */
function evmTransfer(state, { hash, to, raw, block, contract = usdtContract }) {
  const log = { transactionHash: hash, logIndex: '0x3', blockNumber: hex(block), address: contract, topics: [transferTopic, pad('0x1111111111111111111111111111111111111111'), pad(to)], data: hex(raw) };
  state.logs.push(log);
  state.txs.set(hash, { tx: { to: contract, value: '0x0', blockNumber: hex(block) }, receipt: { status: '0x1', blockNumber: hex(block), logs: [log] } });
}

const txHash = n => `0x${String(n).padStart(64, 'a')}`;
const update = async (id, values) => {
  const res = await admin.put(`/v1/admin/integrations/${id}`, { values, code: await adminCode(server, admin) });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return res.json;
};
const cron = job => fetch(`${server.base}/v1/cron/${job}`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json());
const ledgerOk = async () => assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);

before(async () => {
  chain = await fakeChain();
  server = await startApp({ env: { CHECKOUT_SANDBOX: 'on', CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  derive = await import('../dist/crypto/derive.js');
  admin = await adminClient(server);
  for (const key of ['crypto_wallets', 'p2p_trading']) await admin.put(`/v1/admin/switches/${key}`, { enabled: true });
});

after(async () => {
  await server?.close();
  await chain?.close();
});

let counter = 0;
async function customer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { 'bitocard-customer-session': token } : {}), ...(method === 'POST' ? { 'idempotency-key': `c-${Math.random()}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  const email = `chain${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await request('POST', '/v1/store/account/signup', { name: 'Ada Holder', email, password: 'correct horse battery', country: 'NG' });
  await request('POST', '/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) });
  return { id: signup.json.customer.id, get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

const network = async (asset, chainName) => prisma.cryptoNetwork.findUniqueOrThrow({ where: { asset_chain: { asset, chain: chainName } } });
const balance = async (shopper, asset) => (await shopper.get('/v1/store/crypto')).json.assets.find(item => item.asset === asset).available;

describe('blockchain providers in Settings > Integrations', () => {
  test('every provider and the wallet keys have a card in the Blockchain section, with links; keys are checked', async () => {
    const list = (await admin.get('/v1/admin/integrations')).json.data.filter(item => item.section === 'blockchain');
    assert.deepEqual(
      list.map(item => item.id),
      ['crypto_keys', 'alchemy', 'quicknode', 'infura', 'ankr', 'nodereal', 'getblock', 'chainstack', 'moralis', 'helius', 'trongrid', 'tatum', 'blockcypher', 'mempool', 'blockstream'],
    );
    assert.ok(list.filter(item => item.id !== 'crypto_keys').every(item => item.links.length && item.testable && item.sandbox === false));
    assert.equal(list.find(item => item.id === 'alchemy').webhook_url, 'https://api.bitocard.com/v1/webhooks/chain/alchemy?chain=<CHAIN>');

    const xprv = testnet.derive("m/44'/60'/0'").privateExtendedKey;
    const refused = await admin.put('/v1/admin/integrations/crypto_keys', { values: { CRYPTO_TEST_XPUB_EVM: xprv }, code: await adminCode(server, admin) });
    assert.deepEqual([refused.status, refused.json.error.param], [400, 'values.CRYPTO_TEST_XPUB_EVM'], 'a private key is never accepted');
    await update('crypto_keys', keys);
    const checked = (await admin.post('/v1/admin/integrations/crypto_keys/test')).json;
    assert.equal(checked.ok, true, checked.message);
    assert.match(checked.message, /bitcoin test: first address tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl/);
    assert.match(checked.message, /evm test: first address 0x/);
  });

  test('Test connection reads the latest block from each chain a provider is set up for', async () => {
    await update('quicknode', { QUICKNODE_ETHEREUM_URL: `${chain.url}/evm1`, QUICKNODE_TRON_URL: `${chain.url}/tron`, QUICKNODE_WEBHOOK_SECRET: 'qn-secret-value-1234', QUICKNODE_SANDBOX: true });
    const tested = (await admin.post('/v1/admin/integrations/quicknode/test')).json;
    assert.deepEqual([tested.ok, tested.environment, tested.message], [true, 'sandbox', 'Ethereum block 100, TRON block 5000 (test networks).']);
    chain.state.down.add('/evm1');
    const failing = (await admin.post('/v1/admin/integrations/quicknode/test')).json;
    assert.equal(failing.ok, false);
    assert.match(failing.message, /^Ethereum: unreachable: HTTP 503/);
    chain.state.down.delete('/evm1');
    const nothing = (await admin.post('/v1/admin/integrations/infura/test')).json;
    assert.deepEqual([nothing.ok, nothing.message], [false, 'Set Infura’s API key first.']);
  });
});

describe('deposits', () => {
  before(async () => {
    await update('getblock', { GETBLOCK_ETHEREUM_URL: `${chain.url}/evm2`, GETBLOCK_BSC_URL: `${chain.url}/evm2`, GETBLOCK_SANDBOX: true });
    await update('mempool', { MEMPOOL_ENABLED: true, MEMPOOL_API_URL: `${chain.url}/btc`, MEMPOOL_SANDBOX: true });
    for (const [asset, chainName, testContract] of [['USDT', 'ETHEREUM', usdtContract], ['USDT', 'BSC', bscUsdt], ['USDT', 'TRON', 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf'], ['BTC', 'BITCOIN', null]]) {
      const found = await network(asset, chainName);
      const changed = await admin.patch(`/v1/admin/crypto/networks/${found.id}`, { deposits_enabled: true, ...(testContract ? { test_contract: testContract } : {}) });
      assert.equal(changed.status, 200, JSON.stringify(changed.json));
    }
  });

  test('each customer gets their own address per family, the same every time; none before keys and providers', async () => {
    const first = await customer();
    const second = await customer();
    const networks = await first.get('/v1/store/crypto/deposit-networks?asset=USDT');
    assert.deepEqual(networks.json.data.map(item => [item.chain, item.token]), [['BSC', 'BEP-20'], ['ETHEREUM', 'ERC-20'], ['TRON', 'TRC-20']]);
    const a = await first.post('/v1/store/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' });
    assert.equal(a.status, 200, JSON.stringify(a.json));
    const b = await second.post('/v1/store/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' });
    const indexOf = address => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find(i => derive.deriveAddress('evm', keys.CRYPTO_TEST_XPUB_EVM, i) === address);
    assert.ok(indexOf(a.json.address) !== undefined && indexOf(b.json.address) === indexOf(a.json.address) + 1, 'consecutive indexes from the xpub');
    assert.equal((await first.post('/v1/store/crypto/deposit-addresses', { asset: 'USDT', chain: 'BSC' })).json.address, a.json.address, 'one EVM address for Ethereum and BNB Chain');
    assert.equal((await first.post('/v1/store/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' })).json.address, a.json.address, 'the same every time');
    assert.deepEqual([a.json.contract, a.json.confirmations, a.json.mode], [usdtContract, 12, 'test']);
    const btc = await first.post('/v1/store/crypto/deposit-addresses', { asset: 'BTC', chain: 'BITCOIN' });
    assert.match(btc.json.address, /^tb1q/);
    const usdc = await first.post('/v1/store/crypto/deposit-addresses', { asset: 'USDC', chain: 'SOLANA' });
    assert.deepEqual([usdc.status, usdc.json.error.code], [409, 'deposits_unavailable']);
  });

  test('a token deposit is found by scanning, credited only after its confirmations, and only once', async () => {
    const shopper = await customer();
    const address = (await shopper.post('/v1/store/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' })).json.address;
    chain.state.latest = 300n;
    evmTransfer(chain.state, { hash: txHash(1), to: address, raw: 25_500_000n, block: 295n });
    // A fake token with the same symbol on another contract is never credited.
    evmTransfer(chain.state, { hash: txHash(2), to: address, raw: 99_000_000n, block: 295n, contract: '0x9999999999999999999999999999999999999999' });
    await cron('crypto');
    const pending = await prisma.cryptoDeposit.findMany({ where: { customerId: shopper.id } });
    assert.deepEqual(pending.map(item => [item.status, item.amount, item.confirmations]), [['pending', 25_500_000n, 6]]);
    assert.equal(await balance(shopper, 'USDT'), '0.000000');
    chain.state.latest = 310n;
    await cron('crypto');
    assert.equal(await balance(shopper, 'USDT'), '25.500000');
    await cron('crypto');
    assert.equal(await balance(shopper, 'USDT'), '25.500000', 'credited once');
    const deposits = (await shopper.get('/v1/store/crypto/deposits')).json.data;
    assert.deepEqual(deposits.map(item => [item.status, item.amount, item.network]), [['credited', '25.500000', 'Ethereum']]);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: shopper.id, type: 'customer.crypto.deposit_credited' } }));
    await ledgerOk();
  });

  test('a provider that fails is passed over for the next; its error shows on the route', async () => {
    const shopper = await customer();
    const address = (await shopper.post('/v1/store/crypto/deposit-addresses', { asset: 'USDT', chain: 'BSC' })).json.address;
    chain.state.down.add('/evm1');
    try {
      evmTransfer(chain.state, { hash: txHash(3), to: address, raw: 1_500_000_000_000_000_000n, block: 320n, contract: bscUsdt });
      chain.state.latest = 340n;
      await cron('crypto');
      await cron('crypto');
      assert.equal(await balance(shopper, 'USDT'), '1.500000', 'BEP-20 USDT has 18 places on chain, 6 in the wallet');
      const chains = (await admin.get('/v1/admin/crypto/chains')).json.data;
      const ethereum = chains.find(item => item.chain === 'ETHEREUM');
      assert.match(ethereum.routes.find(item => item.provider === 'quicknode').last_error, /HTTP 503/);
      assert.deepEqual(ethereum.keys, { live: false, test: true });
    } finally {
      chain.state.down.delete('/evm1');
    }
  });

  test('large deposits wait for a second provider to agree; admins reorder and switch providers', async () => {
    const shopper = await customer();
    const address = (await shopper.post('/v1/store/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' })).json.address;
    const usdt = await network('USDT', 'ETHEREUM');
    assert.equal((await admin.patch(`/v1/admin/crypto/networks/${usdt.id}`, { double_check_from: '1000' })).status, 200);
    // Only GetBlock serves Ethereum for now.
    assert.equal((await admin.put('/v1/admin/crypto/chains/ETHEREUM/routes', { order: ['getblock'], disabled: ['quicknode'] })).status, 200);
    evmTransfer(chain.state, { hash: txHash(4), to: address, raw: 1_200_000_000n, block: 345n });
    chain.state.latest = 360n;
    await cron('crypto');
    await cron('crypto');
    const waiting = await prisma.cryptoDeposit.findFirstOrThrow({ where: { customerId: shopper.id } });
    assert.deepEqual([waiting.status, waiting.confirmedBy], ['pending', ['getblock']]);
    assert.equal((await admin.put('/v1/admin/crypto/chains/ETHEREUM/routes', { order: ['getblock', 'quicknode'], disabled: [] })).status, 200);
    await cron('crypto');
    const done = await prisma.cryptoDeposit.findFirstOrThrow({ where: { customerId: shopper.id } });
    assert.deepEqual([done.status, done.confirmedBy.sort()], ['credited', ['getblock', 'quicknode']]);
    assert.equal(await balance(shopper, 'USDT'), '1200.000000');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'crypto.chain_routes_changed', targetId: 'ETHEREUM' } });
    assert.ok(audit);
  });

  test('a webhook only names transactions: a bad signature is refused, a body is kept once, each transaction is re-read (TRON)', async () => {
    const shopper = await customer();
    const address = (await shopper.post('/v1/store/crypto/deposit-addresses', { asset: 'USDT', chain: 'TRON' })).json.address;
    assert.match(address, /^T/);
    const hash = 'b'.repeat(64);
    chain.state.tron.set(hash, {
      id: hash,
      blockNumber: 4990,
      receipt: { result: 'SUCCESS' },
      log: [{ address: derive.tronToHex('TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf').slice(2), topics: [transferTopic.slice(2), '0'.repeat(64), derive.tronToHex(address).slice(2).padStart(64, '0')], data: (7_000_000n).toString(16).padStart(64, '0') }],
    });
    const body = JSON.stringify({ matchedTransactions: [{ txid: hash, amount: '999999' }] });
    const sign = (nonce, timestamp) => createHmac('sha256', 'qn-secret-value-1234').update(`${nonce}${timestamp}${body}`).digest('hex');
    const post = headers => fetch(`${server.base}/v1/webhooks/chain/quicknode?chain=TRON`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
    assert.equal((await post({ 'x-qn-nonce': 'n1', 'x-qn-timestamp': '1', 'x-qn-signature': 'wrong' })).status, 401);
    assert.equal((await fetch(`${server.base}/v1/webhooks/chain/infura?chain=TRON`, { method: 'POST', body })).status, 401, 'providers without webhooks refuse');
    const headers = { 'x-qn-nonce': 'n1', 'x-qn-timestamp': '1', 'x-qn-signature': sign('n1', '1') };
    assert.equal((await post(headers)).status, 200);
    assert.equal((await post(headers)).status, 200);
    assert.equal(await prisma.chainNotice.count(), 1, 'kept once');
    for (let i = 0; i < 20 && !(await prisma.cryptoDeposit.count({ where: { customerId: shopper.id } })); i += 1) await new Promise(resolve => setTimeout(resolve, 100));
    const recorded = await prisma.cryptoDeposit.findFirstOrThrow({ where: { customerId: shopper.id } });
    assert.deepEqual([recorded.chain, recorded.amount, recorded.rawAmount], ['TRON', 7_000_000n, '7000000'], 'the amount comes from the chain, never the notification');
    chain.state.tronLatest = 5010;
    await cron('crypto');
    assert.equal(await balance(shopper, 'USDT'), '7.000000');
  });

  test('Bitcoin deposits are found by address history and credited after 2 confirmations', async () => {
    const shopper = await customer();
    const address = (await shopper.post('/v1/store/crypto/deposit-addresses', { asset: 'BTC', chain: 'BITCOIN' })).json.address;
    const id = 'c'.repeat(64);
    chain.state.btc.set(id, { txid: id, status: { confirmed: true, block_height: 800 }, vout: [{ scriptpubkey_address: 'tb1qsomeoneelse', value: 5000 }, { scriptpubkey_address: address, value: 123_456 }] });
    await cron('crypto');
    assert.equal(await balance(shopper, 'BTC'), '0.00000000', 'one confirmation');
    chain.state.btcTip = 801;
    await cron('crypto');
    assert.equal(await balance(shopper, 'BTC'), '0.00123456');
    const row = await prisma.cryptoDeposit.findFirstOrThrow({ where: { customerId: shopper.id } });
    assert.equal(row.outputIndex, 1);
    const listed = (await admin.get(`/v1/admin/crypto/deposits?customer_id=${shopper.id}`)).json.data;
    assert.deepEqual(listed.map(item => [item.status, item.amount, item.confirmed_by]), [['credited', '0.00123456', ['mempool']]]);
    await ledgerOk();
  });

  test('the health job records each provider’s latest block', async () => {
    const result = await cron('chain-health');
    assert.ok(result.result.results.some(item => item.provider === 'getblock' && item.ok));
    const bitcoin = (await admin.get('/v1/admin/crypto/chains')).json.data.find(item => item.chain === 'BITCOIN');
    const mempool = bitcoin.routes.find(item => item.provider === 'mempool');
    assert.deepEqual([mempool.configured, mempool.environment, mempool.last_block, mempool.lists_deposits], [true, 'sandbox', '801', true]);
  });
});
