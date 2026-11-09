// The account dashboard (8 November 2026, the owner's request): udozo.com's /account shows a customer's own figures
// for 7, 30 or 90 days against the period before, a day-by-day series for its charts, their best listings, and Udozo's
// message board for their market, which Udozo's team writes in the admin (operations write, support reads).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let operations;
let support;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  const admin = await adminClient(server);
  for (const country of ['NG', 'GH']) assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: country, enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
  operations = await adminClient(server, ['operations']);
  support = await adminClient(server, ['support']);
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
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `dashboard-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = res.status === 204 ? null : await res.json();
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json, headers: res.headers };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

let counter = 0;
async function customer(name, country = 'NG') {
  const shopper = storeServer();
  const email = `dash${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country, phone: testMobile(country) });
  await confirmMobile(server.app, shopper);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
  shopper.id = signup.json.customer.id;
  return shopper;
}

async function live(seller, title) {
  const [cat, place] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
  const draft = (await seller.post('/v1/classifieds/listings', { title, price: 25000000, condition: 'used', category_id: cat.id, area_id: place.id, contact: 'both' })).json;
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.id, kind: 'photo', position, url: `https://media.test/${draft.id}-${position}.jpg` })) });
  const submitted = (await seller.post(`/v1/classifieds/listings/${draft.id}/submit`)).json;
  assert.equal(submitted.status, 'active', JSON.stringify(submitted));
  return submitted;
}

const day = 86_400_000;
const today = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
const daysAgo = n => new Date(today().getTime() - n * day);

describe('The account dashboard', () => {
  test("a seller's own figures, against the period before, day by day, with their best listings", async () => {
    const seller = await customer('Chinedu Okafor');
    const buyer = await customer('Ada Obi');
    const other = await customer('Kemi Adeyemi');
    const tv = await live(seller, 'Hisense 50 inch TV');
    const second = await live(seller, 'Samsung 43 inch TV');
    const theirs = await live(other, 'LG 55 inch TV');
    await seller.post('/v1/classifieds/listings', { title: 'Sony soundbar' });

    // Views: 12 today and 3 five days ago on the TV, 4 on the other, 9 in the period before; another seller's never count.
    await prisma.classifiedListingViewDay.createMany({
      data: [
        { listingId: tv.id, day: daysAgo(0), views: 12 },
        { listingId: tv.id, day: daysAgo(5), views: 3 },
        { listingId: second.id, day: daysAgo(1), views: 4 },
        { listingId: tv.id, day: daysAgo(10), views: 9 },
        { listingId: theirs.id, day: daysAgo(0), views: 500 },
      ],
    });
    await prisma.classifiedLead.createMany({
      data: [
        { listingId: tv.id, buyerId: buyer.id, kind: 'chat', firstAt: daysAgo(0) },
        { listingId: tv.id, buyerId: other.id, kind: 'phone', firstAt: daysAgo(2) },
        { listingId: second.id, buyerId: buyer.id, kind: 'chat', firstAt: daysAgo(9) },
      ],
    });
    await prisma.classifiedConversation.create({ data: { listingId: tv.id, buyerId: buyer.id, sellerId: seller.id, country: 'NG', createdAt: daysAgo(0), sellerRepliedAt: new Date() } });
    await prisma.classifiedConversation.create({ data: { listingId: second.id, buyerId: other.id, sellerId: seller.id, country: 'NG', createdAt: daysAgo(3) } });
    await prisma.classifiedFavourite.create({ data: { customerId: buyer.id, listingId: tv.id, createdAt: daysAgo(1) } });
    const order = await prisma.classifiedBuyOrder.create({ data: { listingId: second.id, buyerId: buyer.id, sellerId: seller.id, country: 'NG', currency: 'NGN', priceMinor: 24000000n, status: 'completed', completedAt: daysAgo(1) } });
    await prisma.classifiedPurchase.create({
      data: { source: 'buy_order', buyOrderId: order.id, listingId: second.id, sellerId: seller.id, buyerId: buyer.id, country: 'NG', productKey: `l:${second.id}`, productLabel: 'Samsung 43 inch TV', completedAt: daysAgo(1), reviewClosesAt: new Date(Date.now() + 30 * day) },
    });

    const res = await seller.get('/v1/classifieds/me/dashboard?days=7');
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    const board = res.json;
    assert.deepEqual([board.object, board.country, board.days, board.series.length], ['account_dashboard', 'NG', 7, 7]);
    assert.equal(board.series.at(-1).day, today().toISOString().slice(0, 10), 'ends today');
    assert.deepEqual(board.totals.views, { value: 19, previous: 9, change_pct: 111 });
    assert.deepEqual(board.totals.leads, { value: 2, previous: 1, change_pct: 100 });
    assert.deepEqual([board.totals.chats.value, board.totals.saves.value, board.totals.sales.value], [2, 1, 1]);
    assert.equal(board.totals.chats.change_pct, null, 'nothing before to compare with');
    assert.equal(board.series.at(-1).views, 12);
    assert.equal(board.series.at(-6).views, 3);
    assert.deepEqual(board.sales_value, [{ currency: 'NGN', amount: 24000000 }]);
    assert.equal(board.response_rate, 50);
    assert.deepEqual([board.listings.active, board.listings.drafts], [2, 1]);
    assert.deepEqual(
      board.top_listings.map(row => [row.title, row.views, row.leads]),
      [
        ['Hisense 50 inch TV', 15, 2],
        ['Samsung 43 inch TV', 4, 0],
      ],
    );
    assert.ok(!JSON.stringify(board).includes('LG 55'), 'never another seller’s listing');
    assert.ok(!JSON.stringify(board).includes('Ada'), 'never a buyer’s name');

    // The buyer's side: what they bought counts for them.
    assert.equal((await buyer.get('/v1/classifieds/me/dashboard')).json.purchases, 1);
    assert.equal((await buyer.get('/v1/classifieds/me/dashboard')).json.days, 30);
    assert.equal((await seller.get('/v1/classifieds/me/dashboard?days=14')).status, 400, 'only 7, 30 or 90 days');
    assert.equal((await storeServer().get('/v1/classifieds/me/dashboard')).status, 401);
  });

  test("the message board: Udozo's team posts for a market or every market; pinned first; on, off and dates", async () => {
    await prisma.classifiedBoardPost.deleteMany();
    const post = body => operations.post('/v1/admin/classifieds/board', body);
    const everyone = await post({ title: 'Welcome to Udozo', body: 'Post your first ad in a minute.\nIt is free.', href: '/sell', link_label: 'Post an ad' });
    assert.equal(everyone.status, 201, JSON.stringify(everyone.json));
    assert.deepEqual([everyone.json.object, everyone.json.country, everyone.json.tone, everyone.json.state, everyone.json.pinned], ['board_post', null, 'news', 'showing', false]);
    const nigeria = await post({ country: 'ng', title: 'UdozoPay in Lagos', body: 'Pay through Udozo and the seller is paid once you have it.', tone: 'tip', pinned: true });
    const ghana = await post({ country: 'GH', title: 'Akwaaba', body: 'Udozo is open in Ghana.' });
    const later = await post({ title: 'Coming soon', body: 'Something new.', starts_at: new Date(Date.now() + day).toISOString() });
    assert.equal(later.json.state, 'scheduled');
    const off = await post({ title: 'Hidden', body: 'Not yet.', enabled: false });
    assert.equal(off.json.state, 'off');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'board_post.created', targetId: nigeria.json.id } }));

    const seller = await customer('Bola Ade');
    const read = (await seller.get('/v1/classifieds/me/dashboard')).json.board;
    assert.deepEqual(
      read.map(item => item.title),
      ['UdozoPay in Lagos', 'Welcome to Udozo'],
      'their market and every market, pinned first; never another market’s, a scheduled or a switched-off post',
    );
    assert.deepEqual(Object.keys(read[1]).sort(), ['body', 'href', 'id', 'link_label', 'object', 'pinned', 'posted_at', 'title', 'tone']);
    assert.equal(read[1].body, 'Post your first ad in a minute.\nIt is free.');
    assert.ok(!read.some(item => item.id === ghana.json.id));

    await operations.patch(`/v1/admin/classifieds/board/${nigeria.json.id}`, { enabled: false });
    assert.deepEqual((await seller.get('/v1/classifieds/me/dashboard')).json.board.map(item => item.title), ['Welcome to Udozo']);
  });

  test('every field is checked, support only reads, and deleting is audited', async () => {
    const refused = async (body, param) => {
      const res = await operations.post('/v1/admin/classifieds/board', { title: 'A post', body: 'Words.', ...body });
      assert.equal(res.status, 400, JSON.stringify(res.json));
      assert.equal(res.json.error.param, param);
    };
    await refused({ title: '  ' }, 'title');
    await refused({ body: '' }, 'body');
    await refused({ body: 'x'.repeat(1001) }, 'body');
    await refused({ href: 'javascript:alert(1)' }, 'href');
    await refused({ href: '//evil.example.com' }, 'href');
    await refused({ country: 'ZZ' }, 'country');
    await refused({ tone: 'shout' }, 'tone');
    await refused({ starts_at: '2027-01-02T00:00:00Z', ends_at: '2027-01-01T00:00:00Z' }, 'ends_at');

    const made = await operations.post('/v1/admin/classifieds/board', { country: 'NG', title: 'Read me', body: 'Words.' });
    assert.ok((await support.get('/v1/admin/classifieds/board?country=NG')).json.data.some(item => item.id === made.json.id));
    assert.equal((await support.post('/v1/admin/classifieds/board', { title: 'x', body: 'y' })).status, 403);
    assert.equal((await support.patch(`/v1/admin/classifieds/board/${made.json.id}`, { pinned: true })).status, 403);
    assert.equal((await operations.delete(`/v1/admin/classifieds/board/${made.json.id}`)).json.deleted, true);
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'board_post.deleted', targetId: made.json.id } }));
    assert.equal((await client(server.base).get('/v1/admin/classifieds/board')).status, 401);
  });
});
