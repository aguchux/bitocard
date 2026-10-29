// Afrippa's markets (docs/CRYPTO_SPINOFF_PLAN.md, step 6): Afrippa's own admins open each market (its switches, for
// all of Afrippa or one country), see what each still needs before trading live (fee rates, limits), and move
// Afrippa's store from the sandbox to live; BitoCard's admins can do none of it.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, afrippaAdminClient, startApp } from './helpers.mjs';

const { PrismaService } = await import('../dist/database/prisma.service.js');
const { CryptoWalletsService } = await import('../dist/crypto/crypto-wallets.service.js');

let server;
let prisma;
let operations;
let support;
let bitocard;

before(async () => {
  server = await startApp({ env: { CRYPTO_ROUTES: 'closed', AFRIPPA_SERVER_SECRET: 'afrippa-markets-secret-afrippa-markets-secret' } });
  prisma = server.app.get(PrismaService);
  operations = await afrippaAdminClient(server, ['operations']);
  support = await afrippaAdminClient(server, ['support']);
  bitocard = await adminClient(server, ['super_admin']);
});

after(async () => {
  await server?.close();
});

const country = (overview, code) => overview.countries.find(item => item.code === code);

describe("Afrippa's markets", () => {
  test('a market opens country by country; the global level alone allows nobody', async () => {
    const start = (await support.get('/v1/afrippa/admin/markets')).json;
    assert.equal(start.store_mode, 'test');
    assert.deepEqual(country(start, 'NG').switches.p2p_trading, { set: null, on: false });
    assert.equal(country(start, 'NG').allowed, false);
    assert.equal(start.global.switches.crypto_cross_border, undefined, 'cross-border is per country only');
    assert.ok(start.definitions.crypto_global.label);

    // Support reads; only operations change.
    assert.equal((await support.put('/v1/afrippa/admin/markets/switches/crypto_wallets', { enabled: true })).status, 403);

    for (const key of ['crypto_wallets', 'p2p_trading']) assert.equal((await operations.put(`/v1/afrippa/admin/markets/switches/${key}`, { enabled: true })).status, 200);
    const global = (await operations.get('/v1/afrippa/admin/markets')).json;
    assert.deepEqual(country(global, 'NG').switches.p2p_trading, { set: null, on: true }, 'follows all of Afrippa');
    assert.equal(country(global, 'NG').allowed, false, 'the global level never allows a country');

    for (const key of ['crypto_wallets', 'p2p_trading']) assert.equal((await operations.put(`/v1/afrippa/admin/markets/switches/${key}`, { country_code: 'ng', enabled: true })).status, 200);
    const open = (await operations.get('/v1/afrippa/admin/markets')).json;
    assert.deepEqual([country(open, 'NG').switches.p2p_trading, country(open, 'NG').allowed], [{ set: true, on: true }, true]);
    assert.equal(await server.app.get(CryptoWalletsService).allowedCountry('NG'), true, 'trading reads the same switch');

    // Cleared, a country follows all of Afrippa again; cross-border is set per country only.
    const cleared = (await operations.put('/v1/afrippa/admin/markets/switches/p2p_trading', { country_code: 'NG', enabled: null })).json;
    assert.deepEqual([country(cleared, 'NG').switches.p2p_trading, country(cleared, 'NG').allowed], [{ set: null, on: true }, false]);
    const scope = await operations.put('/v1/afrippa/admin/markets/switches/crypto_cross_border', { enabled: true });
    assert.deepEqual([scope.status, scope.json.error.code], [400, 'scope_not_allowed']);
    assert.equal((await operations.put('/v1/afrippa/admin/markets/switches/spin_rewards', { enabled: true })).status, 404, 'only market switches');

    const audit = await prisma.auditLog.findFirst({ where: { action: 'switch.set', targetId: 'p2p_trading:country:NG' }, orderBy: { createdAt: 'desc' } });
    assert.equal(audit.platform, 'afrippa', "in Afrippa's trail");
  });

  test('readiness: a market needs fee rates and live limits before trading live', async () => {
    const before = country((await operations.get('/v1/afrippa/admin/markets')).json, 'GH');
    assert.deepEqual(before.ready, { fee_rates: false, limits: false });
    await prisma.p2pFeeRate.create({ data: { asset: 'USDT', market: 'GH', buyerBps: 50, sellerBps: 100 } });
    await prisma.cryptoMarketLimit.create({ data: { mode: 'live', market: 'GH', currency: 'GHS', perTradeMinor: 100000n } });
    const after = (await operations.get('/v1/afrippa/admin/markets')).json;
    assert.deepEqual(country(after, 'GH').ready, { fee_rates: true, limits: true });
    assert.deepEqual(after.global.ready, { fee_rates: false, limits: false });
  });

  test("the store moves between the sandbox and live, by operations, audited in Afrippa's trail", async () => {
    assert.equal((await support.put('/v1/afrippa/admin/markets/store-mode', { mode: 'live', reason: 'Pilot opens' })).status, 403);
    const live = await operations.put('/v1/afrippa/admin/markets/store-mode', { mode: 'live', reason: 'The pilot opens in Nigeria.' });
    assert.deepEqual([live.status, live.json.store_mode], [200, 'live']);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'afrippa.store_mode_changed' } });
    assert.deepEqual([audit.platform, audit.after.mode], ['afrippa', 'live']);
    assert.equal((await operations.put('/v1/afrippa/admin/markets/store-mode', { mode: 'test', reason: 'Back to the sandbox.' })).json.store_mode, 'test');
  });

  test("BitoCard's admins can neither read nor set them", async () => {
    assert.equal((await bitocard.get('/v1/afrippa/admin/markets')).status, 401);
    const refused = await bitocard.put('/v1/admin/switches/p2p_trading', { country_code: 'NG', enabled: true });
    assert.deepEqual([refused.status, refused.json.error.code], [404, 'resource_missing']);
  });
});
