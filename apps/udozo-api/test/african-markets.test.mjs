// BitoCard's other twelve African markets on Udozo, added closed: nobody can sign up in them or see them as a market
// until an admin opens one, and each comes with its currency, every category as Nigeria has it, UdozoPay and market
// settings, and its divisions with their towns (from GeoNames, a few old names as they are now).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, startApp, testMobile } from './helpers.mjs';

let server;
let admin;
let prisma;
const added = ['BJ', 'CM', 'CG', 'CD', 'GA', 'CI', 'MZ', 'RW', 'SN', 'SL', 'UG', 'ZM'];

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server, ['super_admin']);
});

after(() => server?.close());

const signup = (country, email = `markets-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`) =>
  fetch(`${server.base}/v1/store/account/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `markets-${Math.random()}` },
    body: JSON.stringify({ first_name: 'Grace', last_name: 'Auma', email, password: 'correct horse battery', country, phone: testMobile(country) }),
  }).then(async res => ({ status: res.status, json: await res.json() }));

describe('the twelve markets', () => {
  test('are there, closed, each with its currency and Udozo Verify', async () => {
    const rows = await prisma.country.findMany({ where: { code: { in: added } }, include: { categories: true } });
    assert.equal(rows.length, 12);
    const by = Object.fromEntries(rows.map(row => [row.code, row]));
    assert.deepEqual([by.CI.currency, by.CM.currency, by.CD.currency, by.RW.currency, by.UG.currency, by.ZM.currency, by.SL.currency], ['XOF', 'XAF', 'CDF', 'RWF', 'UGX', 'ZMW', 'SLE']);
    assert.ok(rows.every(row => !row.resellerSignup && !row.reservedAccounts && row.smsProvider === null && row.identityProvider === 'bitocard'));
    assert.ok(rows.every(row => row.categories.length === 12 && row.categories.filter(item => item.enabled).map(item => item.category).join() === 'software'));
    const currencies = await prisma.currencySetting.findMany({ where: { currency: { in: ['XOF', 'XAF', 'CDF', 'MZN', 'RWF', 'SLE', 'UGX', 'ZMW'] } } });
    assert.equal(currencies.length, 8, 'their exchange rates are fetched');

    const open = await fetch(`${server.base}/v1/countries`).then(res => res.json());
    assert.deepEqual(open.data.map(item => item.code).sort(), ['GH', 'KE', 'NG'], 'sign-up offers only the open markets');
    // Off by themselves, so the marketplace being on everywhere (as it is in production) does not open them.
    assert.equal((await admin.put('/v1/admin/switches/classifieds', { enabled: true })).status, 200);
    const markets = await fetch(`${server.base}/v1/classifieds/markets`).then(res => res.json());
    assert.ok(markets.data.some(item => item.country === 'NG'));
    assert.ok(markets.data.every(item => !added.includes(item.country)), 'not a marketplace anywhere yet');
    assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'RW', enabled: true })).status, 200);
    const opened = await fetch(`${server.base}/v1/classifieds/markets`).then(res => res.json());
    assert.ok(opened.data.some(item => item.country === 'RW'), 'an admin opens one');
    await admin.put('/v1/admin/switches/classifieds', { country_code: 'RW', enabled: false });
    await admin.put('/v1/admin/switches/classifieds', { enabled: null });
  });

  test('each has every category as Nigeria has it, UdozoPay and market settings', async () => {
    const nigeria = await prisma.classifiedCategoryCountry.count({ where: { country: 'NG' } });
    for (const country of added) {
      assert.equal(await prisma.classifiedCategoryCountry.count({ where: { country } }), nigeria, country);
      assert.ok(await prisma.classifiedSafePaySettings.findUnique({ where: { country } }), `${country} UdozoPay settings`);
      assert.ok(await prisma.classifiedMarketSettings.findUnique({ where: { country } }), `${country} market settings`);
    }
  });

  test('each has its divisions, every one with its towns, the capital first', async () => {
    for (const country of added) {
      const states = await prisma.classifiedArea.findMany({ where: { country, kind: 'state' }, include: { children: { orderBy: { position: 'asc' }, select: { name: true } } } });
      assert.ok(states.length >= 4, `${country} has its divisions`);
      assert.ok(states.every(state => state.children.length >= 1), `${country}: every division has a town`);
    }
    const kigali = await prisma.classifiedArea.findFirstOrThrow({ where: { country: 'RW', kind: 'state', slug: 'kigali' }, include: { children: { orderBy: { position: 'asc' } } } });
    assert.equal(kigali.children[0].name, 'Kigali');
    const rwanda = (await prisma.classifiedArea.findMany({ where: { country: 'RW', kind: 'area' }, select: { name: true } })).map(item => item.name);
    assert.ok(rwanda.includes('Rubavu') && rwanda.includes('Huye') && !rwanda.includes('Gisenyi'), "Rwanda's towns by their names now");
    const lagos = await prisma.classifiedArea.findFirstOrThrow({ where: { country: 'SN', kind: 'state', slug: 'dakar' }, include: { children: { orderBy: { position: 'asc' } } } });
    assert.equal(lagos.children[0].name, 'Dakar');
    assert.ok(lagos.children.every(item => !/\d|\bII?\b/.test(item.name)), 'no numbered estates');
  });
});

describe('opening one', () => {
  test('nobody signs up in a closed market, even asking the API directly; once an admin opens it, they can', async () => {
    const refused = await signup('UG');
    assert.equal(refused.status, 400, JSON.stringify(refused.json));
    assert.equal(refused.json.error.code, 'market_unavailable');
    const opened = await admin.patch('/v1/admin/countries/UG', { reseller_signup: true });
    assert.equal(opened.status, 200, JSON.stringify(opened.json));
    const made = await signup('UG');
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.equal(made.json.customer.country, 'UG');
    await admin.patch('/v1/admin/countries/UG', { reseller_signup: false });
  });
});
