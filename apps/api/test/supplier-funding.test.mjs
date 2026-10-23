// Admins record money sent to a supplier outside BitoCard (a bank transfer to its account): nothing moves until the
// admin who asked enters the code emailed to them; then one ledger entry funds `supplier_float` once, audited.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, lastEmailCode, startApp } from './helpers.mjs';

let server;
let finance;
let prisma;

before(async () => {
  server = await startApp();
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  finance = await adminClient(server, ['finance']);
});

after(() => server?.close());

const ledgerOk = async () => assert.equal((await finance.get('/v1/admin/ledger/check')).json.ok, true);
const code = () => lastEmailCode(server.app, finance.admin.email);

describe('supplier funding', () => {
  test('a bank transfer to a supplier is recorded once the emailed code confirms it, funding its float', async () => {
    const supplier = await prisma.supplier.findFirstOrThrow({ where: { code: 'reloadly' } });
    const before = await prisma.ledgerAccount.findFirst({ where: { kind: 'supplier_float', mode: 'live', currency: 'USD', ownerKey: 'provider:reloadly' } });

    const asked = await finance.post('/v1/admin/suppliers/funding', { mode: 'live', supplier_code: 'reloadly', currency: 'USD', amount: 500000, reason: 'Bank transfer to top up the Reloadly wallet' });
    assert.equal(asked.status, 201, JSON.stringify(asked.json));
    assert.deepEqual([asked.json.status, asked.json.currency, asked.json.mode, asked.json.supplier.code], ['awaiting_code', 'USD', 'live', 'reloadly']);
    assert.match(asked.json.number, /^SF-\d{6}$/);

    const sent = server.app.get((await import('../dist/notifications/email.service.js')).EmailService).outbox.at(-1);
    assert.equal(sent.to, finance.admin.email);
    assert.match(sent.text, /USD 5,000\.00/);
    assert.match(sent.text, new RegExp(supplier.name));

    const wrong = await finance.post(`/v1/admin/suppliers/funding/${asked.json.id}/confirm`, { code: (await code()) === '000000' ? '111111' : '000000' });
    assert.equal(wrong.json.error.code, 'code_invalid');

    const done = await finance.post(`/v1/admin/suppliers/funding/${asked.json.id}/confirm`, { code: await code() });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal(done.json.status, 'completed');

    const again = await finance.post(`/v1/admin/suppliers/funding/${asked.json.id}/confirm`, { code: await code() });
    assert.equal(again.json.error.code, 'movement_not_awaiting_code');

    const entry = await prisma.journalEntry.findUnique({ where: { reference: `supplier_funding:${asked.json.id}` }, include: { postings: { include: { account: true } } } });
    assert.equal(entry.type, 'supplier_funding');
    assert.ok(entry.postings.some(posting => posting.account.kind === 'provider_balance' && posting.account.ownerKey === 'provider:manual' && posting.amountMinor === -500000n));
    assert.ok(entry.postings.some(posting => posting.account.kind === 'supplier_float' && posting.account.ownerKey === 'provider:reloadly' && posting.amountMinor === 500000n));

    const after = await prisma.ledgerAccount.findFirstOrThrow({ where: { kind: 'supplier_float', mode: 'live', currency: 'USD', ownerKey: 'provider:reloadly' } });
    assert.equal(after.balanceMinor - (before?.balanceMinor ?? 0n), 500000n, 'funded once');

    const history = await prisma.auditLog.findMany({ where: { targetType: 'supplier', targetId: 'reloadly' } });
    assert.ok(history.some(item => item.action === 'supplier.funding_requested'));
    assert.ok(history.some(item => item.action === 'supplier.funded'));
    assert.ok(await prisma.notification.findFirst({ where: { type: 'admin.supplier.funded' } }), 'finance admins are told');
    await ledgerOk();
  });

  test('confirming with the authenticator app works without the emailed code', async () => {
    const asked = await finance.post('/v1/admin/suppliers/funding', { mode: 'test', supplier_code: 'reloadly', currency: 'USD', amount: 1000, reason: 'Sandbox float top-up' });
    assert.deepEqual(asked.json.confirm_with.sort(), ['authenticator', 'email']);
    const otp = await adminCode(server, finance);
    const done = await finance.post(`/v1/admin/suppliers/funding/${asked.json.id}/confirm`, { code: otp, method: 'authenticator' });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    await ledgerOk();
  });

  test('an unknown supplier, a non-positive amount and a short reason are refused; only finance can request', async () => {
    assert.equal((await finance.post('/v1/admin/suppliers/funding', { mode: 'live', supplier_code: 'not_a_supplier', amount: 100, reason: 'Testing' })).json.error.code, 'supplier_unavailable');
    assert.equal((await finance.post('/v1/admin/suppliers/funding', { mode: 'live', supplier_code: 'reloadly', amount: 0, reason: 'Testing' })).json.error.param, 'amount');
    assert.equal((await finance.post('/v1/admin/suppliers/funding', { mode: 'live', supplier_code: 'reloadly', amount: 100, reason: 'Hi' })).json.error.param, 'reason');

    for (const role of ['operations', 'support']) {
      const other = await adminClient(server, [role]);
      assert.equal((await other.post('/v1/admin/suppliers/funding', { mode: 'live', supplier_code: 'reloadly', amount: 100, reason: 'Not allowed' })).status, 403, role);
    }
    const operations = await adminClient(server, ['operations']);
    assert.equal((await operations.get('/v1/admin/suppliers/funding')).status, 200, 'operations can read');
  });

  test('only the admin who asked confirms or resends; cancel returns it to the queue', async () => {
    const askedResult = await finance.post('/v1/admin/suppliers/funding', { mode: 'live', supplier_code: 'reloadly', currency: 'USD', amount: 100, reason: 'Testing codes and roles' });
    assert.equal(askedResult.status, 201, JSON.stringify(askedResult.json));
    const asked = askedResult.json;
    const right = await code();
    const colleague = await adminClient(server, ['finance']);
    assert.equal((await colleague.post(`/v1/admin/suppliers/funding/${asked.id}/confirm`, { code: right })).json.error.code, 'not_requester');
    assert.equal((await finance.post(`/v1/admin/suppliers/funding/${asked.id}/resend-code`)).json.error.code, 'code_recently_sent');

    await prisma.supplierFundingMovement.update({ where: { id: asked.id }, data: { codeSentAt: new Date(Date.now() - 61_000) } });
    assert.equal((await finance.post(`/v1/admin/suppliers/funding/${asked.id}/resend-code`)).status, 200);

    const cancelled = await colleague.post(`/v1/admin/suppliers/funding/${asked.id}/cancel`);
    assert.equal(cancelled.json.status, 'cancelled');
    assert.equal((await colleague.post(`/v1/admin/suppliers/funding/${asked.id}/cancel`)).json.error.code, 'movement_not_awaiting_code');
  });

  test('float tracking shows what was funded and what orders drew down over the period, and what remains', async () => {
    // An order's supplier cost, posted exactly as OrdersService does: cost of sales against the supplier's float.
    const ledger = server.app.get((await import('../dist/ledger/ledger.service.js')).LedgerService);
    await ledger.post({
      mode: 'live',
      type: 'order_cost',
      reference: 'supplier_funding_test:cost',
      description: 'Test order cost',
      lines: [
        { account: { kind: 'cost_of_sales', currency: 'USD', provider: 'reloadly' }, debit: 1234n },
        { account: { kind: 'supplier_float', currency: 'USD', provider: 'reloadly' }, credit: 1234n },
      ],
    });
    const funded = await prisma.supplierFundingMovement.aggregate({ where: { mode: 'live', supplierCode: 'reloadly', currency: 'USD', status: 'completed' }, _sum: { amount: true } });
    const float = await prisma.ledgerAccount.findFirstOrThrow({ where: { kind: 'supplier_float', mode: 'live', currency: 'USD', ownerKey: 'provider:reloadly' } });

    // The admin app's date picker sends plain dates: "to today" includes today.
    const today = new Date().toISOString().slice(0, 10);
    const result = await finance.get(`/v1/admin/suppliers/float?mode=live&from=${today}&to=${today}`);
    assert.equal(result.status, 200, JSON.stringify(result.json));
    const row = result.json.data.find(item => item.supplier_code === 'reloadly' && item.currency === 'USD');
    assert.ok(row, 'reloadly has a float row after being funded');
    assert.deepEqual([row.funded, row.consumed, row.remaining], [Number(funded._sum.amount), 1234, Number(float.balanceMinor)]);

    const earlier = await finance.get('/v1/admin/suppliers/float?mode=live&from=2020-01-01&to=2020-01-31');
    const quiet = earlier.json.data.find(item => item.supplier_code === 'reloadly' && item.currency === 'USD');
    assert.deepEqual([quiet.funded, quiet.consumed, quiet.remaining], [0, 0, Number(float.balanceMinor)], 'the period scopes funded and drawn down, never what remains');

    const told = await prisma.notification.findFirst({ where: { type: 'admin.supplier.funded' } });
    assert.equal(told.link, '/reports/suppliers', 'the notice opens the supplier funding page');
    await ledgerOk();
  });
});
