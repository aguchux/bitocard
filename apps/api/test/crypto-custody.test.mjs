// The daily custody check: withdrawals being sent count as in flight, wallets on one chain are summed, and sandbox
// test crypto (never on chain) is left out of what the test signer should hold.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { lastEmailCode, startApp } from './helpers.mjs';

let server;
let prisma;
let ledger;
let check;
const holdings = { live: [], test: [] };

before(async () => {
  server = await startApp({ env: { CHECKOUT_SANDBOX: 'on' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  ledger = server.app.get((await import('../dist/ledger/ledger.service.js')).LedgerService);
  const { CryptoReconciliationService } = await import('../dist/crypto/custody/reconciliation.service.js');
  const inbox = server.app.get((await import('../dist/notifications/inbox.service.js')).InboxService);
  const audit = server.app.get((await import('../dist/audit/audit.service.js')).AuditService);
  // A real signer for both modes, reporting what the test sets.
  const withdrawals = { signer: mode => ({ simulated: false, balances: async () => holdings[mode] }) };
  check = new CryptoReconciliationService(prisma, withdrawals, inbox, audit);
});

after(async () => {
  await server?.close();
});

async function customerId() {
  const email = `custody-${Date.now()}@example.com`;
  const res = await fetch(`${server.base}/v1/store/account/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
    body: JSON.stringify({ name: 'Ada Holder', email, password: 'correct horse battery', country: 'NG' }),
  });
  const json = await res.json();
  assert.ok(await lastEmailCode(server.app, email));
  return json.customer.id;
}

const credit = (mode, customer, amount, reference) =>
  ledger.post({
    mode,
    type: 'crypto_deposit',
    reference,
    description: 'BTC',
    lines: [
      { account: { kind: 'crypto_custody', currency: 'BTC' }, debit: amount },
      { account: { kind: 'crypto_wallet', currency: 'BTC', customerId: customer }, credit: amount },
    ],
  });

test('a withdrawal being sent is in flight, and every wallet on a chain is counted', async () => {
  const customer = await customerId();
  await credit('live', customer, 10_000n, `crypto_deposit:BITCOIN:${'a'.repeat(64)}:0`);
  await prisma.cryptoWithdrawal.create({
    data: { customerId: customer, mode: 'live', asset: 'BTC', chain: 'BITCOIN', address: 'bc1qexample', amount: 3_000n, fee: 0n, rawAmount: '3000', status: 'submitting', signerReference: `bc_cw_${randomUUID()}` },
  });
  // Two wallets on Bitcoin (a deposit address and the hot wallet): 4,000 + 3,000.
  holdings.live = [
    { chain: 'BITCOIN', asset: 'BTC', contract: null, amount: '4000', decimals: 8 },
    { chain: 'BITCOIN', asset: 'BTC', contract: null, amount: '3000', decimals: 8 },
  ];
  const run = await check.run('live');
  const btc = run.data.find(item => item.asset === 'BTC');
  assert.deepEqual([btc.status, btc.expected, btc.held], ['matched', '0.00007000', '0.00007000'], JSON.stringify(btc));
  assert.deepEqual(btc.detail.chains, { BITCOIN: '0.00007000' });
  assert.equal(btc.detail.withdrawals_in_flight, '0.00003000');
});

test('sandbox test crypto is left out of what the test signer should hold', async () => {
  const customer = await customerId();
  await credit('test', customer, 2_000n, `crypto_deposit:BITCOIN:${'b'.repeat(64)}:0`);
  await credit('test', customer, 5_000n, `crypto_test_deposit:${randomUUID()}`);
  await credit('test', customer, 1_000n, `crypto_admin_credit:${randomUUID()}`);
  holdings.test = [{ chain: 'BITCOIN', asset: 'BTC', contract: null, amount: '2000', decimals: 8 }];
  const btc = (await check.run('test')).data.find(item => item.asset === 'BTC');
  assert.deepEqual([btc.status, btc.expected, btc.detail.custody, btc.detail.test_credits], ['matched', '0.00002000', '0.00008000', '0.00006000']);
  holdings.test = [];
  const short = (await check.run('test')).data.find(item => item.asset === 'BTC');
  assert.deepEqual([short.status, short.difference], ['shortfall', '-0.00002000'], 'real test-network deposits must still be there');
});
