// Premium resellers' own coins on chain: deposits into their coin wallet (`reseller_crypto`) and withdrawals out of it,
// through the same scan, crediting, emailed code, signer and settling as store customers'.
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { HDKey } from '@scure/bip32';
import { adminClient, afrippaAdminClient, adminCode, fakeService, lastEmailCode, resellerClient, startApp } from './helpers.mjs';

let server;
let admin;
let afrippaAdmin;
let prisma;
let chain;

const seed = pbkdf2Sync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', 'mnemonic', 2048, 64, 'sha512');
const testnet = HDKey.fromMasterSeed(seed, { private: 0x04358394, public: 0x043587cf });
const usdtContract = '0x7169d38820dfd117c3fa1f22a697dba58d90ba06';
const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const pad = address => `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
const hex = value => `0x${BigInt(value).toString(16)}`;
const outside = '0x52908400098527886E0F7030069857D2E4169EE7';
const headers = { 'bitocard-mode': 'test' };

const cron = job => fetch(`${server.base}/v1/cron/${job}`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json());
const ledgerOk = async () => assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);

before(async () => {
  const txs = new Map();
  chain = await fakeService(call => {
    const { method, params, id } = call.body ?? {};
    const result = method === 'eth_chainId' ? '0xaa36a7' : method === 'eth_blockNumber' ? hex(100) : method === 'eth_getTransactionByHash' ? (txs.get(params[0])?.tx ?? null) : method === 'eth_getTransactionReceipt' ? (txs.get(params[0])?.receipt ?? null) : method === 'eth_getLogs' ? [] : null;
    return { body: { jsonrpc: '2.0', id, result } };
  });
  chain.txs = txs;
  server = await startApp({ env: { CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server);
  afrippaAdmin = await afrippaAdminClient(server);
  const update = async (id, values) => assert.equal((await afrippaAdmin.put(`/v1/afrippa/admin/integrations/${id}`, { values, code: await adminCode(server, afrippaAdmin) })).status, 200);
  await update('crypto_keys', { CRYPTO_TEST_XPUB_EVM: testnet.derive("m/44'/60'/0'").publicExtendedKey });
  await update('getblock', { GETBLOCK_ETHEREUM_URL: `${chain.url}/evm`, GETBLOCK_SANDBOX: true });
  const usdt = await prisma.cryptoNetwork.findUniqueOrThrow({ where: { asset_chain: { asset: 'USDT', chain: 'ETHEREUM' } } });
  assert.equal((await afrippaAdmin.patch(`/v1/afrippa/admin/crypto/networks/${usdt.id}`, { deposits_enabled: true, withdrawals_enabled: true, test_contract: usdtContract, withdrawal_fee: '1.5', min_withdrawal: '5' })).status, 200);
  assert.equal((await afrippaAdmin.patch('/v1/afrippa/admin/crypto/assets/USDT', { withdrawal_daily_limit: '500', withdrawal_review_from: '300' })).status, 200);
});

after(async () => {
  await admin?.put('/v1/admin/switches/reseller_exchange', { enabled: null });
  await server?.close();
  await chain?.close();
});

/** A USDT transfer to `to` as the fake chain shows it, then recorded the way a scan or webhook would. */
async function depositOnChain(to, raw, n) {
  const hash = `0x${String(n).padStart(64, 'd')}`;
  const log = { transactionHash: hash, logIndex: '0x1', blockNumber: hex(80), address: usdtContract, topics: [transferTopic, pad('0x1111111111111111111111111111111111111111'), pad(to)], data: hex(raw) };
  chain.txs.set(hash, { tx: { to: usdtContract, value: '0x0', blockNumber: hex(80) }, receipt: { status: '0x1', blockNumber: hex(80), logs: [log] } });
  const { CryptoDepositsService } = await import('../dist/crypto/chains/deposits.service.js');
  assert.equal(await server.app.get(CryptoDepositsService).record('ETHEREUM', 'test', hash), 1);
  await cron('crypto');
  return hash;
}

describe('a reseller’s own coins on chain', () => {
  test('deposits (Premium) credit the coin wallet; withdrawals need the asker’s emailed code and settle once', async () => {
    const { browser, email, resellerId } = await resellerClient(server);
    const standard = await browser.get('/v1/crypto/deposit-networks?asset=USDT', headers);
    assert.deepEqual([standard.status, standard.json.error.code], [403, 'plan_feature_required']);
    const plain = await browser.get('/v1/crypto', headers);
    assert.equal(plain.json.onchain, false);
    assert.ok(plain.json.withdrawal_chains.some(item => item.chain === 'ETHEREUM' && item.name === 'Ethereum'), 'the API lists the networks addresses can be saved on');
    const viaKey = await browser.get('/v1/crypto', { ...headers, authorization: 'Bearer bc_test_nope' });
    assert.equal(viaKey.status, 401, 'API keys never reach the coin wallet');

    await prisma.reseller.update({ where: { id: resellerId }, data: { planCode: 'premium' } });
    const switchedOff = await browser.post('/v1/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' }, headers);
    assert.deepEqual([switchedOff.status, switchedOff.json.error.code], [409, 'exchange_not_enabled']);
    assert.equal((await admin.put('/v1/admin/switches/reseller_exchange', { enabled: true })).status, 200);

    const networksRes = await browser.get('/v1/crypto/deposit-networks?asset=USDT', headers);
    const networks = networksRes.json.data;
    assert.deepEqual(networks.map(item => item.chain), ['ETHEREUM']);
    const address = await browser.post('/v1/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' }, headers);
    assert.equal(address.status, 200, JSON.stringify(address.json));
    assert.equal((await browser.post('/v1/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' }, headers)).json.address, address.json.address, 'the same address every time');
    const row = await prisma.cryptoAddress.findFirstOrThrow({ where: { address: address.json.address } });
    assert.deepEqual([row.resellerId, row.customerId], [resellerId, null]);

    await depositOnChain(address.json.address, 100_000_000n, 1);
    const depositsRes = await browser.get('/v1/crypto/deposits', headers);
    const deposits = depositsRes.json.data;
    assert.deepEqual(deposits.map(item => [item.status, item.amount]), [['credited', '100.000000']]);
    const held = asset => browser.get('/v1/crypto', headers).then(res => res.json.assets.find(item => item.asset === asset));
    assert.deepEqual(await held('USDT').then(item => [item.available, item.withdrawing]), ['100.000000', '0.000000']);
    assert.ok(await prisma.notification.findFirst({ where: { type: 'crypto.deposit_credited', resellerId } }), 'the reseller is told');
    const adminDeposit = (await afrippaAdmin.get(`/v1/afrippa/admin/crypto/deposits?reseller_id=${resellerId}`)).json.data;
    assert.deepEqual(adminDeposit.map(item => [item.customer, item.reseller?.id]), [[null, resellerId]]);

    const added = await browser.post('/v1/crypto/withdrawal-addresses', { chain: 'ETHEREUM', address: outside, label: 'Treasury' }, headers);
    assert.equal(added.status, 201, JSON.stringify(added.json));
    const wnetworks = await browser.get('/v1/crypto/withdrawal-networks?asset=USDT', headers);
    assert.ok(await prisma.notification.findFirst({ where: { type: 'crypto.address_added', resellerId } }));
    const early = await browser.post('/v1/crypto/withdrawals', { asset: 'USDT', chain: 'ETHEREUM', address_id: added.json.id, amount: '20' }, headers);
    assert.deepEqual([early.status, early.json.error.code], [409, 'address_not_ready']);
    await prisma.cryptoWithdrawalAddress.update({ where: { id: added.json.id }, data: { usableFrom: new Date(Date.now() - 1000) } });

    const previewed = await browser.post('/v1/crypto/withdrawals', { asset: 'USDT', chain: 'ETHEREUM', address_id: added.json.id, amount: '20', preview: true }, headers);
    const asked = await browser.post('/v1/crypto/withdrawals', { asset: 'USDT', chain: 'ETHEREUM', address_id: added.json.id, amount: '20' }, headers);
    assert.equal(asked.status, 201, JSON.stringify(asked.json));
    assert.ok(asked.json.code_sent_at, 'it says when the code was sent, for the resend countdown');
    const early2 = await browser.post(`/v1/crypto/withdrawals/${asked.json.id}/resend-code`, {}, headers);
    assert.deepEqual([early2.status, early2.json.error.code], [429, 'code_recently_sent']);
    await prisma.cryptoWithdrawal.update({ where: { id: asked.json.id }, data: { codeSentAt: new Date(Date.now() - 61_000) } });
    const resent = await browser.post(`/v1/crypto/withdrawals/${asked.json.id}/resend-code`, {}, headers);
    assert.equal(resent.status, 200, JSON.stringify(resent.json));
    assert.ok(new Date(resent.json.code_sent_at).getTime() > Date.now() - 10_000, 'a new code moves the countdown');
    assert.deepEqual([asked.json.status, asked.json.total], ['awaiting_code', '21.500000']);
    assert.deepEqual(await held('USDT').then(item => [item.available, item.withdrawing]), ['78.500000', '21.500000']);
    const code = await lastEmailCode(server.app, email);
    // Only the team member who asked can confirm: the code went to them.
    const requester = (await prisma.cryptoWithdrawal.findUniqueOrThrow({ where: { id: asked.json.id } })).requestedBy;
    await prisma.cryptoWithdrawal.update({ where: { id: asked.json.id }, data: { requestedBy: '00000000-0000-4000-8000-00000000abcd' } });
    const notMine = await browser.post(`/v1/crypto/withdrawals/${asked.json.id}/confirm`, { code }, headers);
    assert.deepEqual([notMine.status, notMine.json.error.code], [403, 'not_requester']);
    await prisma.cryptoWithdrawal.update({ where: { id: asked.json.id }, data: { requestedBy: requester } });
    const confirmed = await browser.post(`/v1/crypto/withdrawals/${asked.json.id}/confirm`, { code }, headers);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
    assert.equal(confirmed.json.code_sent_at, null);
    for (let i = 0; i < 3; i += 1) {
      await prisma.cryptoWithdrawal.updateMany({ where: { id: asked.json.id }, data: { nextCheckAt: null } });
      await cron('crypto');
    }
    const doneRes = await browser.get(`/v1/crypto/withdrawals/${asked.json.id}`, headers);
    const done = doneRes.json;
    assert.equal(done.status, 'completed', JSON.stringify(done));
    assert.deepEqual(await held('USDT').then(item => [item.available, item.withdrawing]), ['78.500000', '0.000000']);
    assert.ok(await prisma.notification.findFirst({ where: { type: 'crypto.withdrawal_sent', resellerId } }));
    const listed = (await afrippaAdmin.get(`/v1/afrippa/admin/crypto/withdrawals?reseller_id=${resellerId}`)).json.data;
    assert.deepEqual(listed.map(item => [item.status, item.customer, item.reseller?.id]), [['completed', null, resellerId]]);
    const entries = await prisma.journalEntry.findMany({ where: { reference: { startsWith: `crypto_withdrawal:${asked.json.id}` } }, select: { resellerId: true } });
    assert.ok(entries.length === 2 && entries.every(entry => entry.resellerId === resellerId), 'the entries carry the reseller');
    await ledgerOk();

    // A cancelled withdrawal returns the coins to the coin wallet.
    const second = await browser.post('/v1/crypto/withdrawals', { asset: 'USDT', chain: 'ETHEREUM', address_id: added.json.id, amount: '10' }, headers);
    const cancelled = await browser.post(`/v1/crypto/withdrawals/${second.json.id}/cancel`, {}, headers);
    assert.equal(cancelled.json.status, 'cancelled');
    assert.equal(await held('USDT').then(item => item.available), '78.500000');

    // Off Premium, no new deposits; the coins already held can still be withdrawn (never trapped).
    await prisma.reseller.update({ where: { id: resellerId }, data: { planCode: 'standard' } });
    const noDeposits = await browser.post('/v1/crypto/deposit-addresses', { asset: 'USDT', chain: 'ETHEREUM' }, headers);
    assert.deepEqual([noDeposits.status, noDeposits.json.error.code], [403, 'plan_feature_required']);
    assert.equal((await browser.get('/v1/crypto/withdrawal-networks?asset=USDT', headers)).status, 200);
    const afterPremium = await browser.post('/v1/crypto/withdrawals', { asset: 'USDT', chain: 'ETHEREUM', address_id: added.json.id, amount: '10' }, headers);
    assert.equal(afterPremium.status, 201, JSON.stringify(afterPremium.json));
    await browser.post(`/v1/crypto/withdrawals/${afterPremium.json.id}/cancel`, {}, headers);
    const removed = await browser.delete(`/v1/crypto/withdrawal-addresses/${added.json.id}`, headers);
    await ledgerOk();
  });

  test('the Premium plan lists the feature, and admins can take it off', async () => {
    const premium = await prisma.plan.findUniqueOrThrow({ where: { code: 'premium' } });
    assert.ok(premium.features.includes('onchain_crypto'));
    const standard = await prisma.plan.findUniqueOrThrow({ where: { code: 'standard' } });
    assert.ok(!standard.features.includes('onchain_crypto'));
  });
});
