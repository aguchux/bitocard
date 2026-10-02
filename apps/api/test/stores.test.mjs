// Reseller onboarding, stores, subdomains, publishing and the public storefront lookup.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, lastEmailCode, resellerClient, startApp } from './helpers.mjs';

let server;
let admin;
let counter = 0;

before(async () => {
  server = await startApp();
  admin = await adminClient(server);
});

after(() => server?.close());

const sub = label => `${label}${(counter += 1)}${Date.now().toString(36)}`.slice(0, 30);

/** A reseller with a confirmed email (needed to publish). */
async function verifiedReseller(options) {
  const reseller = await resellerClient(server, options);
  await reseller.browser.post('/v1/auth/email/verify', { code: await lastEmailCode(server.app, reseller.email) });
  return reseller;
}

describe('subdomains', () => {
  test('format, reserved names and taken names are checked', async () => {
    const { browser } = await resellerClient(server);
    const check = async name => (await browser.get(`/v1/stores/subdomains/${name}`)).json;
    assert.equal((await check(sub('ada'))).available, true);
    for (const bad of ['ab', '-ada', 'ada-', 'ad--a', 'Ada_Shop', 'a'.repeat(31)]) {
      assert.equal((await check(bad)).available, false, bad);
    }
    assert.deepEqual([(await check('admin')).available, (await check('admin')).reason], [false, 'This name is reserved.']);

    const name = sub('taken');
    await browser.post('/v1/stores', { name: 'Taken Store', subdomain: name });
    assert.deepEqual([(await check(name)).available, (await check(name)).reason], [false, 'This name is taken.']);
  });

  test('two resellers cannot take the same subdomain', async () => {
    const name = sub('dupe');
    const first = await resellerClient(server);
    const second = await resellerClient(server);
    assert.equal((await first.browser.post('/v1/stores', { name: 'First', subdomain: name })).status, 201);
    const clash = await second.browser.post('/v1/stores', { name: 'Second', subdomain: name.toUpperCase() });
    assert.deepEqual([clash.status, clash.json.error.code], [409, 'subdomain_taken']);
  });
});

describe('creating and updating', () => {
  test('a store starts as a draft with default branding on its own address', async () => {
    const { browser } = await resellerClient(server);
    const name = sub('ada');
    const { status, json } = await browser.post('/v1/stores', { name: 'Ada Digital', subdomain: name });
    assert.equal(status, 201);
    assert.deepEqual([json.status, json.url, json.branding.primary_color], ['draft', `https://${name}.bitocard.com`, '#070f4c']);
    assert.equal((await browser.get('/v1/stores')).json.data.length, 1);
  });

  test('one store per reseller for now', async () => {
    const { browser } = await resellerClient(server);
    await browser.post('/v1/stores', { name: 'One', subdomain: sub('one') });
    const second = await browser.post('/v1/stores', { name: 'Two', subdomain: sub('two') });
    assert.equal(second.json.error.code, 'store_limit_reached');
  });

  test('branding is validated; logos must be HTTPS', async () => {
    const { browser } = await resellerClient(server);
    const store = (await browser.post('/v1/stores', { name: 'Shop', subdomain: sub('brand') })).json;
    const ok = await browser.patch(`/v1/stores/${store.id}`, { primary_color: '#123ABC', logo_url: 'https://cdn.example.com/logo.png' });
    assert.deepEqual([ok.json.branding.primary_color, ok.json.branding.logo_url], ['#123abc', 'https://cdn.example.com/logo.png']);
    assert.equal((await browser.patch(`/v1/stores/${store.id}`, { accent_color: 'pink' })).json.error.param, 'accent_color');
    assert.equal((await browser.patch(`/v1/stores/${store.id}`, { logo_url: 'http://insecure.example/logo.png' })).json.error.param, 'logo_url');
    assert.equal((await browser.patch(`/v1/stores/${store.id}`, { logo_url: null })).json.branding.logo_url, null);
  });

  test("other resellers' stores are invisible", async () => {
    const owner = await resellerClient(server);
    const store = (await owner.browser.post('/v1/stores', { name: 'Mine', subdomain: sub('mine') })).json;
    const stranger = await resellerClient(server);
    assert.equal((await stranger.browser.patch(`/v1/stores/${store.id}`, { name: 'Stolen' })).status, 404);
  });
});

describe('onboarding the country', () => {
  test('a reseller without a country (Google sign-up) sets it once, then can create a store', async () => {
    const { browser, resellerId } = await resellerClient(server);
    const { PrismaService } = await import('../dist/database/prisma.service.js');
    await server.app.get(PrismaService).reseller.update({ where: { id: resellerId }, data: { country: null } });

    const noCountry = await browser.post('/v1/stores', { name: 'Shop', subdomain: sub('nocountry') });
    assert.equal(noCountry.json.error.code, 'country_required');
    assert.equal((await browser.patch('/v1/reseller', { country: 'GB' })).json.error.code, 'country_not_supported');

    const set = await browser.patch('/v1/reseller', { country: 'ke', name: 'Wanjiru Digital' });
    assert.deepEqual([set.status, set.json.country, set.json.name], [200, 'KE', 'Wanjiru Digital']);
    const locked = await browser.patch('/v1/reseller', { country: 'NG' });
    assert.equal(locked.json.error.code, 'country_locked');
    assert.equal((await browser.post('/v1/stores', { name: 'Shop', subdomain: sub('withcountry') })).status, 201);
  });
});

describe('publishing and the public storefront', () => {
  test('publishing needs a confirmed email; a published store is public with its currency', async () => {
    const unverified = await resellerClient(server);
    const draft = (await unverified.browser.post('/v1/stores', { name: 'Draft', subdomain: sub('draft') })).json;
    assert.equal((await unverified.browser.post(`/v1/stores/${draft.id}/publish`)).json.error.code, 'email_verification_required');
    assert.equal((await client(server.base).get(`/v1/storefronts/${draft.subdomain}`)).status, 404, 'drafts are not public');

    const { browser } = await verifiedReseller({ country: 'GH' });
    const store = (await browser.post('/v1/stores', { name: 'Kofi Cards', subdomain: sub('kofi'), accent_color: '#00aa55' })).json;
    const published = await browser.post(`/v1/stores/${store.id}/publish`);
    assert.equal(published.json.status, 'published');

    const res = await client(server.base).get(`/v1/storefronts/${store.subdomain.toUpperCase()}`);
    assert.equal(res.status, 200);
    assert.match(res.res.headers.get('cache-control'), /public/);
    assert.deepEqual([res.json.name, res.json.currency, res.json.branding.accent_color], ['Kofi Cards', 'GHS', '#00aa55']);
  });

  test('the address cannot change while published', async () => {
    const { browser } = await verifiedReseller();
    const store = (await browser.post('/v1/stores', { name: 'Shop', subdomain: sub('live') })).json;
    await browser.post(`/v1/stores/${store.id}/publish`);
    assert.equal((await browser.patch(`/v1/stores/${store.id}`, { subdomain: sub('moved') })).json.error.code, 'subdomain_locked');
    await browser.post(`/v1/stores/${store.id}/unpublish`);
    assert.equal((await browser.patch(`/v1/stores/${store.id}`, { subdomain: sub('moved') })).status, 200);
  });

  test('an admin can suspend a store; the reseller cannot republish it', async () => {
    const { browser } = await verifiedReseller();
    const store = (await browser.post('/v1/stores', { name: 'Shop', subdomain: sub('susp') })).json;
    await browser.post(`/v1/stores/${store.id}/publish`);
    const suspended = await admin.patch(`/v1/admin/stores/${store.id}`, { status: 'suspended' });
    assert.equal(suspended.json.status, 'suspended');
    assert.equal((await client(server.base).get(`/v1/storefronts/${store.subdomain}`)).status, 404);
    assert.equal((await browser.post(`/v1/stores/${store.id}/publish`)).json.error.code, 'store_suspended');
  });
});

describe('access', () => {
  test('API keys need the stores:manage scope; staff need the admin role', async () => {
    const { browser } = await resellerClient(server);
    const full = (await browser.post('/v1/api-keys', { name: 'Full', mode: 'test' })).json.secret;
    const narrow = (await browser.post('/v1/api-keys', { name: 'Narrow', mode: 'test', scopes: ['catalogue:read'] })).json.secret;
    const create = (secret, name) =>
      fetch(`${server.base}/v1/stores`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json', 'idempotency-key': `store-${name}` },
        body: JSON.stringify({ name: 'Via API', subdomain: name }),
      });
    assert.equal((await create(narrow, sub('narrow'))).status, 403);
    assert.equal((await create(full, sub('viaapi'))).status, 201);
  });

  test('store creation needs an Idempotency-Key, like every POST', async () => {
    const { browser } = await resellerClient(server);
    const res = await browser.post('/v1/stores', { name: 'Shop', subdomain: sub('idem') }, { 'idempotency-key': '' });
    assert.equal(res.status, 400);
  });
});
