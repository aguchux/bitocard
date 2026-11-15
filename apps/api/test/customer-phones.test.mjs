// A store customer's mobile numbers: up to five, each confirmed by a texted code, one the default. A number belongs to
// one account at a store; the default cannot be removed until another takes its place.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { lastEmailCode, lastSmsCode, startApp } from './helpers.mjs';

let server;
let prisma;

before(async () => {
  server = await startApp();
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
});

after(async () => {
  await server?.close();
});

function storeServer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method !== 'GET' ? { 'idempotency-key': `store-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), delete: path => request('DELETE', path) };
}

let counter = 0;
async function customer() {
  const shopper = storeServer();
  const email = `phones${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Ada Obi', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) });
  shopper.id = signup.json.customer.id;
  return shopper;
}

/** Texts a code to the number (the one-a-minute wait skipped) and confirms it. */
async function add(shopper, phone) {
  await prisma.customerCode.updateMany({ where: { customerId: shopper.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
  const sent = await shopper.post('/v1/store/account/phones', { phone });
  if (sent.status !== 202) return sent;
  return shopper.post('/v1/store/account/phones/verify', { code: await lastSmsCode(server.app, phone.replace(/^0/, '+234')) });
}

describe('customers\' mobile numbers', () => {
  test('up to five confirmed numbers, the first the default, any one made the default', async () => {
    const shopper = await customer();
    const first = await add(shopper, '08031230001');
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.deepEqual(first.json.data.map(item => [item.phone, item.default]), [['+2348031230001', true]]);
    assert.equal((await shopper.get('/v1/store/account')).json.phone_verified, true, 'the first is the account\'s number');

    for (const tail of ['2', '3', '4', '5']) assert.equal((await add(shopper, `0803123000${tail}`)).status, 200);
    const listed = (await shopper.get('/v1/store/account/phones')).json;
    assert.equal(listed.data.length, 5);
    assert.equal(listed.default, '+2348031230001', 'adding more never moves the default');
    assert.equal((await add(shopper, '08031230006')).json.error.code, 'phone_limit');
    assert.equal((await add(shopper, '08031230002')).json.error.code, 'phone_already_added');

    assert.equal((await shopper.delete('/v1/store/account/phones/%2B2348031230001')).json.error.code, 'default_phone');
    const moved = await shopper.post('/v1/store/account/phones/default', { phone: '08031230003' });
    assert.equal(moved.json.default, '+2348031230003');
    assert.equal(moved.json.data[0].phone, '+2348031230003', 'the default is listed first');
    assert.equal((await shopper.get('/v1/store/account')).json.phone, '+2348031230003');
    const removed = await shopper.delete('/v1/store/account/phones/%2B2348031230001');
    assert.equal(removed.status, 200, JSON.stringify(removed.json));
    assert.equal(removed.json.data.length, 4);
    assert.equal((await shopper.post('/v1/store/account/phones/default', { phone: '08031230001' })).json.error.code, 'resource_missing');
  });

  test('a number confirmed on one account cannot be added to another', async () => {
    const owner = await customer();
    assert.equal((await add(owner, '08031230100')).status, 200);
    assert.equal((await add(owner, '08031230101')).status, 200);
    const other = await customer();
    assert.equal((await add(other, '08031230101')).json.error.code, 'phone_in_use', 'not the default, still taken');
    assert.equal((await add(other, '08031230100')).json.error.code, 'phone_in_use');
  });

  test('the single-number flow still makes the confirmed number the default', async () => {
    const shopper = await customer();
    assert.equal((await add(shopper, '08031230200')).status, 200);
    await prisma.customerCode.updateMany({ where: { customerId: shopper.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
    assert.equal((await shopper.post('/v1/store/account/phone', { phone: '08031230201' })).status, 202);
    const changed = await shopper.post('/v1/store/account/phone/verify', { code: await lastSmsCode(server.app, '+2348031230201') });
    assert.equal(changed.json.phone, '+2348031230201');
    const listed = (await shopper.get('/v1/store/account/phones')).json;
    assert.deepEqual(listed.data.map(item => [item.phone, item.default]), [['+2348031230201', true], ['+2348031230200', false]]);
  });
});
