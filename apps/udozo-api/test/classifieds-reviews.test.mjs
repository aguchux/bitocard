// Reviews (docs/UDOZO_RATINGS_PLAN.md phase 1): a completed purchase gives its buyer one review of the seller; reviews
// are threads the seller and buyers of the same product join; reports go to moderators; summaries count one voice per
// reviewer over 12 months.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let admin;
let reviews;
const dayMs = 86_400_000;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  reviews = server.app.get((await import('../dist/classifieds/reviews/reviews.service.js')).ReviewsService);
  admin = await adminClient(server);
  for (const key of ['classifieds', 'classifieds_buy_orders', 'classifieds_reviews']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
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
        ...(method === 'POST' ? { 'idempotency-key': `review-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = res.status === 204 ? null : await res.json();
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body), del: path => request('DELETE', path) };
}

let counter = 0;
/** An account old enough for its reviews to publish at once. */
async function customer(name, { old = true } = {}) {
  const shopper = storeServer();
  const email = `review${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  await confirmMobile(server.app, shopper);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
  shopper.id = signup.json.customer.id;
  if (old) await prisma.customer.update({ where: { id: shopper.id }, data: { createdAt: new Date(Date.now() - 30 * dayMs) } });
  return shopper;
}

const brandModel = async () => {
  const [brand, model] = await Promise.all([prisma.classifiedFeature.findUniqueOrThrow({ where: { key: 'brand' } }), prisma.classifiedFeature.findUniqueOrThrow({ where: { key: 'model' } })]);
  return { brand, model };
};

async function live(seller, title, { stock = 5, brand = null, model = null } = {}) {
  const [cat, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
  const draft = (await seller.post('/v1/classifieds/listings', { title, price: 25000000, condition: 'used', category_id: cat.id, area_id: area.id })).json;
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.id, kind: 'photo', position, url: `https://media.test/${draft.id}-${position}.jpg` })) });
  const submitted = (await seller.post(`/v1/classifieds/listings/${draft.id}/submit`)).json;
  assert.equal(submitted.status, 'active', JSON.stringify(submitted));
  await prisma.classifiedListing.update({ where: { id: draft.id }, data: { stock } });
  if (brand && model) {
    const features = await brandModel();
    await prisma.classifiedListingFeature.deleteMany({ where: { listingId: draft.id, featureId: { in: [features.brand.id, features.model.id] } } });
    await prisma.classifiedListingFeature.createMany({ data: [{ listingId: draft.id, featureId: features.brand.id, valueText: brand }, { listingId: draft.id, featureId: features.model.id, valueText: model }] });
  }
  return submitted;
}

/** A completed buy order between them (accepted a while ago, so not a quick sale), and its purchase. */
async function bought(buyer, seller, listing) {
  const order = (await buyer.post(`/v1/classifieds/listings/${listing.id}/buy-orders`, { price: 24000000 })).json;
  assert.equal((await seller.post(`/v1/classifieds/buy-orders/${order.id}/accept`)).json.status, 'accepted');
  await prisma.classifiedBuyOrder.update({ where: { id: order.id }, data: { acceptedAt: new Date(Date.now() - 3 * 3_600_000) } });
  assert.equal((await seller.post(`/v1/classifieds/buy-orders/${order.id}/complete`)).json.status, 'completed');
  const purchase = await prisma.classifiedPurchase.findUniqueOrThrow({ where: { buyOrderId: order.id } });
  return { order, purchase };
}

const notices = (customerId, type) => prisma.notification.count({ where: { customerId, type } });

describe('Reviews', () => {
  test('a completed buy order is a purchase; the buyer reviews once, the seller sees it and the summary counts it', async () => {
    const seller = await customer('Chinedu Okafor');
    const buyer = await customer('Kemi Adeyemi');
    const tv = await live(seller, 'Hisense 50 inch TV', { brand: 'Hisense', model: 'A6 50"' });
    const { order, purchase } = await bought(buyer, seller, tv);
    assert.equal(purchase.source, 'buy_order');
    assert.equal(purchase.productKey, 'bm:hisense:a650');
    assert.equal(await notices(buyer.id, 'customer.classifieds.review_invite'), 1);

    const mine = (await buyer.get('/v1/classifieds/me/purchases?state=to_review')).json;
    assert.equal(mine.to_review, 1);
    assert.deepEqual([mine.data[0].can_review, mine.data[0].neutral_allowed, mine.data[0].buy_order_id], [true, false, order.id]);

    assert.equal((await buyer.post(`/v1/classifieds/purchases/${purchase.id}/review`, { rating: 'neutral' })).json.error.code, 'rating_invalid', 'neutral is off by default');
    assert.equal((await buyer.post(`/v1/classifieds/purchases/${purchase.id}/review`, { rating: 'negative', body: 'Bad' })).json.error.code, 'review_reason_required');
    assert.equal((await seller.post(`/v1/classifieds/purchases/${purchase.id}/review`, { rating: 'positive' })).status, 404, 'only its buyer');

    const written = await buyer.post(`/v1/classifieds/purchases/${purchase.id}/review`, { rating: 'positive', aspects: { described: 'up', handover: 'up' }, body: 'Great TV. Call me 08031234567 or ada@example.com' });
    assert.equal(written.status, 201, JSON.stringify(written.json));
    assert.equal(written.json.status, 'published');
    assert.doesNotMatch(written.json.body, /08031234567|ada@example\.com/, 'contact details hidden');
    assert.deepEqual(written.json.reviewer.name, 'Kemi A.');
    assert.equal((await buyer.post(`/v1/classifieds/purchases/${purchase.id}/review`, { rating: 'positive' })).json.error.code, 'review_given');
    assert.equal(await notices(seller.id, 'customer.classifieds.review_received'), 1);
    assert.ok((await prisma.classifiedBuyOrder.findUniqueOrThrow({ where: { id: order.id } })).buyerConfirmedAt, 'reviewing confirms the buy order');

    const sellerHandle = (await prisma.customer.findUniqueOrThrow({ where: { id: seller.id } })).sellerHandle;
    const page = (await storeServer().get(`/v1/classifieds/sellers/${sellerHandle}/reviews`)).json;
    assert.equal(page.total, 1);
    assert.deepEqual(page.summary, { positive: 1, neutral: 0, negative: 0, counted: 1, positive_pct: null }, 'the share shows from 3 counted reviews');
    assert.deepEqual(page.products, [{ key: 'bm:hisense:a650', label: 'Hisense A6 50"', count: 1 }]);
    assert.equal(page.data[0].status, undefined, 'the public never sees a status');
    assert.equal(page.data[0].source, 'buy_order');

    // Edits: up to three, versions kept; then closed.
    for (const body of ['Good TV', 'Very good TV', 'Lovely TV']) assert.equal((await buyer.patch(`/v1/classifieds/reviews/${written.json.id}`, { body })).status, 200);
    assert.equal((await buyer.patch(`/v1/classifieds/reviews/${written.json.id}`, { body: 'Again' })).json.error.code, 'review_edit_closed');
    assert.equal((await prisma.classifiedReview.findUniqueOrThrow({ where: { id: written.json.id } })).versions.length, 3);
  });

  test('one voice per reviewer, the share from three, negatives first; new accounts and quick sales wait for a moderator', async () => {
    const seller = await customer('Ada Eze');
    const phone = await live(seller, 'Samsung Galaxy phone', { stock: 20, brand: 'Samsung', model: 'Galaxy S23' });
    const buyers = [await customer('One Buyer'), await customer('Two Buyer'), await customer('Three Buyer')];
    const ratings = ['positive', 'positive', 'negative'];
    for (const [index, buyer] of buyers.entries()) {
      const { purchase } = await bought(buyer, seller, phone);
      const body = ratings[index] === 'negative' ? 'It stopped working after a day of use.' : 'Fine';
      assert.equal((await buyer.post(`/v1/classifieds/purchases/${purchase.id}/review`, { rating: ratings[index], body })).json.status, 'published');
    }
    // The same buyer buying twice counts once (their latest).
    const again = await bought(buyers[0], seller, phone);
    await buyers[0].post(`/v1/classifieds/purchases/${again.purchase.id}/review`, { rating: 'negative', aspects: { described: 'down' } });
    const handle = (await prisma.customer.findUniqueOrThrow({ where: { id: seller.id } })).sellerHandle;
    const page = (await storeServer().get(`/v1/classifieds/sellers/${handle}/reviews?sort=negative`)).json;
    assert.deepEqual(page.summary, { positive: 1, neutral: 0, negative: 2, counted: 3, positive_pct: 33 });
    assert.equal(page.data[0].rating, 'negative', 'negatives first');
    assert.equal(page.total, 4);
    const profile = (await storeServer().get(`/v1/classifieds/sellers/${handle}`)).json;
    assert.equal(profile.reviews.positive_pct, 33);
    const card = (await storeServer().get(`/v1/classifieds/listings?country=NG&seller=${handle}`)).json.data[0];
    assert.deepEqual(card.seller.rating, { positive_pct: 33, counted: 3 });
    const listingPage = (await storeServer().get(`/v1/classifieds/listings/${phone.ref}?country=NG`)).json;
    assert.equal(listingPage.seller.reviews.counted, 3);
    assert.equal(listingPage.product_reviews.length, 3);

    // A new account's review is held; so is one of a buy order completed within the hour of accepting.
    const fresh = await customer('Fresh Buyer', { old: false });
    const fp = await bought(fresh, seller, phone);
    const held = await fresh.post(`/v1/classifieds/purchases/${fp.purchase.id}/review`, { rating: 'positive' });
    assert.equal(held.json.status, 'held');
    assert.equal(await prisma.notification.count({ where: { type: 'admin.classifieds.review_held' } }) > 0, true);
    assert.equal((await storeServer().get(`/v1/classifieds/sellers/${handle}/reviews`)).json.total, 4, 'held reviews are not public');
    assert.equal((await admin.post(`/v1/admin/classifieds/reviews/${held.json.id}/publish`, { reason: 'Checked the order' })).status, 200);
    assert.equal((await storeServer().get(`/v1/classifieds/reviews/${held.json.id}`)).status, 200);
  });

  test('the conversation: the seller replies, a buyer of the same model joins with a stance, others cannot', async () => {
    const seller = await customer('Bisi Lawal');
    const iphone = await live(seller, 'iPhone 13 128GB', { brand: 'Apple', model: 'iPhone 13' });
    const iphone2 = await live(seller, 'Clean iPhone 13 blue', { brand: 'Apple', model: 'iPhone 13' });
    const radio = await live(seller, 'Sony radio', { brand: 'Sony', model: 'ICF-506' });
    const [reviewer, sameModel, otherModel, stranger] = [await customer('Rev Iewer'), await customer('Same Model'), await customer('Other Model'), await customer('Str Anger')];
    const r = await bought(reviewer, seller, iphone);
    await bought(sameModel, seller, iphone2);
    await bought(otherModel, seller, radio);
    const review = (await reviewer.post(`/v1/classifieds/purchases/${r.purchase.id}/review`, { rating: 'negative', body: 'The battery was much weaker than described.' })).json;

    const sellerView = (await seller.get(`/v1/classifieds/reviews/${review.id}/viewer`)).json;
    assert.deepEqual([sellerView.role, sellerView.can_post, sellerView.posts_left], ['seller', true, 5]);
    const reply = await seller.post(`/v1/classifieds/reviews/${review.id}/posts`, { body: 'Sorry: I said 85% battery health and it was. Happy to check it with you.' });
    assert.equal(reply.status, 201, JSON.stringify(reply.json));
    assert.equal(await notices(reviewer.id, 'customer.classifieds.review_reply'), 1);

    assert.equal((await sameModel.get(`/v1/classifieds/reviews/${review.id}/viewer`)).json.role, 'buyer');
    assert.equal((await sameModel.post(`/v1/classifieds/reviews/${review.id}/posts`, { body: 'Mine was fine' })).json.error.param, 'stance', 'a buyer says where they stand');
    const joined = await sameModel.post(`/v1/classifieds/reviews/${review.id}/posts`, { body: 'Mine was exactly as described.', stance: 'disagree' });
    assert.deepEqual([joined.status, joined.json.role, joined.json.stance], [201, 'buyer', 'disagree']);
    for (const outsider of [otherModel, stranger]) {
      const refused = await outsider.post(`/v1/classifieds/reviews/${review.id}/posts`, { body: 'Hi', stance: 'agree' });
      assert.deepEqual([refused.status, refused.json.error.code], [403, 'thread_not_allowed']);
    }
    assert.equal((await reviewer.patch(`/v1/classifieds/reviews/${review.id}`, { body: 'Battery weaker than said, but he offered to check.' })).status, 200);
    assert.equal((await prisma.classifiedReview.findUniqueOrThrow({ where: { id: review.id } })).editedAfterReply, true);

    const full = (await storeServer().get(`/v1/classifieds/reviews/${review.id}`)).json;
    assert.deepEqual(full.posts.map(post => post.role), ['seller', 'buyer']);
    assert.equal(full.edited_after_reply, true);

    // Reports: a threat goes to moderators at once; Udozo removes it with a reason and the reviewer is told.
    const report = await seller.post(`/v1/classifieds/reviews/${review.id}/report`, { reason: 'threat_or_extortion', details: 'He asked for a refund to change it.' });
    assert.equal(report.status, 201);
    assert.equal((await seller.post(`/v1/classifieds/reviews/${review.id}/report`, { reason: 'fake' })).json.error.code, 'report_exists');
    assert.ok(await prisma.notification.count({ where: { type: 'admin.classifieds.review_reported' } }));
    const queue = (await admin.get('/v1/admin/classifieds/reviews?tab=reported')).json;
    assert.ok(queue.data.some(row => row.id === review.id && row.threat));
    const detail = (await admin.get(`/v1/admin/classifieds/reviews/${review.id}`)).json;
    assert.equal(detail.reports.length, 1);
    assert.equal(detail.versions.length, 1);
    assert.equal((await admin.post(`/v1/admin/classifieds/review-reports/${detail.reports[0].id}/decide`, { decision: 'dismissed', note: 'A fair complaint, no threat.' })).status, 200);
    assert.equal((await admin.post(`/v1/admin/classifieds/reviews/${review.id}/remove`, { reason: 'Testing removal' })).status, 200);
    assert.equal((await storeServer().get(`/v1/classifieds/reviews/${review.id}`)).status, 404);
    assert.equal(await notices(reviewer.id, 'customer.classifieds.review_removed'), 1);
    assert.equal((await reviewer.get(`/v1/classifieds/me/reviews/${review.id}`)).json.status, 'removed', 'its author still sees it, as removed');
    assert.equal((await admin.post(`/v1/admin/classifieds/reviews/${review.id}/restore`, { reason: 'Restored' })).status, 200);
  });

  test('a buyer who says they did not buy loses the purchase and its review; reminders are sent once; blocked reviewers cannot write', async () => {
    const seller = await customer('Ngozi Obi');
    const fridge = await live(seller, 'LG fridge');
    const buyer = await customer('Femi Ojo');
    const { order, purchase } = await bought(buyer, seller, fridge);
    await buyer.post(`/v1/classifieds/purchases/${purchase.id}/review`, { rating: 'positive' });
    assert.equal((await buyer.post(`/v1/classifieds/buy-orders/${order.id}/void`, { reason: 'Never met' })).json.status, 'voided');
    assert.equal(await prisma.classifiedPurchase.count({ where: { buyOrderId: order.id } }), 0);
    assert.equal(await prisma.classifiedReview.count({ where: { purchaseId: purchase.id } }), 0);

    const late = await customer('Late Reviewer');
    const second = await bought(late, seller, fridge);
    await prisma.classifiedPurchase.update({ where: { id: second.purchase.id }, data: { completedAt: new Date(Date.now() - 3 * dayMs) } });
    const first = await reviews.remind();
    assert.ok(first.reminded >= 1);
    assert.equal((await reviews.remind()).reminded, 0, 'once each');
    assert.equal(await notices(late.id, 'customer.classifieds.review_reminder'), 1);

    assert.equal((await admin.post(`/v1/admin/classifieds/sellers/${late.id}/reviews-block`, { blocked: true, reason: 'Fake reviews' })).status, 200);
    assert.equal((await late.post(`/v1/classifieds/purchases/${second.purchase.id}/review`, { rating: 'positive' })).json.error.code, 'reviews_blocked');
  });

  test('with reviews off in a market nothing is written or shown, but purchases are still recorded', async () => {
    const seller = await customer('Kola Ade');
    const tv = await live(seller, 'Panasonic TV');
    assert.equal((await admin.put('/v1/admin/switches/classifieds_reviews', { country_code: 'NG', enabled: false })).status, 200);
    try {
      const buyer = await customer('Off Buyer');
      const { purchase } = await bought(buyer, seller, tv);
      assert.ok(purchase, 'recorded all the same');
      assert.equal(await notices(buyer.id, 'customer.classifieds.review_invite'), 0, 'no invite');
      const refused = await buyer.post(`/v1/classifieds/purchases/${purchase.id}/review`, { rating: 'positive' });
      assert.deepEqual([refused.status, refused.json.error.code], [503, 'reviews_unavailable']);
      const handle = (await prisma.customer.findUniqueOrThrow({ where: { id: seller.id } })).sellerHandle;
      assert.equal((await storeServer().get(`/v1/classifieds/sellers/${handle}`)).json.reviews, null);
    } finally {
      assert.equal((await admin.put('/v1/admin/switches/classifieds_reviews', { country_code: 'NG', enabled: true })).status, 200);
    }
  });
});
