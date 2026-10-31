// Tax as seller of record: inclusive and exclusive calculation, unconfirmed rates blocked in live mode, admin settings.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, startApp } from './helpers.mjs';

let server;
let tax;
let computeTax;

before(async () => {
  server = await startApp();
  const module = await import('../dist/tax/tax.service.js');
  tax = server.app.get(module.TaxService);
  computeTax = module.computeTax;
});

after(() => server?.close());

describe('calculation', () => {
  test('prices including tax: the tax is taken out of the price', () => {
    const vat = computeTax({ name: 'VAT', rateBps: 750, pricesIncludeTax: true }, 10_750n);
    assert.deepEqual([vat.net, vat.tax, vat.gross], [10_000n, 750n, 10_750n]);
  });

  test('prices excluding tax: the tax is added on top', () => {
    const vat = computeTax({ name: 'VAT', rateBps: 1600, pricesIncludeTax: false }, 10_000n);
    assert.deepEqual([vat.net, vat.tax, vat.gross], [10_000n, 1600n, 11_600n]);
  });

  test('tax rounds to the nearest minor unit and always adds up', () => {
    for (const amount of [1n, 99n, 333n, 1_234_567n]) {
      const vat = computeTax({ name: 'VAT', rateBps: 2000, pricesIncludeTax: true }, amount);
      assert.equal(vat.net + vat.tax, amount);
    }
    assert.equal(computeTax({ name: 'VAT', rateBps: 750, pricesIncludeTax: false }, 20n).tax, 2n, '1.5 rounds up');
  });
});

describe('rates', () => {
  test('pilot rates are seeded unconfirmed: the sandbox can use them, live sales cannot', async () => {
    const sandbox = await tax.calculate('NG', 10_750n, 'test');
    assert.deepEqual([sandbox.name, sandbox.tax], ['VAT', 750n]);
    await assert.rejects(tax.calculate('NG', 10_750n, 'live'), error => error.code === 'tax_not_configured' && error.message === 'This cannot be bought in Nigeria yet.');
    await assert.rejects(tax.calculate('GB', 100n, 'test'), error => error.code === 'tax_not_configured');
    // Admins are told what to set, once a day per country however many sales are refused.
    await adminClient(server, ['finance']);
    await assert.rejects(tax.calculate('NG', 10_750n, 'live'));
    await assert.rejects(tax.calculate('NG', 10_750n, 'live'));
    const prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
    const notices = await prisma.notification.findMany({ where: { type: 'admin.tax.rate_unconfirmed' } });
    assert.ok(notices.length > 0 && notices.every(row => row.link === '/settings/markets?country=NG'));
    assert.equal(new Set(notices.map(row => row.userId)).size, notices.length, 'once per admin');
  });

  test('finance admins confirm a rate, which opens live sales and is audited', async () => {
    const finance = await adminClient(server, ['finance']);
    const listed = (await finance.get('/v1/admin/tax-rates')).json.data;
    assert.deepEqual(listed.map(r => [r.country, r.rate_bps, r.confirmed]), [['GH', 2000, false], ['KE', 1600, false], ['NG', 750, false]]);

    const set = await finance.put('/v1/admin/tax-rates/ke', { name: 'VAT', rate_bps: 1600, prices_include_tax: true, confirmed: true });
    assert.deepEqual([set.status, set.json.country, set.json.confirmed], [200, 'KE', true]);
    assert.equal((await tax.calculate('KE', 11_600n, 'live')).tax, 1600n);

    assert.equal((await finance.put('/v1/admin/tax-rates/KE', { name: 'VAT', rate_bps: 6000, prices_include_tax: true, confirmed: true })).json.error.param, 'rate_bps');
    assert.equal((await finance.put('/v1/admin/tax-rates/ZZ', { name: 'VAT', rate_bps: 100, prices_include_tax: true, confirmed: false })).status, 404);

    const { PrismaService } = await import('../dist/database/prisma.service.js');
    const log = await server.app.get(PrismaService).auditLog.findFirst({ where: { action: 'tax_rate.updated', targetId: 'KE' } });
    assert.equal(log.after.confirmed, true);

    const operations = await adminClient(server, ['operations']);
    assert.equal((await operations.get('/v1/admin/tax-rates')).status, 200);
    assert.equal((await operations.put('/v1/admin/tax-rates/NG', { name: 'VAT', rate_bps: 750, prices_include_tax: true, confirmed: true })).status, 403);
  });
});
