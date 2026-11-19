// BitoCard's mobile app (docs/BITOCARD_MOBILE_APP_PLAN.md, phase 4): GET /v1/app/config says whether the app's version
// must update, may update or is fine, with the store page and the legal documents, from the Mobile app integration.
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

  test('the Mobile app and Phone push settings are integration groups', () => {
    const app = integrationGroups.find(item => item.id === 'mobile_app');
    assert.ok(internalIntegrations.has('mobile_app'));
    assert.deepEqual(app.fields.map(item => item.key), ['APP_IOS_MIN_VERSION', 'APP_IOS_LATEST_VERSION', 'APP_IOS_STORE_URL', 'APP_ANDROID_MIN_VERSION', 'APP_ANDROID_LATEST_VERSION', 'APP_ANDROID_STORE_URL']);
    const push = integrationGroups.find(item => item.id === 'phone_push');
    assert.deepEqual(push.fields.filter(item => item.secret).map(item => item.key), ['FCM_SERVICE_ACCOUNT', 'APNS_PRIVATE_KEY']);
  });
});

describe('GET /v1/app/config', () => {
  let server;

  before(async () => {
    server = await startApp({
      env: {
        STOREFRONT_URL: 'https://bitocard.com',
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
      site_url: 'https://bitocard.com',
      legal: { terms: 'https://legals.bitocard.com/documents/terms', privacy: 'https://legals.bitocard.com/documents/privacy' },
    });
  });

  test('Android below the newest may update; with no versions set, nobody is asked', async () => {
    assert.equal((await read('platform=android&version=1.2.0')).body.update, 'available');
    const fine = (await read('platform=android&version=1.3.0')).body;
    assert.deepEqual([fine.update, fine.min_version, fine.store_url], ['none', null, null]);
  });

  test('a platform or version that is not one is refused', async () => {
    assert.equal((await read('platform=web&version=1.0.0')).status, 400);
    assert.equal((await read('platform=ios&version=1.0')).status, 400);
  });
});
