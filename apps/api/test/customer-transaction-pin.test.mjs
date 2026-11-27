import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PrismaService } from '../dist/database/prisma.service.js';
import { lastEmailCode, startApp } from './helpers.mjs';

const password = 'correct horse battery';
const pinHeader = { 'bitocard-transaction-pin': '246802' };
let server;
let prisma;

before(async () => {
  server = await startApp();
  prisma = server.app.get(PrismaService);
});

after(() => server?.close());

describe('customer transaction PIN', () => {
  test('is hashed, verifies server-side, and locks after five failures', async () => {
    const email = `pin-${Date.now()}@example.com`;
    let token;
    const primary = {
      async request(method, path, body = undefined, headers = {}) {
        const response = await fetch(`${server.base}${path}`, {
          method,
          headers: {
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
            ...(token ? { 'bitocard-customer-session': token } : {}),
            ...(method === 'POST' ? { 'idempotency-key': `pin-${Date.now()}-${Math.random()}` } : {}),
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await response.text();
        const json = text ? JSON.parse(text) : null;
        if (json?.session?.token) token = json.session.token;
        return { status: response.status, json };
      },
      get(path, headers) { return this.request('GET', path, undefined, headers); },
      post(path, body = {}, headers) { return this.request('POST', path, body, headers); },
    };
    const signup = await primary.post('/v1/store/account/signup', { name: 'Ada Secure', email, password, country: 'NG' });
    assert.equal(signup.status, 201, JSON.stringify(signup.json));

    assert.deepEqual((await primary.get('/v1/store/account/transaction-pin')).json, {
      object: 'transaction_pin', set: false, locked_until: null, updated_at: null,
    });
    const sent = await primary.post('/v1/store/account/transaction-pin/code');
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    assert.match(sent.json.sent_to, /^p•••@example\.com$/);
    const code = await lastEmailCode(server.app, email);
    assert.equal((await primary.post('/v1/store/account/transaction-pin', { pin: '246802' })).json.error.code, 'transaction_pin_code_required');
    assert.equal((await primary.post('/v1/store/account/transaction-pin/code/verify', { code: '000000' })).json.error.code, 'code_invalid');
    const verified = await primary.post('/v1/store/account/transaction-pin/code/verify', { code });
    assert.equal(verified.status, 200, JSON.stringify(verified.json));
    assert.equal(verified.json.verified, true);
    const set = await primary.post('/v1/store/account/transaction-pin', { pin: '246802' });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.equal(set.json.set, true);
    assert.equal((await primary.post('/v1/store/account/transaction-pin', { pin: '864209' })).json.error.code, 'transaction_pin_code_required', 'the verified step is single-use');
    const stored = await prisma.customer.findFirstOrThrow({ where: { email } });
    assert.notEqual(stored.transactionPinHash, '246802');
    assert.ok(stored.transactionPinHash.length > 30, 'only a slow password hash is stored');

    const missing = await primary.post('/v1/store/account/transaction-pin/verify');
    assert.deepEqual([missing.status, missing.json.error.code], [403, 'transaction_pin_required']);
    assert.equal((await primary.post('/v1/store/account/transaction-pin/verify', {}, pinHeader)).status, 200);

    assert.equal((await primary.post('/v1/store/account/transaction-pin/code')).status, 200, 'changing the PIN sends a fresh OTP too');
    const changeCode = await lastEmailCode(server.app, email);
    assert.equal((await primary.post('/v1/store/account/transaction-pin/code/verify', { code: changeCode })).status, 200);
    assert.equal((await primary.post('/v1/store/account/transaction-pin', { pin: '864209' })).status, 200);
    assert.equal((await primary.post('/v1/store/account/transaction-pin/verify', {}, pinHeader)).json.error.code, 'transaction_pin_incorrect', 'the old PIN stops immediately');
    pinHeader['bitocard-transaction-pin'] = '864209';
    assert.equal((await primary.post('/v1/store/account/transaction-pin/verify', {}, pinHeader)).status, 200);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const wrong = await primary.post('/v1/store/account/transaction-pin/verify', {}, { 'bitocard-transaction-pin': '135790' });
      assert.deepEqual([wrong.status, wrong.json.error.code], [400, 'transaction_pin_incorrect']);
    }
    const locked = await primary.post('/v1/store/account/transaction-pin/verify', {}, { 'bitocard-transaction-pin': '135790' });
    assert.deepEqual([locked.status, locked.json.error.code], [429, 'transaction_pin_locked']);
    const correctWhileLocked = await primary.post('/v1/store/account/transaction-pin/verify', {}, pinHeader);
    assert.deepEqual([correctWhileLocked.status, correctWhileLocked.json.error.code], [429, 'transaction_pin_locked']);
  });
});
