// BitoCard Shop, phase 1 step 2e: a buyer's saved listings: live, sold (for 30 days) or gone, with any price drop.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, lastEmailCode, startApp } from './helpers.mjs';

let server;
let prisma;

before(async () => {
  server = await startApp();
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  const admin = await adminClient(server);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
});

after(() => server?.close());

function storeServer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `shop-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body), delete: path => request('DELETE', path) };
}

let counter = 0;
async function customer() {
  const shopper = storeServer();
  const email = `fav${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Kemi Ade', email, password: 'correct horse battery', country: 'NG' });
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  return shopper;
}

async function live(shopper, title, price) {
  const [cat, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
  const draft = (await shopper.post('/v1/classifieds/listings', { title, price, condition: 'used', category_id: cat.id, area_id: area.id })).json;
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.id, kind: 'photo', position, url: `https://media.test/${draft.id}-${position}.jpg` })) });
  const submitted = (await shopper.post(`/v1/classifieds/listings/${draft.id}/submit`)).json;
  assert.equal(submitted.status, 'active', JSON.stringify(submitted));
  return submitted;
}

describe('favourites', () => {
  test('saved once each, newest first, with price drops, sold and gone ones marked', async () => {
    const seller = await customer();
    const buyer = await customer();
    const [tv, soundbar, fridge] = [await live(seller, 'Hisense 50 inch TV', 25000000), await live(seller, 'Sony soundbar with subwoofer', 9000000), await live(seller, 'Samsung 55 inch QLED TV', 60000000)];
    for (const listing of [tv, soundbar, fridge]) assert.equal((await buyer.post('/v1/classifieds/favourites', { listing_id: listing.id })).status, 200);
    assert.equal((await buyer.post('/v1/classifieds/favourites', { listing_id: tv.id })).status, 200, 'saving again changes nothing');
    assert.equal((await seller.post('/v1/classifieds/favourites', { listing_id: tv.id })).json.error.param, 'listing_id', 'not your own');

    await seller.patch(`/v1/classifieds/listings/${tv.id}`, { price: 22000000 });
    await seller.post(`/v1/classifieds/listings/${soundbar.id}/sold`);
    await seller.delete(`/v1/classifieds/listings/${fridge.id}`);

    const saved = await buyer.get('/v1/classifieds/favourites');
    assert.equal(saved.json.total, 3);
    const byId = Object.fromEntries(saved.json.data.map(row => [row.listing_id, row]));
    assert.deepEqual([byId[tv.id].state, byId[tv.id].price_drop, byId[tv.id].listing.price.amount], ['live', 3000000, 22000000]);
    assert.deepEqual([byId[soundbar.id].state, byId[soundbar.id].price_drop], ['sold', null]);
    assert.deepEqual([byId[fridge.id].state, byId[fridge.id].listing], ['gone', null]);
    assert.deepEqual(saved.json.data.map(row => row.listing_id), [fridge.id, soundbar.id, tv.id], 'newest saved first');

    assert.equal((await buyer.delete(`/v1/classifieds/favourites/${fridge.id}`)).status, 204);
    assert.equal((await buyer.get('/v1/classifieds/favourites')).json.total, 2);
    assert.equal((await buyer.post('/v1/classifieds/favourites', { listing_id: soundbar.id })).status, 404, 'only live listings are saved');
    assert.equal((await storeServer().get('/v1/classifieds/favourites')).status, 401);
  });
});
