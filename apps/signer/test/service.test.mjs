import { PGlite } from '@electric-sql/pglite';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { base64urlnopad } from '@scure/base';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ConfigError, loadConfig, parseLimits } from '../dist/config.js';
import { Refusal } from '../dist/chains/driver.js';
import { ChainUnavailable } from '../dist/chains/rpc.js';
import { addressOf } from '../dist/keys.js';
import { replySignature, requestValid, signerServer } from '../dist/server.js';
import { Signer } from '../dist/service.js';
import { migrate } from '../dist/store.js';
import { LocalVault } from '../dist/vault/local.js';
import { TurnkeyVault } from '../dist/vault/turnkey.js';

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const vault = new LocalVault(mnemonic);
const usdt = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const secret = 's'.repeat(40);

/** A chain that does what the test says: balances per address, and what each signed transaction does on chain. */
class FakeDriver {
  constructor() {
    this.confirmations = 2;
    this.balances = new Map();
    this.signedCount = 0;
    this.broadcasts = [];
    this.states = new Map();
    this.signError = null;
    this.broadcastError = null;
    this.intents = [];
  }
  address(to) {
    return to.startsWith('T') && to.length === 34 ? to : null;
  }
  async sign(intent) {
    if (this.signError) throw this.signError;
    this.intents.push(intent);
    this.signedCount += 1;
    return { txHash: `tx${this.signedCount}`, raw: `raw${this.signedCount}`, meta: { from: intent.from.kind } };
  }
  async broadcast(signed) {
    if (this.broadcastError) throw this.broadcastError;
    this.broadcasts.push(signed.txHash);
  }
  async status(signed) {
    return this.states.get(signed.txHash) ?? { state: 'pending' };
  }
  async balance(address, contract) {
    return this.balances.get(`${address}:${contract}`) ?? 0n;
  }
  async tokenGas() {
    return 30_000_000n;
  }
}

const config = {
  port: 0,
  network: 'mainnet',
  secret,
  databaseUrl: 'pglite',
  vault: { kind: 'local', mnemonic },
  accountPaths: { evm: "m/44'/60'/0'", tron: "m/44'/195'/0'", bitcoin: "m/84'/0'/0'", litecoin: "m/84'/2'/0'", dogecoin: "m/44'/3'/0'" },
  xpubs: {},
  evmRpc: {},
  tron: null,
  esplora: {},
  blockcypherToken: null,
  confirmations: {},
  limits: [
    { chain: 'TRON', contract: usdt, asset: 'USDT', decimals: 6, perTransfer: 5_000_000_000n, daily: 8_000_000_000n, sweepMin: 20_000_000n },
    { chain: 'TRON', contract: null, asset: 'TRX', decimals: 6, perTransfer: 100_000_000n, daily: 1_000_000_000n, sweepMin: 50_000_000n },
  ],
  workerIntervalMs: 1000,
};

let db;
let driver;
let signer;
const customer = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
const send = (reference, amount = '50000000', extra = {}) => signer.receive({ reference, chain: 'TRON', network: 'mainnet', asset: 'USDT', contract: usdt, to: customer, amount, decimals: 6, ...extra });
const row = async reference => (await db.query('SELECT * FROM transfers WHERE reference = $1', [reference])).rows[0];
const due = async () => db.query(`UPDATE transfers SET next_attempt_at = now() - interval '1 second', lease_until = NULL`);
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

before(async () => {
  db = new PGlite();
  await migrate(db);
});
after(async () => db.close());
beforeEach(async () => {
  await db.query('DELETE FROM transfers');
  await db.query('DELETE FROM deposit_addresses');
  driver = new FakeDriver();
  signer = new Signer(config, db, { TRON: driver }, vault);
});

describe('transfers', () => {
  test('recorded first, then signed, broadcast and confirmed; the same reference is the same transfer', async () => {
    const first = await send('bc_cw_1');
    assert.deepEqual(first, { reference: 'bc_cw_1', status: 'pending', tx_hash: null, reason: null });
    await settle();
    assert.equal((await row('bc_cw_1')).status, 'broadcast');
    assert.equal(driver.signedCount, 1);
    // Asked again (a timeout on the API's side): nothing new is signed.
    assert.equal((await send('bc_cw_1')).status, 'broadcast');
    assert.equal((await signer.get('bc_cw_1')).tx_hash, 'tx1');
    driver.states.set('tx1', { state: 'mined', confirmations: 1 });
    await due();
    await signer.runOnce();
    assert.equal((await signer.get('bc_cw_1')).status, 'broadcast', 'not confirmed below the confirmations');
    driver.states.set('tx1', { state: 'mined', confirmations: 2 });
    await due();
    await signer.runOnce();
    assert.deepEqual(await signer.get('bc_cw_1'), { reference: 'bc_cw_1', status: 'confirmed', tx_hash: 'tx1', reason: null });
    assert.equal(driver.signedCount, 1);
    assert.equal(await signer.get('bc_cw_unknown'), null);
    assert.deepEqual(driver.intents[0].from, { kind: 'hot' });
  });

  test('a clear refusal before signing fails it; unclear errors never do', async () => {
    driver.signError = new ChainUnavailable('node down');
    await send('bc_cw_2');
    await settle();
    let current = await row('bc_cw_2');
    assert.equal(current.status, 'pending');
    assert.match(current.last_error, /node down/);
    driver.signError = new Refusal('the paying address holds too little');
    await due();
    await signer.runOnce();
    assert.deepEqual(await signer.get('bc_cw_2'), { reference: 'bc_cw_2', status: 'failed', tx_hash: null, reason: 'the paying address holds too little' });
  });

  test('signed bytes are kept: a failed broadcast sends exactly them again, never a new transaction', async () => {
    driver.broadcastError = new ChainUnavailable('mempool full');
    await send('bc_cw_3');
    await settle();
    assert.equal((await row('bc_cw_3')).status, 'signed');
    assert.equal((await signer.get('bc_cw_3')).status, 'pending');
    driver.broadcastError = null;
    await due();
    await signer.runOnce();
    assert.equal((await row('bc_cw_3')).status, 'broadcast');
    assert.deepEqual(driver.broadcasts, ['tx1']);
    assert.equal(driver.signedCount, 1);
    // Dropped by the node: rebroadcast, still the same bytes.
    driver.states.set('tx1', { state: 'unknown' });
    await due();
    await signer.runOnce();
    assert.deepEqual(driver.broadcasts, ['tx1', 'tx1']);
    // Reverted on chain: it can never send, so it is failed.
    driver.states.set('tx1', { state: 'reverted', reason: 'the transaction reverted on chain' });
    await due();
    await signer.runOnce();
    assert.equal((await signer.get('bc_cw_3')).status, 'failed');
  });

  test('limits: per transfer and per day; failed transfers do not count', async () => {
    assert.equal((await send('bc_cw_big', '5000000001')).status, 'failed');
    assert.match((await signer.get('bc_cw_big')).reason, /per transfer/);
    assert.equal((await send('bc_cw_a', '5000000000')).status, 'pending');
    assert.equal((await send('bc_cw_b', '3000000000')).status, 'pending');
    const over = await send('bc_cw_c', '1');
    assert.equal(over.status, 'failed');
    assert.match(over.reason, /daily/);
  });

  test('requests it cannot serve are refused before anything is recorded', async () => {
    await assert.rejects(send('bc_cw_x', '1', { network: 'testnet' }), { status: 422 });
    await assert.rejects(send('bc_cw_x', '1', { contract: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf' }), /not allowed/);
    await assert.rejects(send('bc_cw_x', '1', { asset: 'USDC' }), /not USDC/);
    await assert.rejects(send('bc_cw_x', '1', { decimals: 18 }), /decimals/);
    await assert.rejects(send('bc_cw_x', '1', { to: 'not-an-address' }), /not a valid/);
    await assert.rejects(send('bc_cw_x', '1.5'), { status: 400 });
    await assert.rejects(signer.receive({ reference: 'bc_cw_x', chain: 'BITCOIN', network: 'mainnet', asset: 'BTC', contract: null, to: 'x', amount: '1' }), /no BITCOIN node/);
    assert.equal(await row('bc_cw_x'), undefined);
  });
});

describe('deposit addresses and sweeps', () => {
  test('tracking checks the address is the vault’s own for that index', async () => {
    const index3 = addressOf('TRON', 'mainnet', await vault.publicKey("m/44'/195'/0'/0/3"));
    assert.deepEqual(await signer.track({ chain: 'TRON', network: 'mainnet', index: 3, address: index3 }), { chain: 'TRON', index: 3, address: index3 });
    await assert.rejects(signer.track({ chain: 'TRON', network: 'mainnet', index: 4, address: index3 }), /xpub and the signer's keys differ/);
  });

  test('a token deposit gets gas first, then is swept; then the coin is swept', async () => {
    const address = addressOf('TRON', 'mainnet', await vault.publicKey("m/44'/195'/0'/0/5"));
    const hot = addressOf('TRON', 'mainnet', await vault.publicKey("m/44'/195'/0'/1/0"));
    await signer.track({ chain: 'TRON', network: 'mainnet', index: 5, address });
    driver.balances.set(`${address}:${usdt}`, 100_000_000n);
    driver.balances.set(`${address}:null`, 0n);
    await signer.sweep();
    let rows = (await db.query(`SELECT * FROM transfers ORDER BY created_at`)).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'gas');
    assert.equal(rows[0].to_address, address);
    assert.equal(rows[0].from_index, null, 'gas comes from the hot wallet');
    // Nothing more while the gas is on its way.
    await signer.sweep();
    assert.equal((await db.query('SELECT * FROM transfers')).rows.length, 1);
    await db.query(`UPDATE transfers SET status = 'confirmed'`);
    driver.balances.set(`${address}:null`, 30_000_000n);
    await signer.sweep();
    rows = (await db.query(`SELECT * FROM transfers WHERE kind = 'sweep'`)).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].contract, usdt);
    assert.equal(rows[0].to_address, hot);
    assert.equal(rows[0].from_index, 5);
    assert.equal(rows[0].amount, '100000000');
    await db.query(`UPDATE transfers SET status = 'confirmed'`);
    driver.balances.set(`${address}:${usdt}`, 0n);
    driver.balances.set(`${address}:null`, 60_000_000n);
    await signer.sweep();
    const coin = (await db.query(`SELECT * FROM transfers WHERE kind = 'sweep' AND contract IS NULL`)).rows[0];
    assert.equal(coin.asset, 'TRX');
    await due();
    await signer.runOnce();
    assert.equal(driver.intents.at(-1).sweepAll, true);
    assert.deepEqual(driver.intents.at(-1).from, { kind: 'customer', index: 5 });
    // Sweeps never count towards the withdrawal limits.
    assert.equal((await send('bc_cw_after', '5000000000')).status, 'pending');
  });

  test('balances add the hot wallet and every tracked address', async () => {
    const address = addressOf('TRON', 'mainnet', await vault.publicKey("m/44'/195'/0'/0/1"));
    const hot = addressOf('TRON', 'mainnet', await vault.publicKey("m/44'/195'/0'/1/0"));
    await signer.track({ chain: 'TRON', network: 'mainnet', index: 1, address });
    driver.balances.set(`${hot}:${usdt}`, 7n);
    driver.balances.set(`${address}:${usdt}`, 5n);
    driver.balances.set(`${hot}:null`, 2n);
    assert.deepEqual(await signer.balances('mainnet'), {
      network: 'mainnet',
      balances: [
        { chain: 'TRON', asset: 'USDT', contract: usdt, amount: '12', decimals: 6 },
        { chain: 'TRON', asset: 'TRX', contract: null, amount: '2', decimals: 6 },
      ],
    });
    await assert.rejects(signer.balances('testnet'), { status: 422 });
  });
});

describe('the HTTP interface', () => {
  let server;
  let base;
  before(async () => {
    server = signerServer(new Signer(config, db, { TRON: new FakeDriver() }, vault), secret);
    await new Promise(resolve => server.listen(0, resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  const sign = (text, at = Math.floor(Date.now() / 1000), key = secret) => `t=${at},v1=${createHmac('sha256', key).update(`${at}.${text}`).digest('hex')}`;
  const replyValid = (header, v1, status, body) => {
    const at = /t=(\d+)/.exec(header)[1];
    return header === replySignature(secret, v1, status, body, Number(at));
  };

  test('signed requests get signed replies bound to the request', async () => {
    const body = JSON.stringify({ reference: 'bc_cw_http', chain: 'TRON', network: 'mainnet', asset: 'USDT', contract: usdt, to: customer, amount: '1000', decimals: 6 });
    const header = sign(body);
    const res = await fetch(`${base}/v1/transfers`, { method: 'POST', headers: { 'afrippa-signer-signature': header }, body });
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(text).status, 'pending');
    assert.ok(replyValid(res.headers.get('afrippa-signer-signature'), header.split('v1=')[1], 200, text));

    const path = '/v1/transfers/nope';
    // Signed once: signing again could fall in the next second and differ.
    const pathHeader = sign(path);
    const missing = await fetch(`${base}${path}`, { headers: { 'afrippa-signer-signature': pathHeader } });
    assert.equal(missing.status, 404);
    assert.ok(replyValid(missing.headers.get('afrippa-signer-signature'), pathHeader.split('v1=')[1], 404, await missing.text()));

    const health = await fetch(`${base}/signer/v1/health`, { headers: { 'afrippa-signer-signature': sign('/signer/v1/health') } });
    const json = await health.json();
    assert.equal(json.network, 'mainnet');
    assert.equal(json.hot_wallets.TRON, addressOf('TRON', 'mainnet', await vault.publicKey("m/44'/195'/0'/1/0")));
  });

  test('missing, wrong or stale signatures are refused, unsigned', async () => {
    for (const header of [undefined, sign('/v1/health', undefined, 'w'.repeat(40)), sign('/v1/health', Math.floor(Date.now() / 1000) - 600)]) {
      const res = await fetch(`${base}/v1/health`, { headers: header ? { 'afrippa-signer-signature': header } : {} });
      assert.equal(res.status, 401);
      assert.equal(res.headers.get('afrippa-signer-signature'), null);
    }
    // A body signed for one request cannot be replayed with another body.
    const res = await fetch(`${base}/v1/transfers`, { method: 'POST', headers: { 'afrippa-signer-signature': sign('{}') }, body: '{"reference":"x"}' });
    assert.equal(res.status, 401);
    assert.equal(requestValid(secret, sign('abc'), 'abc') !== null, true);
  });
});

describe('Turnkey', () => {
  const apiKey = hexToBytes('11'.repeat(32));
  const apiPublicKey = bytesToHex(p256.getPublicKey(apiKey, true));
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic));
  const account = root.derive("m/44'/195'/0'");

  function fakeTurnkey({ wallet = root, existing = new Set() } = {}) {
    const requests = [];
    const fetcher = async (url, init) => {
      const path = new URL(url).pathname;
      const body = JSON.parse(init.body);
      // Every request is stamped over its exact body with the API key.
      const stamp = JSON.parse(new TextDecoder().decode(base64urlnopad.decode(init.headers['X-Stamp'])));
      assert.equal(stamp.scheme, 'SIGNATURE_SCHEME_TK_API_P256');
      assert.equal(stamp.publicKey, apiPublicKey);
      assert.ok(p256.verify(hexToBytes(stamp.signature), new TextEncoder().encode(init.body), hexToBytes(apiPublicKey), { format: 'der' }));
      requests.push({ path, body });
      if (path === '/public/v1/submit/create_wallet_accounts') {
        const [{ path: keyPath }] = body.parameters.accounts;
        const address = bytesToHex(wallet.derive(keyPath).publicKey);
        existing.add(address);
        return Response.json({ activity: { id: 'a1', status: 'ACTIVITY_STATUS_COMPLETED', result: { createWalletAccountsResult: { addresses: [address] } } } });
      }
      if (path === '/public/v1/submit/sign_raw_payload') {
        const { signWith, payload, hashFunction } = body.parameters;
        assert.equal(hashFunction, 'HASH_FUNCTION_NO_OP');
        if (!existing.has(signWith)) return new Response(JSON.stringify({ message: 'could not find wallet account' }), { status: 404 });
        // Sign with whatever key the wallet really has at that address.
        const key = [0, 1].flatMap(c => Array.from({ length: 8 }, (_, i) => wallet.derive(`m/44'/195'/0'/${c}/${i}`))).find(k => bytesToHex(k.publicKey) === signWith) ?? wallet.derive("m/44'/195'/0'/1/0");
        const { secp256k1 } = globalThis.__secp;
        const sig = secp256k1.Signature.fromBytes(secp256k1.sign(hexToBytes(payload), key.privateKey, { prehash: false, format: 'recovered' }), 'recovered');
        return Response.json({ activity: { id: 'a2', status: 'ACTIVITY_STATUS_COMPLETED', result: { signRawPayloadResult: { r: sig.r.toString(16).padStart(64, '0'), s: sig.s.toString(16).padStart(64, '0'), v: `0${sig.recovery}` } } } });
      }
      return new Response('{}', { status: 400 });
    };
    return { requests, fetcher };
  }

  before(async () => {
    globalThis.__secp = await import('@noble/curves/secp256k1.js');
  });

  const settings = { apiUrl: 'https://api.turnkey.com', organizationId: 'org', walletId: 'wallet', apiPublicKey, apiPrivateKey: bytesToHex(apiKey), accounts: [{ path: "m/44'/195'/0'", xpub: account.publicExtendedKey }] };

  test('public keys come from the xpub; an account is added the first time a path signs', async () => {
    const turnkey = fakeTurnkey();
    const tk = new TurnkeyVault(settings, turnkey.fetcher);
    assert.deepEqual(await tk.publicKey("m/44'/195'/0'/1/0"), await vault.publicKey("m/44'/195'/0'/1/0"));
    const digest = sha256(new TextEncoder().encode('tx'));
    const sig = await tk.sign("m/44'/195'/0'/1/0", digest);
    assert.deepEqual(sig, await vault.sign("m/44'/195'/0'/1/0", digest));
    assert.deepEqual(turnkey.requests.map(r => r.path), ['/public/v1/submit/sign_raw_payload', '/public/v1/submit/create_wallet_accounts', '/public/v1/submit/sign_raw_payload']);
    assert.deepEqual(turnkey.requests[1].body.parameters.accounts[0], { curve: 'CURVE_SECP256K1', pathFormat: 'PATH_FORMAT_BIP32', path: "m/44'/195'/0'/1/0", addressFormat: 'ADDRESS_FORMAT_COMPRESSED' });
    await assert.rejects(tk.publicKey("m/44'/60'/0'/0/1"), /No account xpub/);
  });

  test('a Turnkey wallet that is not the one behind the xpubs can never sign', async () => {
    const other = HDKey.fromMasterSeed(mnemonicToSeedSync('legal winner thank year wave sausage worth useful legal winner thank yellow'));
    const tk = new TurnkeyVault(settings, fakeTurnkey({ wallet: other }).fetcher);
    await assert.rejects(tk.sign("m/44'/195'/0'/1/0", sha256(new Uint8Array([1]))), /not the one the xpubs came from/);
  });

  test('the API key pair must match', () => {
    assert.throws(() => new TurnkeyVault({ ...settings, apiPublicKey: '02' + '00'.repeat(32) }), /does not match/);
  });
});

describe('configuration', () => {
  const base = { SIGNER_NETWORK: 'testnet', SIGNER_SECRET: secret, DATABASE_URL: 'postgres://x', SIGNER_VAULT: 'local', SIGNER_MNEMONIC: mnemonic };

  test('a local recovery phrase is refused on mainnet', () => {
    assert.throws(() => loadConfig({ ...base, SIGNER_NETWORK: 'mainnet' }), ConfigError);
    assert.equal(loadConfig(base).vault.kind, 'local');
  });

  test('node addresses must be https, the secret long enough, limits valid', () => {
    assert.throws(() => loadConfig({ ...base, SIGNER_RPC_ETHEREUM: 'http://node.example' }), /https/);
    assert.throws(() => loadConfig({ ...base, SIGNER_SECRET: 'short' }), /32/);
    assert.throws(() => parseLimits('[{"chain":"TRON","asset":"USDT","contract":"T…","per_transfer":"1","daily":"1"}]'), /decimals/);
    assert.equal(parseLimits('[{"chain":"BITCOIN","asset":"BTC","contract":null,"per_transfer":"1","daily":"2"}]')[0].decimals, 8);
    assert.equal(loadConfig(base).accountPaths.bitcoin, "m/84'/1'/0'");
  });
});
