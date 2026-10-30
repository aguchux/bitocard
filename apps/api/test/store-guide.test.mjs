// SHQ's guide to creating a first store: owners and admins without a store, at most three times, 10 minutes apart.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PrismaService } from '../dist/database/prisma.service.js';
import { adminClient, resellerClient, startApp } from './helpers.mjs';

let server;
let admin;
let prisma;

before(async () => {
  server = await startApp();
  admin = await adminClient(server);
  prisma = server.app.get(PrismaService);
});

after(() => server?.close());

const claim = browser => browser.post('/v1/onboarding/store-guide');
// Moves this person's last showing back, as if that much time had passed.
const wait = (resellerId, userId, minutes) =>
  prisma.resellerMember.update({ where: { resellerId_userId: { resellerId, userId } }, data: { storeGuideShownAt: new Date(Date.now() - minutes * 60_000) } });

describe('store guide', () => {
  test('a new owner is shown it at most three times, at least 10 minutes apart, then never again', async () => {
    const { browser, resellerId, userId } = await resellerClient(server);
    const first = await claim(browser);
    assert.equal(first.status, 200);
    assert.deepEqual([first.json.object, first.json.show, first.json.times_shown, first.json.limit], ['store_guide', true, 1, 3]);

    const soon = await claim(browser);
    assert.deepEqual([soon.json.show, soon.json.times_shown], [false, 1], 'a reload within 10 minutes does not show it again');
    assert.ok(Date.parse(soon.json.next_at) > Date.now() + 9 * 60_000, 'it says when it may come back');

    await wait(resellerId, userId, 9);
    assert.equal((await claim(browser)).json.show, false, 'nine minutes is too soon');

    await wait(resellerId, userId, 10);
    assert.deepEqual([(await claim(browser)).json.show, (await claim(browser)).json.times_shown], [true, 2]);
    await wait(resellerId, userId, 11);
    const third = await claim(browser);
    assert.deepEqual([third.json.show, third.json.times_shown, third.json.next_at], [true, 3, null], 'the third showing is the last');

    await wait(resellerId, userId, 60);
    const done = await claim(browser);
    assert.deepEqual([done.json.show, done.json.times_shown, done.json.next_at], [false, 3, null]);
  });

  test('two tabs opening at once show it once', async () => {
    const { browser } = await resellerClient(server);
    const answers = await Promise.all([claim(browser), claim(browser), claim(browser)]);
    assert.equal(answers.filter(answer => answer.json.show).length, 1);
  });

  test('never once the account has a store', async () => {
    const { browser, resellerId, userId } = await resellerClient(server);
    assert.equal((await claim(browser)).json.show, true);
    assert.equal((await browser.post('/v1/stores', { name: 'Guide Store', subdomain: `guide${Date.now()}` })).status, 201);
    await wait(resellerId, userId, 30);
    const answer = await claim(browser);
    assert.deepEqual([answer.json.show, answer.json.times_shown], [false, 1], 'nothing is counted');
  });

  test('only owners and admins, who can create stores', async () => {
    const { browser, resellerId, userId } = await resellerClient(server);
    await prisma.resellerMember.update({ where: { resellerId_userId: { resellerId, userId } }, data: { role: 'support' } });
    const answer = await claim(browser);
    assert.deepEqual([answer.status, answer.json.show, answer.json.times_shown], [200, false, 0]);
  });

  test('an admin can switch it off for a reseller, a market or everyone', async () => {
    const { browser, resellerId } = await resellerClient(server, { country: 'GH' });
    assert.equal((await browser.get('/v1/settings')).json.features.shq_store_guide, true, 'on unless switched off');
    const off = await admin.put('/v1/admin/switches/shq_store_guide', { reseller_id: resellerId, enabled: false });
    assert.equal(off.status, 200);
    const answer = await claim(browser);
    assert.deepEqual([answer.json.show, answer.json.times_shown], [false, 0]);

    await admin.put('/v1/admin/switches/shq_store_guide', { reseller_id: resellerId, enabled: null });
    assert.equal((await claim(browser)).json.show, true, 'back to following the market');
  });

  test('API keys cannot ask', async () => {
    const { browser } = await resellerClient(server);
    const key = await browser.post('/v1/api-keys', { name: 'Guide key', mode: 'test', scopes: ['stores:manage'] });
    assert.equal(key.status, 201, JSON.stringify(key.json));
    const res = await fetch(`${server.base}/v1/onboarding/store-guide`, { method: 'POST', headers: { authorization: `Bearer ${key.json.secret}`, 'idempotency-key': `k-${Date.now()}` } });
    assert.equal(res.status, 403);
  });
});
