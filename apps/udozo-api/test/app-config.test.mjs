// Udozo's mobile app (docs/UDOZO_MOBILE_APP_PLAN.md, phase 0): GET /v1/app/config says whether the app's version must
// update, may update or is fine, with the store page, from the Mobile app integration's settings.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { compareVersions, updateState } from '../dist/app-config/versions.js';
import { integrationGroups } from '../dist/integrations/definitions.js';
import { internalIntegrations } from '../dist/integrations/links.js';
import { startApp } from './helpers.mjs';

describe('versions', () => {
  test('compared number by number, never as text', () => {
    assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
    assert.ok(compareVersions('1.2.3', '1.2.10') < 0);
    assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
  });

  test('required below the lowest, available below the newest, else none', () => {
    assert.equal(updateState('1.0.0', '1.1.0', '1.4.0'), 'required');
    assert.equal(updateState('1.2.0', '1.1.0', '1.4.0'), 'available');
    assert.equal(updateState('1.4.0', '1.1.0', '1.4.0'), 'none');
    assert.equal(updateState('0.1.0', null, null), 'none');
  });

  test('the Mobile app settings are an internal integration group', () => {
    const group = integrationGroups.find(item => item.id === 'mobile_app');
    assert.ok(group);
    assert.ok(internalIntegrations.has('mobile_app'));
    assert.deepEqual(group.fields.map(item => item.key), [
      'APP_IOS_MIN_VERSION', 'APP_IOS_LATEST_VERSION', 'APP_IOS_STORE_URL',
      'APP_ANDROID_MIN_VERSION', 'APP_ANDROID_LATEST_VERSION', 'APP_ANDROID_STORE_URL',
    ]);
  });
});

describe('GET /v1/app/config', () => {
  let server;

  before(async () => {
    server = await startApp({
      env: {
        APP_PRODUCT: 'udozo',
        PRODUCT_ROUTES: 'separate',
        STOREFRONT_URL: 'https://udozo.com',
        APP_IOS_MIN_VERSION: '1.1.0',
        APP_IOS_LATEST_VERSION: '1.3.0',
        APP_IOS_STORE_URL: 'https://apps.apple.com/app/id000000000',
        APP_ANDROID_LATEST_VERSION: '1.3.0',
      },
    });
  });

  after(() => server?.close());

  const read = async query => {
    const res = await fetch(`${server.base}/v1/app/config?${query}`);
    return { status: res.status, cache: res.headers.get('cache-control'), body: await res.json() };
  };

  test('an old iPhone app must update, and is sent to the App Store', async () => {
    const { status, cache, body } = await read('platform=ios&version=1.0.4');
    assert.equal(status, 200);
    assert.equal(cache, 'public, max-age=60');
    assert.deepEqual(body, {
      object: 'app_config',
      platform: 'ios',
      version: '1.0.4',
      update: 'required',
      min_version: '1.1.0',
      latest_version: '1.3.0',
      store_url: 'https://apps.apple.com/app/id000000000',
      site_url: 'https://udozo.com',
      legal: { terms: 'https://udozo.com/legal/terms', privacy: 'https://udozo.com/legal/privacy' },
      country: null,
      features: null,
    });
  });

  test('a recent one is offered the update; the newest is fine', async () => {
    assert.equal((await read('platform=ios&version=1.2.0')).body.update, 'available');
    assert.equal((await read('platform=ios&version=1.3.0')).body.update, 'none');
  });

  test("Android has its own settings: no lowest version set stops nobody", async () => {
    const { body } = await read('platform=android&version=0.9.0');
    assert.equal(body.update, 'available');
    assert.equal(body.min_version, null);
    assert.equal(body.store_url, null);
  });

  test("with the shopper's market, its features follow the market's switches", async () => {
    const { PrismaService } = await import('../dist/database/prisma.service.js');
    const prisma = server.app.get(PrismaService);
    assert.equal((await read('platform=android&version=1.0.0')).body.features, null, 'none without a market');
    await prisma.featureSwitch.create({ data: { key: 'classifieds_wanted', countryCode: 'NG', enabled: true } });
    const { body } = await read('platform=android&version=1.0.0&country=NG');
    assert.equal(body.country, 'NG');
    assert.equal(body.features.wanted, true);
    assert.deepEqual(Object.keys(body.features).sort(), ['assistant', 'personalisation', 'pos_payments', 'private_ratings', 'reviews', 'seller_scores', 'wanted', 'whatsapp']);
    assert.equal((await read('platform=android&version=1.0.0&country=GH')).body.features.wanted, false);
    assert.equal((await read('platform=android&version=1.0.0&country=ng')).status, 400);
  });

  test('a platform or version it does not know is refused', async () => {
    assert.equal((await read('platform=windows&version=1.0.0')).status, 400);
    assert.equal((await read('platform=ios&version=1.0')).status, 400);
    assert.equal((await read('platform=ios')).status, 400);
  });

  test("it is Udozo's alone", async () => {
    const bitocard = await startApp({ env: { APP_PRODUCT: 'bitocard', PRODUCT_ROUTES: 'separate' } });
    try {
      const res = await fetch(`${bitocard.base}/v1/app/config?platform=ios&version=1.0.0`);
      assert.equal(res.status, 404);
    } finally {
      bitocard.close();
    }
  });
});
