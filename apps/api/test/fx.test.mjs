// Exchange rates: two sources, the less favourable rate plus the disclosed margin, pausing when the sources
// disagree, stale rates, and admin settings.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, startApp } from './helpers.mjs';
import { fakeFlutterwave, fakeOpenExchangeRates } from './fakes.mjs';

let server;
let flw;
let oxr;
let admin;
let prisma;

before(async () => {
  flw = await fakeFlutterwave();
  oxr = await fakeOpenExchangeRates();
  server = await startApp({ env: { ...flw.env, ...oxr.env, CRON_SECRET: 'cron-secret', ALERT_EMAIL: 'ops@bitocard.com' } });
  admin = await adminClient(server, ['finance']);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
});

after(async () => {
  await server?.close();
  await flw?.close();
  await oxr?.close();
});

const refresh = () => fetch(`${server.base}/v1/cron/exchange-rates`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json());
const rates = async () => Object.fromEntries((await client(server.base).get('/v1/exchange-rates')).json.data.map(rate => [rate.currency, rate]));

describe('exchange rates', () => {
  test('before any refresh no currency is available', async () => {
    const list = await rates();
    assert.deepEqual(Object.keys(list).sort(), ['GHS', 'KES', 'NGN']);
    assert.equal(list.NGN.available, false);
  });

  test('conversions use the less favourable source plus the margin, in each direction', async () => {
    oxr.state.rates = { NGN: 1500, GHS: 15, KES: 129 };
    flw.state.rates = { NGN: 1520, GHS: 15.1, KES: 130 };
    const run = await refresh();
    assert.deepEqual(run.result.fetched, { open_exchange_rates: 3, flutterwave: 3 });
    assert.deepEqual(run.result.paused, []);

    const { NGN } = await rates();
    assert.equal(NGN.available, true);
    assert.equal(NGN.pay, '1542.8', 'the higher rate (1520) plus 1.5%');
    assert.equal(NGN.receive, '1477.5', 'the lower rate (1500) minus 1.5%');
    assert.equal(NGN.margin_percent, 1.5);

    const { FxService } = await import('../dist/fx/fx.service.js');
    const { amount } = await server.app.get(FxService).chargeForUsdCents(2500, 'NGN');
    assert.equal(amount, 3_857_000n, 'US$25.00 at 1542.8 is NGN 38,570.00');
  });

  test('sources that disagree beyond the limit pause the currency and alert admins', async () => {
    oxr.state.rates = { NGN: 1500, GHS: 15, KES: 129 };
    flw.state.rates = { NGN: 1520, GHS: 16, KES: 130 };
    const run = await refresh();
    assert.deepEqual(run.result.paused, ['GHS']);
    assert.equal((await rates()).GHS.available, false);

    const { EmailService } = await import('../dist/notifications/email.service.js');
    const alert = server.app.get(EmailService).outbox.findLast(m => m.to === 'ops@bitocard.com');
    assert.match(alert.subject, /GHS conversions paused/);
    assert.match(alert.text, /differ by 6\.67%/);

    const { FxService } = await import('../dist/fx/fx.service.js');
    await assert.rejects(server.app.get(FxService).chargeForUsdCents(100, 'GHS'), error => error.code === 'conversion_unavailable');

    // It stays paused, even when the sources agree again, until an admin resumes it.
    flw.state.rates.GHS = 15.05;
    await refresh();
    assert.equal((await rates()).GHS.available, false);
    const resumed = await admin.patch('/v1/admin/currencies/ghs', { paused: false });
    assert.deepEqual([resumed.json.paused, resumed.json.paused_reason], [false, null]);
    assert.equal((await rates()).GHS.available, true);
  });

  test('stale rates are not used', async () => {
    await prisma.exchangeRate.updateMany({ where: { currency: 'KES' }, data: { fetchedAt: new Date(Date.now() - 4 * 3600_000) } });
    assert.equal((await rates()).KES.available, false);
    await refresh();
    assert.equal((await rates()).KES.available, true);
  });

  test('one source alone is enough while the other is down', async () => {
    oxr.state.down = true;
    try {
      await prisma.exchangeRate.deleteMany({ where: { currency: 'NGN', source: 'open_exchange_rates' } });
      const run = await refresh();
      assert.ok(run.result.errors >= 1);
      assert.equal((await rates()).NGN.receive, '1497.2', 'Flutterwave 1520 minus 1.5%');
    } finally {
      oxr.state.down = false;
    }
  });

  test('finance admins set the margin; changes are audited; other admins cannot', async () => {
    const updated = await admin.patch('/v1/admin/currencies/NGN', { margin_bps: 200 });
    assert.equal(updated.json.margin_bps, 200);
    assert.equal((await rates()).NGN.margin_percent, 2);
    assert.equal((await admin.patch('/v1/admin/currencies/NGN', { margin_bps: 5000 })).json.error.param, 'margin_bps');
    assert.equal((await admin.patch('/v1/admin/currencies/XXX', { margin_bps: 100 })).status, 404);
    const listed = (await admin.get('/v1/admin/currencies')).json.data.find(c => c.currency === 'NGN');
    assert.ok(listed.sources.length >= 1);
    const log = await prisma.auditLog.findFirst({ where: { action: 'currency.updated', targetId: 'NGN' } });
    assert.equal(log.after.marginBps, 200);

    const support = await adminClient(server, ['support']);
    assert.equal((await support.patch('/v1/admin/currencies/NGN', { margin_bps: 100 })).status, 403);
  });
});
