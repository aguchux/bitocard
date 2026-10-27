// On-chain crypto withdrawals: saved addresses (validated, screened, usable after 24 hours, never a BitoCard deposit
// address), the emailed code, the 24-hour limit, admin review, BitoCard's signer (unclear is not failed, the same
// reference every time, a definite refusal returns the money), settling once the chain shows the transfer confirmed.
import assert from 'node:assert/strict';
import { createHmac, pbkdf2Sync } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { HDKey } from '@scure/bip32';
import { adminClient, afrippaAdminClient, adminCode, fakeService, lastEmailCode, startApp } from './helpers.mjs';

let server;
let admin;
let finance;
/** Afrippa's admins (its own realm): Afrippa's admin routes refuse BitoCard's admins. */
let afrippaAdmin;
let afrippaFinance;
let prisma;
let fakes;

const seed = pbkdf2Sync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', 'mnemonic', 2048, 64, 'sha512');
const testnet = HDKey.fromMasterSeed(seed, { private: 0x04358394, public: 0x043587cf });
const usdtContract = '0x7169d38820dfd117c3fa1f22a697dba58d90ba06';
const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const pad = address => `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
const hex = value => `0x${BigInt(value).toString(16)}`;
const outside = '0x52908400098527886E0F7030069857D2E4169EE7';
const flagged = '0x8589427373D6D84E98730D7795D8f6f8731FDA16';
const signerSecret = 'signer-shared-secret-at-least-32-chars';

/** A fake signer, a fake sanctions screener and a fake EVM chain (to read what the signer sent). */
async function fakeWorld() {
  const state = { flagged: new Set([flagged.toLowerCase()]), mode: 'ok', transfers: new Map(), latest: 100n, txs: new Map(), sent: [], badSignatures: 0, holdings: [], tracked: [] };
  const verified = call => {
    const header = call.headers['bitocard-signer-signature'] ?? '';
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header) ?? [];
    const body = call.method === 'GET' ? new URL(call.url, 'http://x').pathname : call.raw.toString('utf8');
    const ok = t && v1 === createHmac('sha256', signerSecret).update(`${t}.${body}`).digest('hex');
    if (!ok) state.badSignatures += 1;
    return ok;
  };
  // The signer signs every reply over the request's own signature (docs/crypto-signer.md), unless told to forge one.
  const signed = (call, reply) => {
    const body = JSON.stringify(reply.body ?? {});
    const v1 = /v1=([0-9a-f]{64})/.exec(call.headers['bitocard-signer-signature'] ?? '')?.[1] ?? '';
    const t = Math.floor(Date.now() / 1000);
    const secret = state.replySecret ?? signerSecret;
    const signature = `t=${t},v1=${createHmac('sha256', secret).update(`reply.${t}.${v1}.${reply.status ?? 200}.${body}`).digest('hex')}`;
    return { ...reply, body, headers: { 'content-type': 'application/json', ...(state.unsignedReplies ? {} : { 'bitocard-signer-signature': signature }) } };
  };
  const service = await fakeService(call => {
    const path = new URL(call.url, 'http://x').pathname;
    const reply = answer(call, path);
    return path.startsWith('/signer/') ? signed(call, reply) : reply;
  });
  function answer(call, path) {
    if (path.startsWith('/screen/api/v1/address/')) {
      const address = decodeURIComponent(path.split('/').at(-1));
      return { body: { identifications: state.flagged.has(address.toLowerCase()) ? [{ category: 'sanctions', name: 'SANCTIONS: OFAC SDN' }] : [] } };
    }
    if (path === '/evm') {
      const { method, params, id } = call.body;
      const result = method === 'eth_chainId' ? '0xaa36a7' : method === 'eth_blockNumber' ? hex(state.latest) : method === 'eth_getTransactionByHash' ? (state.txs.get(params[0])?.tx ?? null) : method === 'eth_getTransactionReceipt' ? (state.txs.get(params[0])?.receipt ?? null) : null;
      return { body: { jsonrpc: '2.0', id, result } };
    }
    if (!path.startsWith('/signer/')) return { status: 404, body: {} };
    if (!verified(call)) return { status: 401, body: { error: { message: 'bad signature' } } };
    if (path === '/signer/v1/health') return { body: { network: 'testnet' } };
    if (path === '/signer/v1/balances/testnet') return { body: { network: 'testnet', balances: state.holdings } };
    if (path === '/signer/v1/deposit-addresses') {
      state.tracked.push(call.body);
      return { body: { chain: call.body.chain, index: call.body.index, address: call.body.address } };
    }
    if (call.method === 'GET') {
      const reference = decodeURIComponent(path.split('/').at(-1));
      const found = state.transfers.get(reference);
      return found ? { body: found } : { status: 404, body: {} };
    }
    const body = call.body;
    if (state.mode === 'down') return { status: 503, body: {} };
    if (state.mode === 'refuse') return { status: 422, body: { error: { message: 'above the hot wallet limit' } } };
    const existing = state.transfers.get(body.reference);
    if (existing) return { body: existing };
    state.sent.push(body);
    const hash = `0x${String(state.sent.length).padStart(64, 'e')}`;
    const transfer = { reference: body.reference, status: state.mode === 'failed' ? 'failed' : 'broadcast', tx_hash: state.mode === 'failed' ? null : hash, reason: state.mode === 'failed' ? 'nonce too low' : null };
    state.transfers.set(body.reference, transfer);
    if (state.mode === 'lost_reply') return { status: 504, body: {} };
    return { body: transfer };
  }
  return Object.assign(service, { state });
}

/** The transfer the signer made, as the fake chain shows it (a USDT Transfer log in a block). */
function mine(state, { hash, to, raw, block }) {
  const log = { transactionHash: hash, logIndex: '0x2', blockNumber: hex(block), address: usdtContract, topics: [transferTopic, pad('0x2222222222222222222222222222222222222222'), pad(to)], data: hex(raw) };
  state.txs.set(hash, { tx: { to: usdtContract, value: '0x0', blockNumber: hex(block) }, receipt: { status: '0x1', blockNumber: hex(block), logs: [log] } });
}

const update = async (id, values) => {
  const res = await afrippaAdmin.put(`/v1/afrippa/admin/integrations/${id}`, { values, code: await adminCode(server, afrippaAdmin) });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return res.json;
};
const cron = job => fetch(`${server.base}/v1/cron/${job}`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json());
const ledgerOk = async () => assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);

before(async () => {
  fakes = await fakeWorld();
  server = await startApp({ env: { CHECKOUT_SANDBOX: 'on', CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server);
  finance = await adminClient(server, ['finance']);
  afrippaAdmin = await afrippaAdminClient(server);
  afrippaFinance = await afrippaAdminClient(server, ['finance']);
  for (const key of ['crypto_wallets', 'p2p_trading']) await admin.put(`/v1/admin/switches/${key}`, { enabled: true });
  await update('crypto_keys', { CRYPTO_TEST_XPUB_EVM: testnet.derive("m/44'/60'/0'").publicExtendedKey });
  await update('getblock', { GETBLOCK_ETHEREUM_URL: `${fakes.url}/evm`, GETBLOCK_SANDBOX: true });
  const usdt = await prisma.cryptoNetwork.findUniqueOrThrow({ where: { asset_chain: { asset: 'USDT', chain: 'ETHEREUM' } } });
  const changed = await afrippaAdmin.patch(`/v1/afrippa/admin/crypto/networks/${usdt.id}`, { deposits_enabled: true, withdrawals_enabled: true, test_contract: usdtContract, withdrawal_fee: '1.5', min_withdrawal: '5' });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  assert.deepEqual([changed.json.withdrawals_enabled, changed.json.withdrawal_fee, changed.json.min_withdrawal], [true, '1.5', '5']);
  const limits = await afrippaAdmin.patch('/v1/afrippa/admin/crypto/assets/USDT', { withdrawal_daily_limit: '500', withdrawal_review_from: '300' });
  assert.deepEqual([limits.status, limits.json.withdrawal_daily_limit, limits.json.withdrawal_review_from], [200, '500', '300']);
});

after(async () => {
  await server?.close();
  await fakes?.close();
});

let counter = 0;
async function customer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { 'bitocard-customer-session': token } : {}), ...(method === 'POST' ? { 'idempotency-key': `w-${Math.random()}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  const email = `withdraw${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await request('POST', '/v1/store/account/signup', { name: 'Ada Sender', email, password: 'correct horse battery', country: 'NG' });
  await request('POST', '/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) });
  const shopper = { id: signup.json.customer.id, email, get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), del: path => request('DELETE', path) };
  await shopper.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount: '1000' });
  return shopper;
}

const balance = async (shopper, asset = 'USDT') => (await shopper.get('/v1/afrippa/crypto')).json.assets.find(item => item.asset === asset).available;

/** A saved address made usable now (the 24-hour wait is tested on its own). */
async function readyAddress(shopper, address = outside) {
  const added = await shopper.post('/v1/afrippa/crypto/withdrawal-addresses', { chain: 'ETHEREUM', address, label: 'My wallet' });
  assert.equal(added.status, 201, JSON.stringify(added.json));
  await prisma.cryptoWithdrawalAddress.update({ where: { id: added.json.id }, data: { usableFrom: new Date(Date.now() - 1000) } });
  return added.json;
}

/** Asks for and confirms a withdrawal with the emailed code. */
async function withdraw(shopper, addressId, amount) {
  const asked = await shopper.post('/v1/afrippa/crypto/withdrawals', { asset: 'USDT', chain: 'ETHEREUM', address_id: addressId, amount });
  assert.equal(asked.status, 201, JSON.stringify(asked.json));
  const confirmed = await shopper.post(`/v1/afrippa/crypto/withdrawals/${asked.json.id}/confirm`, { code: await lastEmailCode(server.app, shopper.email) });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  return confirmed.json;
}

const settle = async id => {
  for (let i = 0; i < 4; i += 1) {
    await prisma.cryptoWithdrawal.updateMany({ where: { id }, data: { nextCheckAt: null } });
    await cron('crypto');
  }
  return prisma.cryptoWithdrawal.findUniqueOrThrow({ where: { id } });
};

describe('signer and screening integrations', () => {
  test('the signer and both screeners have cards in the Blockchain section; the shared secret must be long', async () => {
    const list = (await afrippaAdmin.get('/v1/afrippa/admin/integrations')).json.data.filter(item => item.section === 'blockchain').map(item => item.id);
    assert.deepEqual(list.slice(-4), ['crypto_signer', 'chainalysis', 'trm', 'crypto_prices']);
    const short = await afrippaAdmin.put('/v1/afrippa/admin/integrations/crypto_signer', { values: { CRYPTO_SIGNER_SECRET: 'short' }, code: await adminCode(server, afrippaAdmin) });
    assert.deepEqual([short.status, short.json.error.param], [400, 'values.CRYPTO_SIGNER_SECRET']);
    await update('chainalysis', { CHAINALYSIS_API_KEY: 'ca-key-1234', CHAINALYSIS_API_URL: `${fakes.url}/screen` });
    const screened = (await afrippaAdmin.post('/v1/afrippa/admin/integrations/chainalysis/test')).json;
    assert.equal(screened.ok, true, screened.message);
    assert.equal(fakes.calls.at(-1).headers['x-api-key'], 'ca-key-1234');
  });

  test('the signer and screeners are reached over HTTPS only', async () => {
    for (const [id, key] of [['crypto_signer', 'CRYPTO_SIGNER_URL'], ['chainalysis', 'CHAINALYSIS_API_URL']]) {
      const plain = await afrippaAdmin.put(`/v1/afrippa/admin/integrations/${id}`, { values: { [key]: 'http://signer.example.com' }, code: await adminCode(server, afrippaAdmin) });
      assert.deepEqual([plain.status, plain.json.error?.param], [400, `values.${key}`], `${key} over plain HTTP is refused`);
    }
  });
});

describe('withdrawal addresses', () => {
  test('addresses are checked for the network, never a BitoCard deposit address, and refused when sanctioned', async () => {
    const shopper = await customer();
    const bad = await shopper.post('/v1/afrippa/crypto/withdrawal-addresses', { chain: 'ETHEREUM', address: '0x52908400098527886E0F7030069857D2E4169Ee7', label: 'Typo' });
    assert.deepEqual([bad.status, bad.json.error.code], [400, 'address_invalid'], 'a wrong checksum is refused');
    const own = (await shopper.post('/v1/afrippa/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' })).json.address;
    const internal = await shopper.post('/v1/afrippa/crypto/withdrawal-addresses', { chain: 'ETHEREUM', address: own.toLowerCase(), label: 'Mine' });
    assert.deepEqual([internal.status, internal.json.error.code], [400, 'address_internal']);
    const sanctioned = await shopper.post('/v1/afrippa/crypto/withdrawal-addresses', { chain: 'ETHEREUM', address: flagged, label: 'Bad' });
    assert.deepEqual([sanctioned.status, sanctioned.json.error.code], [400, 'address_refused']);
    assert.ok(await prisma.notification.findFirst({ where: { type: 'admin.crypto.address_flagged' } }), 'admins are told');
    const btc = await shopper.post('/v1/afrippa/crypto/withdrawal-addresses', { chain: 'BITCOIN', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', label: 'Mainnet' });
    assert.deepEqual([btc.status, btc.json.error.code], [400, 'address_invalid'], 'sandbox stores take test network addresses only');
    const testBtc = await shopper.post('/v1/afrippa/crypto/withdrawal-addresses', { chain: 'BITCOIN', address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', label: 'Testnet' });
    assert.equal(testBtc.status, 201, JSON.stringify(testBtc.json));
  });

  test('a new address can be used only after 24 hours; the customer is emailed and told', async () => {
    const shopper = await customer();
    const added = await shopper.post('/v1/afrippa/crypto/withdrawal-addresses', { chain: 'ETHEREUM', address: outside.toLowerCase(), label: 'Cold wallet' });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.equal(added.json.address, outside, 'kept checksummed');
    assert.equal(added.json.ready, false);
    assert.ok(new Date(added.json.usable_from).getTime() > Date.now() + 23 * 3_600_000);
    const again = await shopper.post('/v1/afrippa/crypto/withdrawal-addresses', { chain: 'ETHEREUM', address: outside, label: 'Twice' });
    assert.deepEqual([again.status, again.json.error.code], [409, 'address_exists']);
    const early = await shopper.post('/v1/afrippa/crypto/withdrawals', { asset: 'USDT', chain: 'ETHEREUM', address_id: added.json.id, amount: '10' });
    assert.deepEqual([early.status, early.json.error.code], [409, 'address_not_ready']);
    const { EmailService } = await import('../dist/notifications/email.service.js');
    assert.ok(server.app.get(EmailService).outbox.some(item => item.to === shopper.email && /withdrawal address was added/.test(item.subject)));
    assert.ok(await prisma.notification.findFirst({ where: { customerId: shopper.id, type: 'customer.crypto.address_added' } }));
    const listed = (await shopper.get('/v1/afrippa/crypto/withdrawal-addresses')).json.data;
    assert.deepEqual(listed.map(item => item.label), ['Cold wallet']);
    assert.equal((await shopper.del(`/v1/afrippa/crypto/withdrawal-addresses/${added.json.id}`)).status, 200);
    assert.equal((await shopper.get('/v1/afrippa/crypto/withdrawal-addresses')).json.data.length, 0);
  });
  test('a saved address is screened again once its last check is a day old, and refused if now sanctioned', async () => {
    const shopper = await customer();
    const later = '0x00000000219ab540356cbb839cbe05303d7705fa';
    const address = await readyAddress(shopper, later);
    fakes.state.flagged.add(later.toLowerCase());
    try {
      const recent = await shopper.post('/v1/afrippa/crypto/withdrawals', { asset: 'USDT', chain: 'ETHEREUM', address_id: address.id, amount: '10' });
      assert.equal(recent.status, 201, 'checked today: not asked again');
      await shopper.post(`/v1/afrippa/crypto/withdrawals/${recent.json.id}/cancel`);
      await prisma.cryptoWithdrawalAddress.update({ where: { id: address.id }, data: { screenedAt: new Date(Date.now() - 25 * 3_600_000) } });
      const refused = await shopper.post('/v1/afrippa/crypto/withdrawals', { asset: 'USDT', chain: 'ETHEREUM', address_id: address.id, amount: '10' });
      assert.deepEqual([refused.status, refused.json.error?.code], [400, 'address_refused']);
      assert.equal((await prisma.cryptoWithdrawalAddress.findUniqueOrThrow({ where: { id: address.id } })).screening, 'flagged');
      assert.ok(await prisma.notification.findFirst({ where: { type: 'admin.crypto.address_flagged', body: { contains: shopper.email } } }));
      assert.equal(await balance(shopper), '1000.000000', 'nothing left the wallet');
    } finally {
      fakes.state.flagged.delete(later.toLowerCase());
    }
  });
});

describe('withdrawals in the sandbox (simulated signer)', () => {
  test('the amount and fee leave the wallet at once, the emailed code confirms it, and it settles once', async () => {
    const shopper = await customer();
    const address = await readyAddress(shopper);
    const preview = await shopper.post('/v1/afrippa/crypto/withdrawals', { asset: 'USDT', chain: 'ETHEREUM', address_id: address.id, amount: '100', preview: true });
    assert.deepEqual([preview.json.amount, preview.json.fee, preview.json.total, preview.json.needs_approval], ['100.000000', '1.500000', '101.500000', false]);
    assert.equal(await balance(shopper), '1000.000000', 'a preview moves nothing');
    const small = await shopper.post('/v1/afrippa/crypto/withdrawals', { asset: 'USDT', chain: 'ETHEREUM', address_id: address.id, amount: '4' });
    assert.deepEqual([small.status, small.json.error.code], [400, 'amount_too_small']);

    const asked = await shopper.post('/v1/afrippa/crypto/withdrawals', { asset: 'USDT', chain: 'ETHEREUM', address_id: address.id, amount: '100' });
    assert.deepEqual([asked.status, asked.json.status, asked.json.number.startsWith('CW-')], [201, 'awaiting_code', true]);
    assert.equal(await balance(shopper), '898.500000');
    const { EmailService } = await import('../dist/notifications/email.service.js');
    const mail = server.app.get(EmailService).outbox.filter(item => item.to === shopper.email).at(-1);
    assert.match(mail.text, /send 100\.000000 USDT on Ethereum to 0x52908400098527886E0F7030069857D2E4169EE7/);
    const wrong = await shopper.post(`/v1/afrippa/crypto/withdrawals/${asked.json.id}/confirm`, { code: '000000' });
    assert.deepEqual([wrong.status, wrong.json.error.code], [400, 'code_invalid']);
    const confirmed = await shopper.post(`/v1/afrippa/crypto/withdrawals/${asked.json.id}/confirm`, { code: await lastEmailCode(server.app, shopper.email) });
    assert.ok(['queued', 'submitting', 'broadcast'].includes(confirmed.json.status), 'on its way to the signer');
    const done = await settle(asked.json.id);
    assert.equal(done.status, 'completed');
    assert.match(done.txHash, /^0x[0-9a-f]{64}$/);
    assert.equal(await balance(shopper), '898.500000', 'settled once');
    // BitoCard's fees are spread over several accounts: their sum.
    const fees = (await prisma.ledgerAccount.aggregate({ where: { kind: 'crypto_fees', mode: 'test', currency: 'USDT' }, _sum: { balanceMinor: true } }))._sum.balanceMinor;
    assert.ok(fees >= 1_500_000n);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: shopper.id, type: 'customer.crypto.withdrawal_sent' } }));
    const listed = (await shopper.get('/v1/afrippa/crypto/withdrawals')).json.data;
    assert.deepEqual(listed.map(item => [item.status, item.total]), [['completed', '101.500000']]);
    const transactions = (await shopper.get('/v1/afrippa/crypto/transactions?asset=USDT')).json.data;
    assert.ok(transactions.some(item => item.type === 'crypto_withdrawal' && item.amount === '-101.500000'));
    await ledgerOk();
  });

  test('the 24-hour limit holds even for parallel requests; cancelling and expired codes return the money', async () => {
    const shopper = await customer();
    const address = await readyAddress(shopper);
    const results = await Promise.all([1, 2, 3].map(() => shopper.post('/v1/afrippa/crypto/withdrawals', { asset: 'USDT', chain: 'ETHEREUM', address_id: address.id, amount: '200' })));
    assert.deepEqual(results.map(item => item.status).sort(), [201, 201, 400], 'only 400 of the 500 limit fit');
    assert.equal(results.find(item => item.status === 400).json.error.code, 'withdrawal_limit');
    const [first, second] = results.filter(item => item.status === 201).map(item => item.json);
    assert.equal(await balance(shopper), '597.000000');
    const cancelled = await shopper.post(`/v1/afrippa/crypto/withdrawals/${first.id}/cancel`);
    assert.equal(cancelled.json.status, 'cancelled');
    assert.equal((await shopper.post(`/v1/afrippa/crypto/withdrawals/${first.id}/cancel`)).status, 409, 'once');
    await prisma.cryptoWithdrawal.update({ where: { id: second.id }, data: { codeExpiresAt: new Date(Date.now() - 1000) } });
    await cron('crypto');
    assert.equal((await prisma.cryptoWithdrawal.findUniqueOrThrow({ where: { id: second.id } })).status, 'cancelled');
    assert.equal(await balance(shopper), '1000.000000');
    await ledgerOk();
  });

  test('large withdrawals wait for finance; a rejection returns the money, an approval sends it', async () => {
    const shopper = await customer();
    const address = await readyAddress(shopper);
    const big = await withdraw(shopper, address.id, '300');
    assert.deepEqual([big.status, big.review_reason], ['review', 'amount']);
    assert.ok(await prisma.notification.findFirst({ where: { type: 'admin.crypto.withdrawal_review' } }));
    const afrippaSupport = await afrippaAdminClient(server, ['support']);
    assert.equal((await afrippaSupport.post(`/v1/afrippa/admin/crypto/withdrawals/${big.id}/approve`, { note: 'looks fine' })).status, 403);
    const rejected = await afrippaAdmin.post(`/v1/afrippa/admin/crypto/withdrawals/${big.id}/reject`, { note: 'unusual pattern' });
    assert.deepEqual([rejected.status, rejected.json.status], [200, 'rejected']);
    assert.equal(await balance(shopper), '1000.000000');
    assert.ok(await prisma.notification.findFirst({ where: { customerId: shopper.id, type: 'customer.crypto.withdrawal_failed' } }));

    // The limit counts only withdrawals still on their way or sent.
    const next = await withdraw(shopper, address.id, '300');
    const approved = await afrippaFinance.post(`/v1/afrippa/admin/crypto/withdrawals/${next.id}/approve`, { note: 'called the customer' });
    assert.deepEqual([approved.status, approved.json.status === 'queued' || approved.json.status === 'submitting' || approved.json.status === 'broadcast'], [200, true]);
    assert.equal((await settle(next.id)).status, 'completed');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'crypto.withdrawal_approved', targetId: next.id } }));
    await ledgerOk();
  });

  test('without a real signer the custody check says it could not be asked', async () => {
    const run = await afrippaFinance.post('/v1/afrippa/admin/crypto/reconciliations/run', { mode: 'test' });
    assert.equal(run.status, 200, JSON.stringify(run.json));
    assert.match(run.json.error, /No signer/);
    assert.ok(run.json.data.every(item => item.status === 'unavailable'));
  });
  test('a frozen account sends nothing more', async () => {
    const shopper = await customer();
    const address = await readyAddress(shopper);
    const asked = (await shopper.post('/v1/afrippa/crypto/withdrawals', { asset: 'USDT', chain: 'ETHEREUM', address_id: address.id, amount: '20' })).json;
    await afrippaAdmin.put(`/v1/afrippa/admin/crypto/customers/${shopper.id}/account-freeze`, { frozen: true, reason: 'investigation' });
    const confirm = await shopper.post(`/v1/afrippa/crypto/withdrawals/${asked.id}/confirm`, { code: await lastEmailCode(server.app, shopper.email) });
    assert.deepEqual([confirm.status, confirm.json.error.code], [403, 'crypto_account_frozen']);
    // Confirmed, then frozen before the signer is asked: returned to the wallet, never sent.
    await prisma.cryptoWithdrawal.update({ where: { id: asked.id }, data: { status: 'queued', codeHash: null, nextCheckAt: null } });
    await cron('crypto');
    const row = await prisma.cryptoWithdrawal.findUniqueOrThrow({ where: { id: asked.id } });
    assert.deepEqual([row.status, row.txHash], ['failed', null]);
    assert.equal(await balance(shopper), '1000.000000');
    await ledgerOk();
  });
});

describe('withdrawals through BitoCard’s signer', () => {
  before(async () => {
    await update('crypto_signer', { CRYPTO_SIGNER_URL: `${fakes.url}/signer`, CRYPTO_SIGNER_SECRET: signerSecret, CRYPTO_SIGNER_SANDBOX: true });
    const tested = (await afrippaAdmin.post('/v1/afrippa/admin/integrations/crypto_signer/test')).json;
    assert.deepEqual([tested.ok, tested.environment], [true, 'sandbox'], tested.message);
  });

  test('an unclear answer is asked again with the same reference; it settles only after the chain confirms it', async () => {
    const shopper = await customer();
    const address = await readyAddress(shopper);
    fakes.state.mode = 'lost_reply';
    const asked = await withdraw(shopper, address.id, '50');
    await settle(asked.id);
    let row = await prisma.cryptoWithdrawal.findUniqueOrThrow({ where: { id: asked.id } });
    fakes.state.mode = 'ok';
    row = await settle(asked.id);
    assert.equal(fakes.state.sent.filter(item => item.reference === row.signerReference).length, 1, 'sent once whatever happened to the reply');
    const sent = fakes.state.sent.find(item => item.reference === row.signerReference);
    assert.deepEqual([sent.chain, sent.network, sent.contract, sent.to, sent.amount, sent.decimals], ['ETHEREUM', 'testnet', usdtContract, outside, '50000000', 6]);
    assert.equal(row.status, 'broadcast', 'not settled before the chain shows it');
    mine(fakes.state, { hash: row.txHash, to: outside, raw: 50_000_000n, block: 95n });
    row = await settle(asked.id);
    assert.deepEqual([row.status, row.confirmations], ['broadcast', 6], 'waiting for 12 confirmations');
    fakes.state.latest = 120n;
    row = await settle(asked.id);
    assert.equal(row.status, 'completed');
    assert.equal(await balance(shopper), '948.500000');
    assert.equal(fakes.state.badSignatures, 0);
    await ledgerOk();
  });

  test('the signer is told once about each address a deposit arrived at, so it sweeps it', async () => {
    const shopper = await customer();
    const address = await prisma.cryptoAddress.create({
      data: { customerId: shopper.id, mode: 'test', family: 'evm', index: 4242, address: '0x00000000000000000000000000000000000042aa', keyFingerprint: 'test', watchUntil: new Date() },
    });
    for (const [tx, status] of [['0xaa01', 'credited'], ['0xaa02', 'pending'], ['0xaa03', 'failed']]) {
      await prisma.cryptoDeposit.create({ data: { customerId: shopper.id, mode: 'test', chain: 'ETHEREUM', asset: 'USDT', address: address.address, txHash: tx, outputIndex: 0, rawAmount: '1', amount: 1n, status } });
    }
    await cron('crypto');
    await cron('crypto');
    const told = fakes.state.tracked.filter(item => item.address === address.address);
    assert.deepEqual(told, [{ chain: 'ETHEREUM', network: 'testnet', index: 4242, address: address.address }], 'once, whatever the number of deposits or runs');
    const rows = await prisma.cryptoDeposit.findMany({ where: { address: address.address }, orderBy: { txHash: 'asc' } });
    assert.deepEqual(rows.map(row => row.signerTrackedAt !== null), [true, true, false], 'a failed deposit is not a reason to sweep');
  });

  test('a transfer to another address or for another amount on chain is never settled', async () => {
    const shopper = await customer();
    const address = await readyAddress(shopper);
    const asked = await withdraw(shopper, address.id, '10');
    let row = await settle(asked.id);
    mine(fakes.state, { hash: row.txHash, to: '0x1111111111111111111111111111111111111111', raw: 10_000_000n, block: 100n });
    fakes.state.latest = 200n;
    row = await settle(asked.id);
    assert.equal(row.status, 'broadcast');
  });

  test('a definite refusal or a reported failure returns the money', async () => {
    const shopper = await customer();
    const address = await readyAddress(shopper);
    fakes.state.mode = 'refuse';
    const refused = await withdraw(shopper, address.id, '10');
    let row = await settle(refused.id);
    assert.deepEqual([row.status, /hot wallet limit/.test(row.error)], ['failed', true]);
    fakes.state.mode = 'failed';
    const failed = await withdraw(shopper, address.id, '10');
    row = await settle(failed.id);
    assert.equal(row.status, 'failed');
    fakes.state.mode = 'ok';
    assert.equal(await balance(shopper), '1000.000000');
    assert.equal((await prisma.notification.count({ where: { customerId: shopper.id, type: 'customer.crypto.withdrawal_failed' } })), 2);
    const listed = (await afrippaAdmin.get(`/v1/afrippa/admin/crypto/withdrawals?customer_id=${shopper.id}`)).json.data;
    assert.deepEqual(listed.map(item => item.status), ['failed', 'failed']);
    await ledgerOk();
  });

  test('an unsigned or forged signer reply is unclear: a refusal is taken as final only when the signer signed it', async () => {
    const shopper = await customer();
    const address = await readyAddress(shopper);
    fakes.state.mode = 'refuse';
    fakes.state.unsignedReplies = true;
    try {
      const asked = await withdraw(shopper, address.id, '10');
      let row = await settle(asked.id);
      assert.deepEqual([row.status, /unsigned or wrongly signed/.test(row.error)], ['submitting', true], 'an unsigned refusal returns nothing');
      fakes.state.unsignedReplies = false;
      fakes.state.replySecret = 'someone-else-secret-at-least-32-characters';
      row = await settle(asked.id);
      assert.equal(row.status, 'submitting', 'nor a reply signed with another secret');
      assert.equal(await balance(shopper), '988.500000', 'the money stays set aside');
      delete fakes.state.replySecret;
      row = await settle(asked.id);
      assert.equal(row.status, 'failed', 'the signer’s signed refusal returns it');
      assert.equal(await balance(shopper), '1000.000000');
    } finally {
      fakes.state.mode = 'ok';
      fakes.state.unsignedReplies = false;
      delete fakes.state.replySecret;
    }
    await ledgerOk();
  });

  test('the custody check compares the ledger with what the signer holds, and tells admins of a shortfall', async t => {
    const run = async () => {
      const res = await afrippaFinance.post('/v1/afrippa/admin/crypto/reconciliations/run', { mode: 'test' });
      assert.equal(res.status, 200, JSON.stringify(res.json));
      return res.json;
    };
    // A test-network deposit on its way is real crypto the signer must hold; sandbox test credits never reached the chain.
    const customerId = (await prisma.customer.findFirstOrThrow()).id;
    const arriving = await prisma.cryptoDeposit.create({ data: { customerId, mode: 'test', chain: 'ETHEREUM', asset: 'USDT', address: outside, txHash: `0x${'f'.repeat(64)}`, outputIndex: 1, rawAmount: '5000000000', amount: 5_000_000_000n } });
    t.after(() => prisma.cryptoDeposit.delete({ where: { id: arriving.id } }));
    fakes.state.holdings = [];
    const empty = await run();
    const usdt = empty.data.find(item => item.asset === 'USDT');
    assert.equal(usdt.status, 'shortfall', 'the signer holds nothing yet');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'admin.crypto.custody_shortfall' } }));
    const expected = BigInt(usdt.expected.replace('.', ''));
    fakes.state.holdings = [
      { chain: 'ETHEREUM', asset: 'USDT', contract: usdtContract.toUpperCase().replace('0X', '0x'), amount: String(expected), decimals: 6 },
      { chain: 'ETHEREUM', asset: 'XYZ', contract: '0x9999999999999999999999999999999999999999', amount: '5', decimals: 18 },
    ];
    const matched = await run();
    assert.deepEqual([matched.data.find(item => item.asset === 'USDT').status, matched.data.find(item => item.asset === 'USDT').held], ['matched', usdt.expected]);
    assert.deepEqual(matched.unmatched.map(item => item.asset), ['XYZ'], 'an unknown token is reported, never counted');
    fakes.state.holdings[0].amount = String(expected + 2_000_000n);
    const surplus = (await run()).data.find(item => item.asset === 'USDT');
    assert.deepEqual([surplus.status, surplus.difference], ['surplus', '2.000000']);
    const latest = (await afrippaAdmin.get('/v1/afrippa/admin/crypto/reconciliations?mode=test')).json.data.find(item => item.asset === 'USDT');
    assert.equal(latest.status, 'surplus');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'crypto.reconciliation_run' } }));
    const afrippaSupport = await afrippaAdminClient(server, ['support']);
    assert.equal((await afrippaSupport.post('/v1/afrippa/admin/crypto/reconciliations/run', { mode: 'test' })).status, 403);
  });

  test('live withdrawals are not offered without a live signer', async () => {
    const withdrawals = server.app.get((await import('../dist/crypto/withdrawals.service.js')).CryptoWithdrawalsService);
    assert.equal(withdrawals.signer('live'), null, 'the signer serves the sandbox only');
  });
});

describe('addresses on each chain', () => {
  test('Bitcoin, TRON and EVM addresses are checked with their checksums', async () => {
    const { withdrawalAddress } = await import('../dist/crypto/withdrawals.service.js');
    assert.equal(withdrawalAddress('BITCOIN', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', false), 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
    assert.equal(withdrawalAddress('BITCOIN', 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297', false), 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297', 'Taproot');
    assert.equal(withdrawalAddress('BITCOIN', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', false), '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'legacy');
    assert.equal(withdrawalAddress('BITCOIN', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', false), '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', 'P2SH');
    assert.equal(withdrawalAddress('BITCOIN', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3', false), null, 'bad checksum');
    assert.equal(withdrawalAddress('BITCOIN', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', true), null, 'mainnet address in the sandbox');
    assert.equal(withdrawalAddress('TRON', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', false), 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
    assert.equal(withdrawalAddress('TRON', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u', false), null);
    assert.equal(withdrawalAddress('BSC', '0x0000000000000000000000000000000000000000', false), null, 'never the zero address');
  });
});
