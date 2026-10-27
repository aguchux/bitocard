// On-chain crypto deposits: customers' own addresses from BitoCard's xpubs, blockchain providers as admin integrations
// (fallback, health, Test connection), scanning and webhooks that only name transactions, confirmations, a second
// provider for large deposits, and crediting once.
import assert from 'node:assert/strict';
import { createHmac, pbkdf2Sync } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { HDKey } from '@scure/bip32';
import { adminClient, afrippaAdminClient, adminCode, fakeService, lastEmailCode, startApp } from './helpers.mjs';

let server;
let admin;
/** Afrippa's admin (its own realm): Afrippa's admin routes refuse BitoCard's admins. */
let afrippaAdmin;
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
  // chainIds: what each EVM endpoint says it is on (Sepolia by default); hidden: transactions listed in logs that no
  // node shows yet (a lagging provider); btcGenesis: the Bitcoin network Esplora is on (testnet4 by default);
  // tronGenesis: the TRON network its node is on (Nile by default).
  const state = { latest: 100n, logs: [], txs: new Map(), down: new Set(), tronLatest: 5000, tron: new Map(), btcTip: 800, btc: new Map(), chainIds: {}, hidden: new Set(), btcGenesis: '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043', tronGenesis: '0000000000000000d698d4192c56cb6be724a558448e2684802de4d6cd8690dc' };
  const rpc = (prefix, body) => {
    if (state.down.has(prefix)) return { status: 503, body: 'down' };
    const result = (() => {
      switch (body.method) {
        case 'eth_blockNumber':
          return hex(state.latest);
        case 'eth_chainId':
          return state.chainIds[prefix] ?? '0xaa36a7';
        case 'eth_getLogs': {
          const [filter] = body.params;
          const to = filter.topics[2];
          return state.logs.filter(log => filter.address.includes(log.address) && to.includes(log.topics[2]) && BigInt(log.blockNumber) >= BigInt(filter.fromBlock) && BigInt(log.blockNumber) <= BigInt(filter.toBlock));
        }
        case 'eth_getTransactionByHash':
          return state.hidden.has(body.params[0]) ? null : (state.txs.get(body.params[0])?.tx ?? null);
        case 'eth_getTransactionReceipt':
          return state.hidden.has(body.params[0]) ? null : (state.txs.get(body.params[0])?.receipt ?? null);
        default:
          return null;
      }
    })();
    return { body: { jsonrpc: '2.0', id: body.id, result } };
  };
  return fakeService(call => {
    const path = new URL(call.url, 'http://x').pathname;
    if (path === '/evm1' || path === '/evm2' || path === '/evm3') return rpc(path, call.body);
    if (path === '/btc/block-height/0') return { headers: { 'content-type': 'text/plain' }, body: state.btcGenesis };
    if (path === '/tron/wallet/getblockbynum') return { body: call.body?.num === 0 ? { blockID: state.tronGenesis } : {} };
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
  const res = await afrippaAdmin.put(`/v1/afrippa/admin/integrations/${id}`, { values, code: await adminCode(server, afrippaAdmin) });
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
  afrippaAdmin = await afrippaAdminClient(server);
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
const balance = async (shopper, asset) => (await shopper.get('/v1/afrippa/crypto')).json.assets.find(item => item.asset === asset).available;

describe('blockchain providers in Settings > Integrations', () => {
  test('every provider and the wallet keys have a card in the Blockchain section, with links; keys are checked', async () => {
    const list = (await afrippaAdmin.get('/v1/afrippa/admin/integrations')).json.data.filter(item => item.section === 'blockchain');
    assert.deepEqual(
      list.map(item => item.id),
      ['crypto_keys', 'alchemy', 'quicknode', 'infura', 'ankr', 'nodereal', 'getblock', 'chainstack', 'moralis', 'helius', 'trongrid', 'tatum', 'blockcypher', 'mempool', 'blockstream', 'litecoinspace', 'crypto_signer', 'chainalysis', 'trm', 'crypto_prices'],
    );
    assert.ok(list.filter(item => item.id !== 'crypto_keys').every(item => item.links.length && item.testable && item.sandbox !== true));
    assert.equal(list.find(item => item.id === 'alchemy').webhook_url, 'https://api.afrippa.com/v1/afrippa/webhooks/chain/alchemy?chain=<CHAIN>');

    const xprv = testnet.derive("m/44'/60'/0'").privateExtendedKey;
    const refused = await afrippaAdmin.put('/v1/afrippa/admin/integrations/crypto_keys', { values: { CRYPTO_TEST_XPUB_EVM: xprv }, code: await adminCode(server, afrippaAdmin) });
    assert.deepEqual([refused.status, refused.json.error.param], [400, 'values.CRYPTO_TEST_XPUB_EVM'], 'a private key is never accepted');
    await update('crypto_keys', keys);
    const checked = (await afrippaAdmin.post('/v1/afrippa/admin/integrations/crypto_keys/test')).json;
    assert.equal(checked.ok, true, checked.message);
    assert.match(checked.message, /bitcoin test: first address tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl/);
    assert.match(checked.message, /evm test: first address 0x/);
  });

  test('Test connection reads the latest block from each chain a provider is set up for', async () => {
    await update('quicknode', { QUICKNODE_ETHEREUM_URL: `${chain.url}/evm1`, QUICKNODE_TRON_URL: `${chain.url}/tron`, QUICKNODE_WEBHOOK_SECRET: 'qn-secret-value-1234', QUICKNODE_SANDBOX: true });
    const tested = (await afrippaAdmin.post('/v1/afrippa/admin/integrations/quicknode/test')).json;
    assert.deepEqual([tested.ok, tested.environment, tested.message], [true, 'sandbox', 'Ethereum block 100, TRON block 5000 (test networks).']);
    chain.state.down.add('/evm1');
    const failing = (await afrippaAdmin.post('/v1/afrippa/admin/integrations/quicknode/test')).json;
    assert.equal(failing.ok, false);
    assert.match(failing.message, /^Ethereum: unreachable: HTTP 503/);
    chain.state.down.delete('/evm1');
    const nothing = (await afrippaAdmin.post('/v1/afrippa/admin/integrations/infura/test')).json;
    assert.deepEqual([nothing.ok, nothing.message], [false, 'Set Infura’s API key first.']);
  });
});

describe('deposits', () => {
  before(async () => {
    await update('getblock', { GETBLOCK_ETHEREUM_URL: `${chain.url}/evm2`, GETBLOCK_BSC_URL: `${chain.url}/evm2`, GETBLOCK_SANDBOX: true });
    await update('mempool', { MEMPOOL_ENABLED: true, MEMPOOL_API_URL: `${chain.url}/btc`, MEMPOOL_SANDBOX: true });
    for (const [asset, chainName, testContract] of [['USDT', 'ETHEREUM', usdtContract], ['USDT', 'BSC', bscUsdt], ['USDT', 'TRON', 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf'], ['BTC', 'BITCOIN', null]]) {
      const found = await network(asset, chainName);
      const changed = await afrippaAdmin.patch(`/v1/afrippa/admin/crypto/networks/${found.id}`, { deposits_enabled: true, ...(testContract ? { test_contract: testContract } : {}) });
      assert.equal(changed.status, 200, JSON.stringify(changed.json));
    }
  });

  test('each customer gets their own address per family, the same every time; none before keys and providers', async () => {
    const first = await customer();
    const second = await customer();
    const networks = await first.get('/v1/afrippa/crypto/deposit-networks?asset=USDT');
    assert.deepEqual(networks.json.data.map(item => [item.chain, item.token]), [['BSC', 'BEP-20'], ['ETHEREUM', 'ERC-20'], ['TRON', 'TRC-20']]);
    const a = await first.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' });
    assert.equal(a.status, 200, JSON.stringify(a.json));
    const b = await second.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' });
    const indexOf = address => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find(i => derive.deriveAddress('evm', keys.CRYPTO_TEST_XPUB_EVM, i) === address);
    assert.ok(indexOf(a.json.address) !== undefined && indexOf(b.json.address) === indexOf(a.json.address) + 1, 'consecutive indexes from the xpub');
    assert.equal((await first.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDT', chain: 'BSC' })).json.address, a.json.address, 'one EVM address for Ethereum and BNB Chain');
    assert.equal((await first.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' })).json.address, a.json.address, 'the same every time');
    assert.deepEqual([a.json.contract, a.json.confirmations, a.json.mode], [usdtContract, 12, 'test']);
    const btc = await first.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'BTC', chain: 'BITCOIN' });
    assert.match(btc.json.address, /^tb1q/);
    const usdc = await first.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDC', chain: 'SOLANA' });
    assert.deepEqual([usdc.status, usdc.json.error.code], [409, 'deposits_unavailable']);
  });

  test('Polygon, Arbitrum, Base and Optimism give the customer the same EVM address as Ethereum', async () => {
    await update('getblock', { GETBLOCK_POLYGON_URL: `${chain.url}/evm2` });
    const usdc = await network('USDC', 'POLYGON');
    assert.equal((await afrippaAdmin.patch(`/v1/afrippa/admin/crypto/networks/${usdc.id}`, { deposits_enabled: true })).status, 200);
    try {
      const shopper = await customer();
      const networks = (await shopper.get('/v1/afrippa/crypto/deposit-networks?asset=USDC')).json.data;
      assert.deepEqual(networks.find(item => item.chain === 'POLYGON'), { object: 'crypto_network', asset: 'USDC', chain: 'POLYGON', name: 'Polygon', token: 'ERC-20', confirmations: 256 });
      const polygon = await shopper.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDC', chain: 'POLYGON' });
      assert.equal(polygon.status, 200, JSON.stringify(polygon.json));
      assert.equal(polygon.json.address, (await shopper.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' })).json.address, 'one EVM address');
      assert.equal(polygon.json.contract, usdc.testContract, 'the test network token in the sandbox');
      // Arbitrum is switched off: not offered.
      assert.equal((await shopper.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDC', chain: 'ARBITRUM' })).json.error.code, 'deposits_unavailable');
    } finally {
      await afrippaAdmin.patch(`/v1/afrippa/admin/crypto/networks/${usdc.id}`, { deposits_enabled: false });
    }
  });

  test('a token deposit is found by scanning, credited only after its confirmations, and only once', async () => {
    const shopper = await customer();
    const address = (await shopper.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' })).json.address;
    chain.state.latest = 300n;
    evmTransfer(chain.state, { hash: txHash(1), to: address, raw: 25_500_000n, block: 295n });
    // A fake token with the same symbol on another contract is never credited.
    evmTransfer(chain.state, { hash: txHash(2), to: address, raw: 99_000_000n, block: 295n, contract: '0x9999999999999999999999999999999999999999' });
    await cron('crypto');
    const pending = await prisma.cryptoDeposit.findMany({ where: { customerId: shopper.id } });
    // Settling runs before scanning, so a deposit just found is first checked for confirmations on the next run.
    assert.deepEqual(pending.map(item => [item.status, item.amount, item.confirmations]), [['pending', 25_500_000n, 0]]);
    assert.equal(pending[0].outputIndex, 1, 'numbered by its place in the transaction, not the block-wide log index (stable across reorgs)');
    assert.equal(await balance(shopper, 'USDT'), '0.000000');
    chain.state.latest = 310n;
    await cron('crypto');
    assert.equal(await balance(shopper, 'USDT'), '25.500000');
    await cron('crypto');
    assert.equal(await balance(shopper, 'USDT'), '25.500000', 'credited once');
    const deposits = (await shopper.get('/v1/afrippa/crypto/deposits')).json.data;
    assert.deepEqual(deposits.map(item => [item.status, item.amount, item.network]), [['credited', '25.500000', 'Ethereum']]);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: shopper.id, type: 'customer.crypto.deposit_credited' } }));
    await ledgerOk();
  });

  test('a provider that fails is passed over for the next; its error shows on the route', async () => {
    const shopper = await customer();
    const address = (await shopper.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDT', chain: 'BSC' })).json.address;
    chain.state.down.add('/evm1');
    try {
      evmTransfer(chain.state, { hash: txHash(3), to: address, raw: 1_500_000_000_000_000_000n, block: 320n, contract: bscUsdt });
      chain.state.latest = 340n;
      await cron('crypto');
      await cron('crypto');
      assert.equal(await balance(shopper, 'USDT'), '1.500000', 'BEP-20 USDT has 18 places on chain, 6 in the wallet');
      const chains = (await afrippaAdmin.get('/v1/afrippa/admin/crypto/chains')).json.data;
      const ethereum = chains.find(item => item.chain === 'ETHEREUM');
      assert.match(ethereum.routes.find(item => item.provider === 'quicknode').last_error, /HTTP 503/);
      assert.deepEqual(ethereum.keys, { live: false, test: true });
    } finally {
      chain.state.down.delete('/evm1');
    }
  });

  test('large deposits wait for a second provider to agree; admins reorder and switch providers', async () => {
    const shopper = await customer();
    const address = (await shopper.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' })).json.address;
    const usdt = await network('USDT', 'ETHEREUM');
    assert.equal((await afrippaAdmin.patch(`/v1/afrippa/admin/crypto/networks/${usdt.id}`, { double_check_from: '1000' })).status, 200);
    // Only GetBlock serves Ethereum for now.
    assert.equal((await afrippaAdmin.put('/v1/afrippa/admin/crypto/chains/ETHEREUM/routes', { order: ['getblock'], disabled: ['quicknode'] })).status, 200);
    evmTransfer(chain.state, { hash: txHash(4), to: address, raw: 1_200_000_000n, block: 345n });
    chain.state.latest = 360n;
    await cron('crypto');
    await cron('crypto');
    const waiting = await prisma.cryptoDeposit.findFirstOrThrow({ where: { customerId: shopper.id } });
    assert.deepEqual([waiting.status, waiting.confirmedBy], ['pending', ['getblock']]);
    const told = await prisma.notification.findMany({ where: { type: 'admin.crypto.deposit_stuck', dedupeKey: `admin.crypto.deposit_stuck:double_check:${waiting.id}` } });
    assert.ok(told.length, 'operations are told a large deposit has no second provider');
    await cron('crypto');
    assert.equal(await prisma.notification.count({ where: { dedupeKey: `admin.crypto.deposit_stuck:double_check:${waiting.id}` } }), told.length, 'once');
    assert.equal((await afrippaAdmin.put('/v1/afrippa/admin/crypto/chains/ETHEREUM/routes', { order: ['getblock', 'quicknode'], disabled: [] })).status, 200);
    await cron('crypto');
    const done = await prisma.cryptoDeposit.findFirstOrThrow({ where: { customerId: shopper.id } });
    assert.deepEqual([done.status, done.confirmedBy.sort()], ['credited', ['getblock', 'quicknode']]);
    assert.equal(await balance(shopper, 'USDT'), '1200.000000');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'crypto.chain_routes_changed', targetId: 'ETHEREUM' } });
    assert.ok(audit);
  });

  test('a webhook only names transactions: a bad signature is refused, a body is kept once, each transaction is re-read (TRON)', async () => {
    const shopper = await customer();
    const address = (await shopper.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDT', chain: 'TRON' })).json.address;
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
    const post = headers => fetch(`${server.base}/v1/afrippa/webhooks/chain/quicknode?chain=TRON`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
    assert.equal((await post({ 'x-qn-nonce': 'n1', 'x-qn-timestamp': '1', 'x-qn-signature': 'wrong' })).status, 401);
    assert.equal((await fetch(`${server.base}/v1/afrippa/webhooks/chain/infura?chain=TRON`, { method: 'POST', body })).status, 401, 'providers without webhooks refuse');
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
    const address = (await shopper.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'BTC', chain: 'BITCOIN' })).json.address;
    const id = 'c'.repeat(64);
    chain.state.btc.set(id, { txid: id, status: { confirmed: true, block_height: 800 }, vout: [{ scriptpubkey_address: 'tb1qsomeoneelse', value: 5000 }, { scriptpubkey_address: address, value: 123_456 }] });
    await cron('crypto');
    assert.equal(await balance(shopper, 'BTC'), '0.00000000', 'one confirmation');
    chain.state.btcTip = 801;
    await cron('crypto');
    assert.equal(await balance(shopper, 'BTC'), '0.00123456');
    const row = await prisma.cryptoDeposit.findFirstOrThrow({ where: { customerId: shopper.id } });
    assert.equal(row.outputIndex, 1);
    const listed = (await afrippaAdmin.get(`/v1/afrippa/admin/crypto/deposits?customer_id=${shopper.id}`)).json.data;
    assert.deepEqual(listed.map(item => [item.status, item.amount, item.confirmed_by]), [['credited', '0.00123456', ['mempool']]]);
    await ledgerOk();
  });

  test('the health job records each provider’s latest block', async () => {
    const result = await cron('chain-health');
    assert.ok(result.result.results.some(item => item.provider === 'getblock' && item.ok));
    const bitcoin = (await afrippaAdmin.get('/v1/afrippa/admin/crypto/chains')).json.data.find(item => item.chain === 'BITCOIN');
    const mempool = bitcoin.routes.find(item => item.provider === 'mempool');
    assert.deepEqual([mempool.configured, mempool.environment, mempool.last_block, mempool.lists_deposits], [true, 'sandbox', '801', true]);
  });
});

describe('deposits are never silently missed', () => {
  test('a chain whose providers cannot list a kind of deposit says so instead of reporting nothing', async () => {
    const eth = await network('ETH', 'ETHEREUM');
    assert.equal((await afrippaAdmin.patch(`/v1/afrippa/admin/crypto/networks/${eth.id}`, { deposits_enabled: true })).status, 200);
    try {
      const run = await cron('crypto');
      assert.deepEqual(run.result.deposits['test:ETHEREUM'].notes, ['coin deposits: webhooks only (no provider here lists them)'], 'only Alchemy lists plain ETH deposits');
      assert.equal(run.result.deposits['test:TRON'].skipped, 'no provider lists token deposits (webhooks only)', 'only TronGrid lists TRON token deposits');
    } finally {
      await afrippaAdmin.patch(`/v1/afrippa/admin/crypto/networks/${eth.id}`, { deposits_enabled: false });
    }
  });

  test('a deposit is failed only when no provider shows it for hours, and comes back when the chain shows it again', async () => {
    const shopper = await customer();
    const address = (await shopper.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' })).json.address;
    chain.state.latest += 5n;
    const block = chain.state.latest - 3n;
    evmTransfer(chain.state, { hash: txHash(7), to: address, raw: 3_000_000n, block });
    await cron('crypto');
    const row = await prisma.cryptoDeposit.findFirstOrThrow({ where: { customerId: shopper.id } });
    assert.equal(row.status, 'pending');
    const saved = chain.state.txs.get(txHash(7));
    chain.state.txs.delete(txHash(7));
    await cron('crypto');
    const missing = await prisma.cryptoDeposit.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(missing.status, 'pending', 'missing for a short while is not failed');
    assert.ok(missing.missingSince, 'the clock starts when it goes missing');
    // An old deposit that has only just gone missing is not failed: the 6 hours run from when it went missing.
    await prisma.cryptoDeposit.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - 30 * 3_600_000) } });
    await cron('crypto');
    assert.equal((await prisma.cryptoDeposit.findUniqueOrThrow({ where: { id: row.id } })).status, 'pending');
    await prisma.cryptoDeposit.update({ where: { id: row.id }, data: { missingSince: new Date(Date.now() - 7 * 3_600_000) } });
    await cron('crypto');
    assert.equal((await prisma.cryptoDeposit.findUniqueOrThrow({ where: { id: row.id } })).status, 'failed');
    chain.state.txs.set(txHash(7), saved);
    chain.state.latest += 20n;
    const rechecked = await afrippaAdmin.post(`/v1/afrippa/admin/crypto/deposits/${row.id}/recheck`);
    assert.deepEqual([rechecked.status, rechecked.json.status], [200, 'credited']);
    assert.equal((await prisma.cryptoDeposit.findUniqueOrThrow({ where: { id: row.id } })).missingSince, null, 'seen again: no longer missing');
    assert.equal(await balance(shopper, 'USDT'), '3.000000');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'crypto.deposit_rechecked', targetId: row.id } }));
    await ledgerOk();
  });

  test('an address is the customer’s for good: deposits long after it was last shown are still found', async () => {
    const shopper = await customer();
    const evm = (await shopper.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' })).json.address;
    const btc = (await shopper.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'BTC', chain: 'BITCOIN' })).json.address;
    await prisma.cryptoAddress.updateMany({ where: { customerId: shopper.id }, data: { watchUntil: new Date(Date.now() - 30 * 86_400_000) } });
    chain.state.latest += 10n;
    evmTransfer(chain.state, { hash: txHash(9), to: evm, raw: 2_000_000n, block: chain.state.latest - 5n });
    const id = 'd'.repeat(64);
    chain.state.btc.set(id, { txid: id, status: { confirmed: true, block_height: chain.state.btcTip - 3 }, vout: [{ scriptpubkey_address: btc, value: 50_000 }] });
    await cron('crypto');
    chain.state.latest += 20n;
    await cron('crypto');
    assert.equal(await balance(shopper, 'USDT'), '2.000000', 'EVM token logs cover every address');
    assert.equal(await balance(shopper, 'BTC'), '0.00050000', 'unwatched Bitcoin addresses are swept in turn');
    const swept = await prisma.cryptoAddress.findFirstOrThrow({ where: { customerId: shopper.id, family: 'bitcoin' } });
    assert.ok(swept.sweptAt, 'its sweep is recorded');
  });

  test('a webhook that came while every provider was down is processed by the next run', async () => {
    const shopper = await customer();
    const address = (await shopper.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' })).json.address;
    // Out of the watch window, so only the webhook can find it.
    await prisma.cryptoAddress.updateMany({ where: { customerId: shopper.id }, data: { watchUntil: new Date(Date.now() - 1000) } });
    const hash = txHash(8);
    evmTransfer(chain.state, { hash, to: address, raw: 4_000_000n, block: chain.state.latest - 1n });
    const body = JSON.stringify({ matchedTransactions: [{ hash }] });
    const signature = createHmac('sha256', 'qn-secret-value-1234').update(`n8t8${body}`).digest('hex');
    chain.state.down.add('/evm1');
    chain.state.down.add('/evm2');
    try {
      const res = await fetch(`${server.base}/v1/afrippa/webhooks/chain/quicknode?chain=ETHEREUM`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-qn-nonce': 'n8', 'x-qn-timestamp': 't8', 'x-qn-signature': signature }, body });
      assert.equal(res.status, 200);
      let notice = null;
      for (let i = 0; i < 20 && !(notice = await prisma.chainNotice.findFirst({ where: { hashes: { has: hash }, attempts: { gt: 0 } } })); i += 1) await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(notice.processedAt, null, 'not processed while every provider is down');
    } finally {
      chain.state.down.delete('/evm1');
      chain.state.down.delete('/evm2');
    }
    await prisma.chainNotice.updateMany({ where: { hashes: { has: hash } }, data: { createdAt: new Date(Date.now() - 120_000) } });
    await cron('crypto');
    assert.ok(await prisma.cryptoDeposit.findFirst({ where: { customerId: shopper.id, txHash: hash } }), 'recorded by the retry');
    assert.ok((await prisma.chainNotice.findFirst({ where: { hashes: { has: hash } } })).processedAt, 'the notification is processed');
  });

  test('a transfer a scan lists but no provider shows yet is kept and recorded later; the cursor still moves', async () => {
    const shopper = await customer();
    const address = (await shopper.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' })).json.address;
    const hash = txHash(11);
    chain.state.latest += 5n;
    evmTransfer(chain.state, { hash, to: address, raw: 6_000_000n, block: chain.state.latest - 3n });
    chain.state.hidden.add(hash);
    const run = await cron('crypto');
    assert.equal(run.result.deposits['test:ETHEREUM'].deferred, 1, JSON.stringify(run.result.deposits['test:ETHEREUM']));
    assert.equal(await prisma.cryptoDeposit.count({ where: { txHash: hash } }), 0, 'nothing recorded while no provider shows it');
    const kept = await prisma.chainNotice.findFirstOrThrow({ where: { provider: 'scan', hashes: { has: hash } } });
    assert.deepEqual([kept.mode, kept.chain, kept.processedAt], ['test', 'ETHEREUM', null]);
    const cursor = await prisma.chainCursor.findUniqueOrThrow({ where: { chain_mode: { chain: 'ETHEREUM', mode: 'test' } } });
    assert.ok(cursor.block >= chain.state.latest - 3n, 'the block range was read');
    chain.state.hidden.delete(hash);
    await prisma.chainNotice.update({ where: { id: kept.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
    await cron('crypto');
    assert.ok(await prisma.cryptoDeposit.findFirst({ where: { customerId: shopper.id, txHash: hash } }), 'recorded once a provider shows it');
    assert.ok((await prisma.chainNotice.findUniqueOrThrow({ where: { id: kept.id } })).processedAt);
  });

  test('a webhook naming a transaction no provider shows yet is kept for the next run, not dropped', async () => {
    const shopper = await customer();
    const address = (await shopper.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' })).json.address;
    await prisma.cryptoAddress.updateMany({ where: { customerId: shopper.id }, data: { watchUntil: new Date(Date.now() - 1000) } });
    const hash = txHash(12);
    evmTransfer(chain.state, { hash, to: address, raw: 1_000_000n, block: chain.state.latest - 1n });
    chain.state.hidden.add(hash);
    const body = JSON.stringify({ matchedTransactions: [{ hash }] });
    const signature = createHmac('sha256', 'qn-secret-value-1234').update(`n12t12${body}`).digest('hex');
    const res = await fetch(`${server.base}/v1/afrippa/webhooks/chain/quicknode?chain=ETHEREUM`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-qn-nonce': 'n12', 'x-qn-timestamp': 't12', 'x-qn-signature': signature }, body });
    assert.equal(res.status, 200);
    let notice = null;
    for (let i = 0; i < 20 && !(notice = await prisma.chainNotice.findFirst({ where: { provider: 'quicknode', hashes: { has: hash }, attempts: { gt: 0 } } })); i += 1) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(notice.processedAt, null, 'not visible yet is not "nothing"');
    chain.state.hidden.delete(hash);
    await prisma.chainNotice.update({ where: { id: notice.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
    await cron('crypto');
    assert.ok(await prisma.cryptoDeposit.findFirst({ where: { customerId: shopper.id, txHash: hash } }));
    assert.ok((await prisma.chainNotice.findUniqueOrThrow({ where: { id: notice.id } })).processedAt);
  });

  test('a hash in another case is the same transaction: never recorded or credited twice', async () => {
    const { hashesIn } = await import('../dist/crypto/chains/deposits.service.js');
    assert.deepEqual(hashesIn(`{"a":"0x${'AB'.repeat(32)}","b":"0x${'ab'.repeat(32)}"}`, 'ETHEREUM'), [`0x${'ab'.repeat(32)}`]);
    assert.deepEqual(hashesIn(`"${'CD'.repeat(32)}"`, 'BITCOIN'), ['cd'.repeat(32)]);
    const shopper = await customer();
    const address = (await shopper.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' })).json.address;
    const hash = txHash(13);
    chain.state.latest += 5n;
    evmTransfer(chain.state, { hash, to: address, raw: 2_500_000n, block: chain.state.latest - 3n });
    await cron('crypto');
    chain.state.latest += 20n;
    await cron('crypto');
    assert.equal(await balance(shopper, 'USDT'), '2.500000');
    const upper = `0x${hash.slice(2).toUpperCase()}`;
    const body = JSON.stringify({ matchedTransactions: [{ hash: upper }] });
    const signature = createHmac('sha256', 'qn-secret-value-1234').update(`n13t13${body}`).digest('hex');
    assert.equal((await fetch(`${server.base}/v1/afrippa/webhooks/chain/quicknode?chain=ETHEREUM`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-qn-nonce': 'n13', 'x-qn-timestamp': 't13', 'x-qn-signature': signature }, body })).status, 200);
    let notice = null;
    for (let i = 0; i < 20 && !(notice = await prisma.chainNotice.findFirst({ where: { provider: 'quicknode', hashes: { has: hash }, processedAt: { not: null } } })); i += 1) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(notice, 'the notification is kept with the hash in lower case and processed');
    await cron('crypto');
    assert.equal(await prisma.cryptoDeposit.count({ where: { txHash: { in: [hash, upper] } } }), 1);
    assert.equal(await balance(shopper, 'USDT'), '2.500000', 'credited once');
    await ledgerOk();
  });

  test('a transfer too large for the ledger is ignored, never credited, and never jams the scan', async () => {
    const shopper = await customer();
    const address = (await shopper.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDT', chain: 'BSC' })).json.address;
    chain.state.latest += 5n;
    const block = chain.state.latest - 3n;
    // BEP-20 USDT has 18 places on chain and 6 in the ledger: this is 2^70 ledger units, above a BIGINT.
    evmTransfer(chain.state, { hash: txHash(14), to: address, raw: 2n ** 70n * 10n ** 12n, block, contract: bscUsdt });
    evmTransfer(chain.state, { hash: txHash(15), to: address, raw: 3n * 10n ** 18n, block, contract: bscUsdt });
    const run = await cron('crypto');
    assert.equal(run.result.deposits['test:BSC'].error, undefined, JSON.stringify(run.result.deposits['test:BSC']));
    const huge = await prisma.cryptoDeposit.findFirstOrThrow({ where: { txHash: txHash(14) } });
    assert.deepEqual([huge.status, huge.amount, huge.rawAmount], ['ignored', 0n, String(2n ** 70n * 10n ** 12n)]);
    chain.state.latest += 20n;
    await cron('crypto');
    assert.equal(await balance(shopper, 'USDT'), '3.000000', 'the other deposit in the same blocks is credited');
    await ledgerOk();
  });

  test('a deposit that cannot move never holds up the others; operations are told when a mode has no provider', async () => {
    const shopper = await customer();
    const address = (await shopper.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' })).json.address;
    // 60 old pending sandbox deposits on a chain with no provider: more than one run's batch.
    const old = new Date(Date.now() - 86_400_000);
    await prisma.cryptoDeposit.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({ customerId: shopper.id, mode: 'test', chain: 'SOLANA', asset: 'USDC', address: 'So1anaAddress', txHash: `stuck${i}`, outputIndex: 0, rawAmount: '1', amount: 1n, createdAt: old })),
    });
    try {
      chain.state.latest += 5n;
      evmTransfer(chain.state, { hash: txHash(16), to: address, raw: 4_500_000n, block: chain.state.latest - 3n });
      await cron('crypto');
      chain.state.latest += 20n;
      await cron('crypto');
      await cron('crypto');
      assert.equal(await balance(shopper, 'USDT'), '4.500000', 'credited despite older deposits that cannot move');
      const stuck = await prisma.cryptoDeposit.findMany({ where: { chain: 'SOLANA', status: 'pending' } });
      assert.ok(stuck.every(item => item.checkedAt), 'each is tried in turn');
      const today = new Date().toISOString().slice(0, 10);
      const told = await prisma.notification.findMany({ where: { type: 'admin.crypto.deposit_stuck', dedupeKey: `admin.crypto.deposit_stuck:no_route:test:SOLANA:${today}` } });
      assert.ok(told.length, 'operations are told');
      assert.equal(new Set(told.map(item => item.userId)).size, told.length, 'once per admin');
    } finally {
      await prisma.cryptoDeposit.deleteMany({ where: { chain: 'SOLANA', customerId: shopper.id } });
    }
  });

  test('the job keeps to its deadline: out of time, it stops scanning instead of running past the function limit', async () => {
    const { CryptoDepositsService } = await import('../dist/crypto/chains/deposits.service.js');
    const deposits = server.app.get(CryptoDepositsService);
    const summary = await deposits.job({ deadline: Date.now() - 1 });
    assert.deepEqual(summary.settled, { checked: 0, credited: 0 });
    assert.deepEqual(summary['test:ETHEREUM'], { skipped: 'out of time' });
    assert.deepEqual(summary.notices, { skipped: 'out of time' });
  });
});

describe('providers on the wrong network', () => {
  test('an endpoint still on a test network never serves live stores; Test connection says why', async () => {
    const { forgetNetworks } = await import('../dist/crypto/chains/client.js');
    forgetNetworks();
    // Sandbox off (live), but the pasted endpoint is on Sepolia.
    chain.state.chainIds['/evm3'] = '0xaa36a7';
    await update('chainstack', { CHAINSTACK_ETHEREUM_URL: `${chain.url}/evm3` });
    const tested = (await afrippaAdmin.post('/v1/afrippa/admin/integrations/chainstack/test')).json;
    assert.equal(tested.ok, false);
    assert.equal(tested.environment, 'live');
    assert.match(tested.message, /^Ethereum: refused: the endpoint is on a test network \(11155111\)/);
    const { CryptoDepositsService } = await import('../dist/crypto/chains/deposits.service.js');
    const deposits = server.app.get(CryptoDepositsService);
    assert.deepEqual((await deposits.routes('ETHEREUM', 'live')).map(route => route.provider.id), [], 'never routed for live deposits');
    const route = (await afrippaAdmin.get('/v1/afrippa/admin/crypto/chains')).json.data.find(item => item.chain === 'ETHEREUM').routes.find(item => item.provider === 'chainstack');
    assert.match(route.last_error, /test network/);

    // On the main network it serves live stores.
    chain.state.chainIds['/evm3'] = '0x1';
    forgetNetworks();
    assert.equal((await afrippaAdmin.post('/v1/afrippa/admin/integrations/chainstack/test')).json.ok, true);
    assert.deepEqual((await deposits.routes('ETHEREUM', 'live')).map(item => item.provider.id), ['chainstack']);

    // A sandbox endpoint on the main network is refused too (real coins never reach sandbox wallets).
    await update('chainstack', { CHAINSTACK_SANDBOX: true });
    const sandbox = (await afrippaAdmin.post('/v1/afrippa/admin/integrations/chainstack/test')).json;
    assert.deepEqual([sandbox.ok, sandbox.environment], [false, 'sandbox']);
    assert.match(sandbox.message, /main network/);
    assert.ok(!(await deposits.routes('ETHEREUM', 'test')).some(item => item.provider.id === 'chainstack'));
    await update('chainstack', { CHAINSTACK_SANDBOX: false });
  });

  test('a Bitcoin endpoint is checked by its genesis block', async () => {
    const { forgetNetworks } = await import('../dist/crypto/chains/client.js');
    forgetNetworks();
    // Blockstream switched to live, but pointed at the testnet Esplora.
    await update('blockstream', { BLOCKSTREAM_ENABLED: true, BLOCKSTREAM_API_URL: `${chain.url}/btc` });
    const tested = (await afrippaAdmin.post('/v1/afrippa/admin/integrations/blockstream/test')).json;
    assert.equal(tested.ok, false);
    assert.match(tested.message, /test network/);
    const { CryptoDepositsService } = await import('../dist/crypto/chains/deposits.service.js');
    assert.deepEqual((await server.app.get(CryptoDepositsService).routes('BITCOIN', 'live')).length, 0);
    await update('blockstream', { BLOCKSTREAM_ENABLED: false });
    // mempool.space in the sandbox (testnet4) is fine.
    assert.equal((await afrippaAdmin.post('/v1/afrippa/admin/integrations/mempool/test')).json.ok, true);
  });

  test('a TRON endpoint is checked by its genesis block', async () => {
    const { forgetNetworks } = await import('../dist/crypto/chains/client.js');
    const { CryptoDepositsService } = await import('../dist/crypto/chains/deposits.service.js');
    const deposits = server.app.get(CryptoDepositsService);
    forgetNetworks();
    // GetBlock switched to live, but its pasted TRON endpoint is on Nile.
    await update('getblock', { GETBLOCK_TRON_URL: `${chain.url}/tron`, GETBLOCK_SANDBOX: false });
    const tested = (await afrippaAdmin.post('/v1/afrippa/admin/integrations/getblock/test')).json;
    assert.equal(tested.ok, false);
    assert.match(tested.message, /TRON: refused: the endpoint is on a test network/);
    assert.ok(!(await deposits.routes('TRON', 'live')).some(item => item.provider.id === 'getblock'), 'never routed for live deposits');
    chain.state.tronGenesis = '00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc';
    forgetNetworks();
    assert.ok((await deposits.routes('TRON', 'live')).some(item => item.provider.id === 'getblock'), 'on mainnet it serves live stores');
    chain.state.tronGenesis = '0000000000000000d698d4192c56cb6be724a558448e2684802de4d6cd8690dc';
    forgetNetworks();
    await update('getblock', { GETBLOCK_SANDBOX: true });
  });
});
test('request logs never carry query values (webhook tokens, preview links)', async () => {
  const { loggerParams, redactUrl } = await import('../dist/common/request/logging.js');
  assert.equal(redactUrl('/v1/webhooks/didww-sms?token=secret&x=1'), '/v1/webhooks/didww-sms?token=[redacted]&x=[redacted]');
  assert.equal(redactUrl('/v1/health'), '/v1/health');
  const serialised = loggerParams({ LOG_LEVEL: 'info' }).pinoHttp.serializers.req({ method: 'POST', url: '/v1/webhooks/esim-access?token=abc', query: { token: 'abc' } });
  assert.deepEqual([serialised.url, serialised.query, serialised.method], ['/v1/webhooks/esim-access?token=[redacted]', { token: '[redacted]' }, 'POST']);
  assert.ok(!JSON.stringify(serialised).includes('abc'));
});
