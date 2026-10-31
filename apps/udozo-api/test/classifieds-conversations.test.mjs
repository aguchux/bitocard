// BitoCard Shop, phase 1 step 3: chats between buyers and sellers (masked text, private photos, blocking, reports read by
// moderators only once reported), price offers, Show phone with its hourly limit, leads, notices and unread emails.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, fakeService, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let admin;
let bucket;
let services;
const objects = new Map();

before(async () => {
  bucket = await fakeService(call => {
    const key = decodeURIComponent(new URL(call.url, 'http://x').pathname);
    if (call.method === 'PUT') {
      objects.set(key, { body: call.raw });
      return { status: 200, body: '' };
    }
    if (call.method === 'GET') return objects.has(key) ? { status: 200, headers: { 'content-type': 'application/octet-stream' }, body: objects.get(key).body } : { status: 404, body: '' };
    if (call.method === 'DELETE') {
      objects.delete(key);
      return { status: 204, body: '' };
    }
    return { status: 405, body: '' };
  });
  // BitoCard Shop is Udozo's (docs/UDOZO_SPINOFF_PLAN.md).
  server = await startApp({ env: { APP_PRODUCT: 'udozo', KYC_SPACES_KEY: 'kyc-key', KYC_SPACES_SECRET: 'kyc-secret', KYC_SPACES_BUCKET: 'kyc-private', KYC_SPACES_ENDPOINT: bucket.url } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  services = {
    conversations: server.app.get((await import('../dist/classifieds/conversations.service.js')).ConversationsService),
    email: server.app.get((await import('../dist/notifications/email.service.js')).EmailService),
  };
  admin = await adminClient(server);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
});

after(async () => {
  await server?.close();
  await bucket?.close();
});

function storeServer() {
  let token = null;
  const request = async (method, path, { body, form } = {}) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `shop-${Date.now()}-${Math.random()}` } : {}),
      },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), headers: res.headers };
    const json = await res.json();
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return {
    get: path => request('GET', path),
    post: (path, body = {}) => request('POST', path, { body }),
    upload: (path, form) => request('POST', path, { form }),
    patch: (path, body) => request('PATCH', path, { body }),
  };
}

let counter = 0;
async function customer(name = 'Kemi Adeyemi', { phone } = {}) {
  const shopper = storeServer();
  const email = `chat${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  await confirmMobile(server.app, shopper);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  // The BitoCard Shop terms, accepted before posting or Safe pay.
  await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
  shopper.id = signup.json.customer.id;
  shopper.email = email;
  if (phone) await prisma.customer.update({ where: { id: shopper.id }, data: { phone, phoneVerifiedAt: new Date() } });
  return shopper;
}

async function live(seller, title, { price = 25000000, contact = 'both' } = {}) {
  const [cat, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
  const draft = (await seller.post('/v1/classifieds/listings', { title, price, condition: 'used', category_id: cat.id, area_id: area.id, contact })).json;
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.id, kind: 'photo', position, url: `https://media.test/${draft.id}-${position}.jpg` })) });
  const submitted = (await seller.post(`/v1/classifieds/listings/${draft.id}/submit`)).json;
  assert.equal(submitted.status, 'active', JSON.stringify(submitted));
  return submitted;
}

/** A minimal JPEG carrying an EXIF block (which must never be stored). */
function jpeg(tag = 'GPSDATA-ABUJA') {
  const u16 = value => Buffer.from([value >> 8, value & 0xff]);
  const exif = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from(tag)]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), u16(exif.length + 2), exif]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x30, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, sos, Buffer.from(`pixels-${Math.random()}`), Buffer.from([0xff, 0xd9])]);
}

const notices = (customerId, type) => prisma.notification.count({ where: { customerId, type } });

describe('chats', () => {
  test('a buyer opens a chat with a safety note; links and card numbers are masked; unread, read and polling work', async () => {
    const seller = await customer('Chinedu Okafor');
    const buyer = await customer('Kemi Adeyemi');
    const tv = await live(seller, 'Hisense 50 inch TV');

    const own = await seller.post('/v1/classifieds/conversations', { listing_id: tv.id, body: 'Hello' });
    assert.equal(own.json.error.param, 'listing_id', 'not on your own listing');

    const started = await buyer.post('/v1/classifieds/conversations', { listing_id: tv.id, body: 'Is it available? Pay to 4111 1111 1111 1111 or see https://bit.ly/x and evil-pay.com/login, mail me at kemi@gmail.com' });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    const chat = started.json;
    assert.equal(chat.role, 'buyer');
    assert.equal(chat.with.name, 'Chinedu O.', 'never a full name');
    assert.deepEqual(chat.messages.map(message => message.from), ['bitocard', 'me']);
    assert.match(chat.messages[0].body, /never pay in advance/);
    const body = chat.messages[1].body;
    assert.doesNotMatch(body, /4111/);
    assert.doesNotMatch(body, /bit\.ly|evil-pay/);
    assert.match(body, /\[link hidden\].*\[link hidden\]/);
    assert.match(body, /kemi@gmail\.com/, 'email addresses are left alone');

    const again = await buyer.post('/v1/classifieds/conversations', { listing_id: tv.id, body: 'Hello again' });
    assert.equal(again.json.id, chat.id, 'one chat per listing and buyer');

    const selling = await seller.get('/v1/classifieds/conversations?role=selling');
    assert.equal(selling.json.total, 1);
    assert.equal(selling.json.data[0].unread, 2);
    assert.equal(selling.json.data[0].with.name, 'Kemi A.');
    assert.equal((await seller.get('/v1/classifieds/conversations/unread')).json.unread, 2);
    assert.equal((await buyer.get('/v1/classifieds/conversations?role=selling')).json.total, 0);
    assert.equal(await notices(seller.id, 'customer.classifieds.message'), 1, 'one notice per chat every 10 minutes');

    const read = await seller.get(`/v1/classifieds/conversations/${chat.id}`);
    assert.equal(read.json.messages.length, 3);
    assert.equal((await seller.get('/v1/classifieds/conversations/unread')).json.unread, 0, 'reading marks the chat read');

    const reply = await seller.post(`/v1/classifieds/conversations/${chat.id}/messages`, { body: 'Yes, still here. Come and see it in Gwarinpa.' });
    assert.equal(reply.json.from, 'me');
    const polled = await buyer.get(`/v1/classifieds/conversations/${chat.id}?after=${read.json.messages.at(-1).id}`);
    assert.deepEqual(polled.json.messages.map(message => message.body), ['Yes, still here. Come and see it in Gwarinpa.']);
    assert.equal(polled.json.messages[0].from, 'them');
    assert.ok((await prisma.classifiedConversation.findUniqueOrThrow({ where: { id: chat.id } })).sellerRepliedAt, 'the reply counts towards the response rate');

    const older = await buyer.get(`/v1/classifieds/conversations/${chat.id}?before=${read.json.messages[1].id}`);
    assert.deepEqual(older.json.messages.map(message => message.from), ['bitocard']);
    assert.equal((await storeServer().get(`/v1/classifieds/conversations/${chat.id}`)).status, 401);
    const stranger = await customer('Tunde Bakare');
    assert.equal((await stranger.get(`/v1/classifieds/conversations/${chat.id}`)).status, 404, 'only the two sides read a chat');
  });

  test('photos are checked, stripped, sealed and read back by the two sides only', async () => {
    const seller = await customer('Ada Eze');
    const buyer = await customer('Musa Bello');
    const tv = await live(seller, 'LG 43 inch smart TV');
    const chat = (await buyer.post('/v1/classifieds/conversations', { listing_id: tv.id, body: 'Can I see the back?' })).json;

    const form = new FormData();
    form.append('file', new Blob([jpeg()], { type: 'image/jpeg' }), 'back.jpg');
    form.append('caption', 'Here it is');
    const sent = await seller.upload(`/v1/classifieds/conversations/${chat.id}/photos`, form);
    assert.equal(sent.status, 201, JSON.stringify(sent.json));
    assert.equal(sent.json.kind, 'photo');
    assert.equal(sent.json.body, 'Here it is');
    const stored = [...objects.entries()].find(([key]) => key.includes(`/shop-chat/${chat.id}/`));
    assert.ok(stored, 'kept in the private bucket under the chat');
    assert.ok(!stored[1].body.includes(Buffer.from('GPSDATA')), 'sealed, and its metadata never stored');

    const photo = await buyer.get(sent.json.photo.url.replace('/v1', '/v1'));
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get('content-type'), 'image/jpeg');
    assert.equal(photo.headers.get('cache-control'), 'no-store, private');
    assert.ok(!photo.bytes.includes(Buffer.from('GPSDATA')));
    const stranger = await customer('Femi Ade');
    assert.equal((await stranger.get(sent.json.photo.url)).status, 404);

    const pdf = new FormData();
    pdf.append('file', new Blob([Buffer.from('%PDF-1.7\n%%EOF')], { type: 'application/pdf' }), 'doc.pdf');
    assert.equal((await buyer.upload(`/v1/classifieds/conversations/${chat.id}/photos`, pdf)).json.error.code, 'file_invalid', 'photos only');
  });

  test('blocking stops both sides writing until unblocked; phone-only listings take no chats', async () => {
    const seller = await customer('Bisi Ola', { phone: '+2348031110001' });
    const buyer = await customer('Yemi Ade');
    const tv = await live(seller, 'Samsung 32 inch TV');
    const chat = (await buyer.post('/v1/classifieds/conversations', { listing_id: tv.id, body: 'Last price?' })).json;

    const blocked = await seller.post(`/v1/classifieds/conversations/${chat.id}/block`);
    assert.deepEqual(blocked.json.blocked, { by_me: true, by_them: false });
    assert.equal((await buyer.post(`/v1/classifieds/conversations/${chat.id}/messages`, { body: 'Hello?' })).json.error.code, 'conversation_blocked');
    assert.match((await seller.post(`/v1/classifieds/conversations/${chat.id}/messages`, { body: 'x' })).json.error.message, /Unblock/);
    await seller.post(`/v1/classifieds/conversations/${chat.id}/unblock`);
    assert.equal((await buyer.post(`/v1/classifieds/conversations/${chat.id}/messages`, { body: 'Hello?' })).status, 201);

    const callOnly = await live(seller, 'Sony 40 inch TV', { contact: 'phone' });
    assert.equal((await buyer.post('/v1/classifieds/conversations', { listing_id: callOnly.id, body: 'Hi' })).json.error.code, 'chat_not_offered');
  });

  test('a reported chat is read by moderators, audited; unreported chats stay private', async () => {
    const seller = await customer('Gbenga Lawal');
    const buyer = await customer('Ifeoma Nwosu');
    const tv = await live(seller, 'Toshiba 55 inch TV');
    const chat = (await buyer.post('/v1/classifieds/conversations', { listing_id: tv.id, body: 'Is it new?' })).json;
    await seller.post(`/v1/classifieds/conversations/${chat.id}/messages`, { body: 'Pay a delivery fee first' });

    assert.equal((await admin.get(`/v1/admin/classifieds/conversations/${chat.id}`)).json.error.code, 'conversation_not_reported');
    const report = await buyer.post(`/v1/classifieds/conversations/${chat.id}/report`, { reason: 'scam', details: 'Asked for a fee up front' });
    assert.equal(report.status, 201);
    assert.equal((await buyer.post(`/v1/classifieds/conversations/${chat.id}/report`, { reason: 'scam' })).json.error.code, 'already_reported');

    const reports = await admin.get('/v1/admin/classifieds/reports');
    const row = reports.json.data.find(item => item.id === report.json.id);
    assert.equal(row.conversation_id, chat.id);
    assert.equal(row.reported_customer_id, seller.id);

    const review = await admin.get(`/v1/admin/classifieds/conversations/${chat.id}`);
    assert.equal(review.status, 200);
    assert.deepEqual(review.json.messages.map(message => message.from), ['bitocard', 'buyer', 'seller']);
    assert.equal(review.json.seller.email, seller.email);
    assert.equal(review.json.reports[0].by, 'buyer');
    assert.equal(await prisma.auditLog.count({ where: { action: 'classifieds.conversation_viewed', targetId: chat.id } }), 1);
  });
});

describe('offers', () => {
  test('either side offers; the other accepts or declines; a new offer replaces the open one; offers expire', async () => {
    const seller = await customer('Emeka Obi');
    const buyer = await customer('Halima Yusuf');
    const tv = await live(seller, 'Panasonic 50 inch TV', { price: 30000000 });
    const chat = (await buyer.post('/v1/classifieds/conversations', { listing_id: tv.id, body: 'Would you take less?' })).json;

    const first = await buyer.post(`/v1/classifieds/conversations/${chat.id}/offers`, { price: 25000000 });
    assert.equal(first.status, 201, JSON.stringify(first.json));
    assert.deepEqual([first.json.status, first.json.made_by, first.json.price.amount], ['open', 'me', 25000000]);
    assert.equal(await notices(seller.id, 'customer.classifieds.offer'), 1);
    assert.equal((await buyer.post(`/v1/classifieds/offers/${first.json.id}/accept`)).json.error.code, 'offer_not_yours');

    const counter = await seller.post(`/v1/classifieds/conversations/${chat.id}/offers`, { price: 28000000 });
    assert.equal((await prisma.classifiedOffer.findUniqueOrThrow({ where: { id: first.json.id } })).status, 'replaced');
    const listed = await buyer.get(`/v1/classifieds/conversations/${chat.id}`);
    assert.equal(listed.json.open_offer.id, counter.json.id);
    assert.equal(listed.json.open_offer.made_by, 'them');
    assert.match(listed.json.messages.find(message => message.kind === 'offer' && message.offer.id === counter.json.id).body, /₦280,000/);

    const accepted = await buyer.post(`/v1/classifieds/offers/${counter.json.id}/accept`);
    assert.equal(accepted.json.status, 'accepted');
    assert.equal(await notices(seller.id, 'customer.classifieds.offer_accepted'), 1);
    assert.equal((await buyer.post(`/v1/classifieds/offers/${counter.json.id}/decline`)).json.error.code, 'offer_closed');
    const after = await seller.get(`/v1/classifieds/conversations/${chat.id}`);
    assert.match(after.json.messages.at(-1).body, /Halima Y\. accepted the offer of ₦280,000/);
    assert.equal(after.json.open_offer, null);

    const declined = await buyer.post(`/v1/classifieds/conversations/${chat.id}/offers`, { price: 27000000 });
    assert.equal((await seller.post(`/v1/classifieds/offers/${declined.json.id}/decline`)).json.status, 'declined');
    assert.equal(await notices(buyer.id, 'customer.classifieds.offer_declined'), 1);

    const withdrawn = await buyer.post(`/v1/classifieds/conversations/${chat.id}/offers`, { price: 27500000 });
    assert.equal((await seller.post(`/v1/classifieds/offers/${withdrawn.json.id}/withdraw`)).json.error.code, 'offer_not_yours');
    assert.equal((await buyer.post(`/v1/classifieds/offers/${withdrawn.json.id}/withdraw`)).json.status, 'withdrawn');

    const late = await buyer.post(`/v1/classifieds/conversations/${chat.id}/offers`, { price: 26000000 });
    await prisma.classifiedOffer.update({ where: { id: late.json.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await seller.post(`/v1/classifieds/offers/${late.json.id}/accept`)).json.error.code, 'offer_closed');
    assert.ok((await services.conversations.expireOffers()).expired >= 1);
    assert.equal((await prisma.classifiedOffer.findUniqueOrThrow({ where: { id: late.json.id } })).status, 'expired');

    assert.equal((await buyer.post(`/v1/classifieds/conversations/${chat.id}/offers`, { price: 0 })).status, 400);
    await seller.post(`/v1/classifieds/listings/${tv.id}/sold`);
    assert.equal((await buyer.post(`/v1/classifieds/conversations/${chat.id}/offers`, { price: 20000000 })).json.error.code, 'listing_unavailable');
  });
});

describe('Show phone and leads', () => {
  test('the seller\'s confirmed number, a few new listings an hour, each buyer one lead', async () => {
    const sellers = [await customer('Kunle Ade', { phone: '+2348031110002' }), await customer('Sade Ojo', { phone: '+2348031110003' }), await customer('Obi Nnamdi', { phone: '+2348031110004' })];
    const buyer = await customer('Zainab Musa');
    const listings = [];
    for (const [index, seller] of sellers.entries()) for (const n of [1, 2]) listings.push(await live(seller, `Hisense ${40 + index * 2 + n} inch TV`));

    const shown = await buyer.post(`/v1/classifieds/listings/${listings[0].id}/phone`);
    assert.deepEqual([shown.status, shown.json.phone, shown.json.first_time], [200, '+2348031110002', true]);
    assert.equal((await buyer.post(`/v1/classifieds/listings/${listings[0].id}/phone`)).json.first_time, false, 'showing it again is free');
    await buyer.post('/v1/classifieds/conversations', { listing_id: listings[0].id, body: 'I just called you' });
    const stats = await sellers[0].get(`/v1/classifieds/me/listings/${listings[0].id}/stats`);
    assert.deepEqual([stats.json.leads, stats.json.phone_reveals, stats.json.chats], [1, 1, 1], 'one buyer, one lead');
    assert.equal((await buyer.get(`/v1/classifieds/me/listings/${listings[0].id}/stats`)).status, 404, 'sellers only');

    for (const listing of listings.slice(1, 5)) assert.equal((await buyer.post(`/v1/classifieds/listings/${listing.id}/phone`)).status, 200);
    const limited = await buyer.post(`/v1/classifieds/listings/${listings[5].id}/phone`);
    assert.deepEqual([limited.status, limited.json.error.code], [429, 'phone_reveal_limit']);
    assert.equal((await buyer.post(`/v1/classifieds/listings/${listings[1].id}/phone`)).status, 200, 'one already shown still shows');

    assert.equal((await sellers[0].post(`/v1/classifieds/listings/${listings[0].id}/phone`)).json.error.param, 'listing_id');
    const noPhone = await customer('Lola Ige');
    const chatOnly = await live(noPhone, 'Haier 32 inch TV');
    // Udozo's customers confirm a number at sign-up; one whose market cannot text (or an older account) has none.
    await prisma.customer.update({ where: { id: noPhone.id }, data: { phone: null, phoneVerifiedAt: null } });
    assert.equal((await (await customer('Uche Eze')).post(`/v1/classifieds/listings/${chatOnly.id}/phone`)).json.error.code, 'phone_not_offered', 'no confirmed number, no phone');
    assert.equal((await storeServer().post(`/v1/classifieds/listings/${listings[0].id}/phone`)).status, 401, 'signed in only');
  });

  test('response rate shows once a seller has had five chats', async () => {
    const seller = await customer('Rita Okon');
    const tv = await live(seller, 'Philips 50 inch TV');
    const page = async () => (await storeServer().get(`/v1/classifieds/listings/${tv.ref}?country=NG`)).json.seller.response_rate;
    assert.equal(await page(), null);
    const old = new Date(Date.now() - 2 * 86_400_000);
    for (let n = 0; n < 5; n += 1) {
      const buyer = await customer(`Buyer ${n}`);
      const chat = (await buyer.post('/v1/classifieds/conversations', { listing_id: tv.id, body: 'Available?' })).json;
      await prisma.classifiedConversation.update({ where: { id: chat.id }, data: { createdAt: old, sellerRepliedAt: n < 4 ? old : null } });
    }
    assert.equal(await page(), 80);
  });
});

describe('unread emails', () => {
  test('messages left unread 10 minutes are emailed once per batch', async () => {
    const seller = await customer('Dayo Ogun');
    const buyer = await customer('Ngozi Eke');
    const tv = await live(seller, 'TCL 65 inch TV');
    const chat = (await buyer.post('/v1/classifieds/conversations', { listing_id: tv.id, body: 'Still available?' })).json;
    const sent = () => services.email.outbox.filter(item => item.to === seller.email && /new message on Udozo/.test(item.subject)).length;

    await services.conversations.emailUnread();
    assert.equal(sent(), 0, 'not before 10 minutes');
    await prisma.classifiedMessage.updateMany({ where: { conversationId: chat.id }, data: { createdAt: new Date(Date.now() - 11 * 60_000) } });
    await services.conversations.emailUnread();
    assert.equal(sent(), 1);
    const email = services.email.outbox.findLast(item => item.to === seller.email);
    assert.match(email.text, /Ngozi E\. about "TCL 65 inch TV": 1 new/);
    assert.doesNotMatch(email.text, /Still available/, 'never the message itself');
    await services.conversations.emailUnread();
    assert.equal(sent(), 1, 'once per batch');
  });
});
