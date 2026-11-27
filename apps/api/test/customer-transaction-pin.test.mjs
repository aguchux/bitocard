import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PrismaService } from '../dist/database/prisma.service.js';
import { startApp } from './helpers.mjs';

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
    assert.equal((await primary.post('/v1/store/account/transaction-pin', { current_password: 'wrong password', pin: '246802' })).json.error.code, 'password_incorrect');

    const set = await primary.post('/v1/store/account/transaction-pin', { current_password: password, pin: '246802' });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.equal(set.json.set, true);
    const stored = await prisma.customer.findFirstOrThrow({ where: { email } });
    assert.notEqual(stored.transactionPinHash, '246802');
    assert.ok(stored.transactionPinHash.length > 30, 'only a slow password hash is stored');

    const missing = await primary.post('/v1/store/account/transaction-pin/verify');
    assert.deepEqual([missing.status, missing.json.error.code], [403, 'transaction_pin_required']);
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
