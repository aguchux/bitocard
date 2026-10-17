// The signer as Vercel functions: the request handler (signed requests, signed replies, the original path covered by
// the signature) and the cron worker's authorisation. Needs Postgres: set SIGNER_TEST_DATABASE_URL (the Docker one,
// postgresql://bitocard:bitocard@localhost:5432/bitocard_test, works); skipped without it.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { before, describe, test } from 'node:test';

const database = process.env.SIGNER_TEST_DATABASE_URL;
const secret = 'v'.repeat(40);
const sign = (text, at = Math.floor(Date.now() / 1000)) => `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${text}`).digest('hex')}`;

describe('Vercel functions', () => {
  let vercel;
  before(async () => {
    Object.assign(process.env, {
      SIGNER_NETWORK: 'testnet',
      SIGNER_SECRET: secret,
      DATABASE_URL: database ?? 'postgresql://unused',
      SIGNER_VAULT: 'local',
      SIGNER_MNEMONIC: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      SIGNER_TRON_URL: 'https://nile.trongrid.io',
      CRON_SECRET: 'c'.repeat(32),
    });
    vercel = await import('../dist/vercel.js');
  });

  test('the worker answers only Vercel Cron’s secret', async () => {
    for (const authorization of [undefined, 'Bearer wrong', `Bearer ${'c'.repeat(31)}`]) {
      const res = await vercel.workerHandler(new Request('https://signer.example/api/worker', { headers: authorization ? { authorization } : {} }));
      assert.equal(res.status, 401);
    }
  });

  test('signed requests on their original path, signed replies', { skip: !database && 'set SIGNER_TEST_DATABASE_URL' }, async () => {
    const path = '/v1/health';
    const header = sign(path);
    const res = await vercel.fetchHandler(new Request(`https://signer.example${path}`, { headers: { 'bitocard-signer-signature': header } }));
    const text = await res.text();
    assert.equal(res.status, 200, text);
    assert.equal(JSON.parse(text).network, 'testnet');
    const at = /t=(\d+)/.exec(res.headers.get('bitocard-signer-signature'))[1];
    const expected = createHmac('sha256', secret).update(`reply.${at}.${header.split('v1=')[1]}.200.${text}`).digest('hex');
    assert.equal(res.headers.get('bitocard-signer-signature'), `t=${at},v1=${expected}`);
    // Signed for one path, sent to another: refused.
    const other = await vercel.fetchHandler(new Request('https://signer.example/v1/balances/testnet', { headers: { 'bitocard-signer-signature': header } }));
    assert.equal(other.status, 401);
    const worker = await vercel.workerHandler(new Request('https://signer.example/api/worker', { headers: { authorization: `Bearer ${'c'.repeat(32)}` } }));
    assert.equal(worker.status, 200);
    assert.deepEqual(Object.keys(await worker.json()), ['processed', 'swept']);
  });
});

describe('several instances at once (Postgres)', { skip: !database && 'set SIGNER_TEST_DATABASE_URL' }, () => {
  test('the daily limit holds and signing is one at a time across instances', async () => {
    const pg = (await import('pg')).default;
    const { Signer } = await import('../dist/service.js');
    const { migrate } = await import('../dist/store.js');
    const { LocalVault } = await import('../dist/vault/local.js');
    const vault = new LocalVault('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    const pools = [new pg.Pool({ connectionString: database }), new pg.Pool({ connectionString: database })];
    const client = await pools[0].connect();
    await migrate(client);
    client.release();
    await pools[0].query(`DELETE FROM transfers WHERE reference LIKE 'race_%'`);
    let signing = 0;
    let overlapped = false;
    const driver = {
      confirmations: 1,
      address: to => to,
      async sign(intent) {
        signing += 1;
        if (signing > 1) overlapped = true;
        await new Promise(resolve => setTimeout(resolve, 30));
        signing -= 1;
        return { txHash: `0x${intent.amount}`, raw: '0x00', meta: {} };
      },
      broadcast: async () => undefined,
      status: async () => ({ state: 'pending' }),
      balance: async () => 0n,
      tokenGas: async () => 0n,
    };
    const config = {
      network: 'testnet',
      accountPaths: { evm: "m/44'/60'/0'", tron: "m/44'/195'/0'", bitcoin: "m/84'/1'/0'", litecoin: "m/84'/1'/0'", dogecoin: "m/44'/1'/0'" },
      limits: [{ chain: 'ETHEREUM', contract: null, asset: 'ETH', decimals: 18, perTransfer: 100n, daily: 100n, sweepMin: null }],
    };
    const signers = pools.map(pool => new Signer(config, pool, { ETHEREUM: driver }, vault));
    const work = [];
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        signers[i % 2].receive({ reference: `race_${i}`, chain: 'ETHEREUM', network: 'testnet', asset: 'ETH', contract: null, to: '0x52908400098527886E0F7030069857D2E4169EE7', amount: '30' }, w => work.push(w)),
      ),
    );
    await Promise.all(work);
    // 30 each against a daily limit of 100: exactly three fit, whichever instance took them.
    assert.equal(results.filter(r => r.status !== 'failed').length, 3);
    assert.equal(overlapped, false, 'two instances never signed on one chain at the same time');
    await pools[0].query(`DELETE FROM transfers WHERE reference LIKE 'race_%'`);
    await Promise.all(pools.map(pool => pool.end()));
  });
});
