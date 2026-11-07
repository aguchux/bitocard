// Udozo on WhatsApp (docs/UDOZO_WHATSAPP_PLAN.md): Meta's webhook (the address check, signatures, each body stored once),
// numbers linked by themselves or with a code, STOP and START, the menu, finding listings, chats relayed both ways (the
// window and its template), selling step by step, wanted requests and the admin page. Meta is a local fake.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, fakeService, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let admin;
let bucket;
let graph;
let notices;
let services;
const objects = new Map();
const appSecret = 'meta-app-secret';
let outCounter = 0;
const templates = [];

/** A JPEG of the given size, different every call (photos are kept once by their bytes). */
function jpeg({ width = 1600, height = 1200 } = {}) {
  const u16 = value => Buffer.from([value >> 8, value & 0xff]);
  const sof = Buffer.concat([Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]), u16(height), u16(width), Buffer.from([0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00])]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, sos, Buffer.from(`pixels-${Math.random()}`), Buffer.from([0xff, 0xd9])]);
}

before(async () => {
  bucket = await fakeService(call => {
    const key = decodeURIComponent(new URL(call.url, 'http://x').pathname);
    if (call.method === 'PUT') {
      objects.set(key, call.raw);
      return { status: 200, body: '' };
    }
    if (call.method === 'GET') return objects.has(key) ? { status: 200, headers: { 'content-type': 'application/octet-stream' }, body: objects.get(key) } : { status: 404, body: '' };
    if (call.method === 'DELETE') {
      objects.delete(key);
      return { status: 204, body: '' };
    }
    return { status: 405, body: '' };
  });
  graph = await fakeService(call => {
    const path = new URL(call.url, 'http://x').pathname;
    if (call.headers.authorization !== 'Bearer meta-token') return { status: 401, body: { error: { message: 'Invalid OAuth access token', code: 190 } } };
    if (call.method === 'POST' && path === '/PNID/messages') {
      if (call.body?.status === 'read') return { body: { success: true } };
      return { body: { messages: [{ id: `wamid.out.${(outCounter += 1)}` }] } };
    }
    if (call.method === 'POST' && path === '/PNID/media') return { body: { id: `media-up-${(outCounter += 1)}` } };
    if (call.method === 'GET' && path === '/PNID') return { body: { verified_name: 'Udozo', display_phone_number: '+234 800 000 0000', quality_rating: 'GREEN' } };
    if (call.method === 'GET' && path === '/WABA/message_templates') return { body: { data: templates } };
    if (call.method === 'POST' && path === '/WABA/message_templates') {
      templates.push({ name: call.body.name, status: 'PENDING', language: call.body.language, category: call.body.category });
      return { body: { id: `tpl-${templates.length}`, status: 'PENDING' } };
    }
    if (call.method === 'GET' && path.startsWith('/download/')) return { status: 200, headers: { 'content-type': 'image/jpeg' }, body: jpeg() };
    if (call.method === 'GET' && /^\/[\w.-]+$/.test(path)) return { body: { url: `${graph.url}/download${path}`, mime_type: 'image/jpeg', file_size: 2000 } };
    return { status: 404, body: { error: { message: 'unknown', code: 100 } } };
  });
  server = await startApp({
    env: {
      APP_PRODUCT: 'udozo',
      CRON_SECRET: 'cron-secret',
      SPACES_KEY: 'spaces-key', SPACES_SECRET: 'spaces-secret', SPACES_BUCKET: 'udozo-media', SPACES_ENDPOINT: bucket.url, SPACES_PUBLIC_URL: 'https://media.udozo.test', SPACES_ROOT: 'test',
      KYC_SPACES_KEY: 'kyc-key', KYC_SPACES_SECRET: 'kyc-secret', KYC_SPACES_BUCKET: 'kyc-private', KYC_SPACES_ENDPOINT: bucket.url,
      WHATSAPP_PHONE_NUMBER_ID: 'PNID', WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA', WHATSAPP_NUMBER: '+2348000000000', WHATSAPP_ACCESS_TOKEN: 'meta-token',
      WHATSAPP_APP_SECRET: appSecret, WHATSAPP_VERIFY_TOKEN: 'verify-me-please', WHATSAPP_API_URL: graph.url,
    },
  });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  notices = server.app.get((await import('../dist/whatsapp/notices.service.js')).WhatsappNotices);
  services = { outbox: server.app.get((await import('../dist/whatsapp/outbox.service.js')).WhatsappOutbox) };
  admin = await adminClient(server);
  for (const key of ['classifieds', 'whatsapp_channel', 'classifieds_wanted']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200, key);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
});

after(async () => {
  await server?.close();
  await bucket?.close();
  await graph?.close();
});

function storeServer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: { ...(token ? { 'bitocard-customer-session': token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method === 'POST' ? { 'idempotency-key': `wa-${Date.now()}-${Math.random()}` } : {}) },
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
async function customer(name) {
  const shopper = storeServer();
  const email = `wa${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, shopper);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
  shopper.id = signup.json.customer.id;
  const row = await prisma.customer.findUniqueOrThrow({ where: { id: shopper.id } });
  // Their WhatsApp is their mobile (confirmed here for every test customer, so they link by themselves).
  if (!row.phoneVerifiedAt) await prisma.customer.update({ where: { id: shopper.id }, data: { phoneVerifiedAt: new Date() } });
  shopper.waId = row.phone.replace(/\D/g, '');
  return shopper;
}

async function live(seller, title) {
  const [cat, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
  const draft = (await seller.post('/v1/classifieds/listings', { title, price: 25000000, condition: 'used', category_id: cat.id, area_id: area.id, contact: 'both', stock: 1 })).json;
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.id, kind: 'photo', position, url: `https://media.udozo.test/${draft.id}-${position}.jpg` })) });
  const submitted = (await seller.post(`/v1/classifieds/listings/${draft.id}/submit`)).json;
  assert.equal(submitted.status, 'active', JSON.stringify(submitted));
  return submitted;
}

let inCounter = 0;
/** What Meta posts when `from` writes to Udozo's number. */
function metaBody(from, message, name = 'Tester') {
  inCounter += 1;
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'PNID' }, contacts: [{ wa_id: from, profile: { name } }], messages: [{ from, id: `wamid.in.${inCounter}.${Math.random()}`, timestamp: String(Math.floor(Date.now() / 1000)), ...message }] } }] }],
  };
}

async function post(body, signature) {
  const raw = JSON.stringify(body);
  return fetch(`${server.base}/v1/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature ?? `sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}` }, body: raw });
}

/** `from` sends something; what Udozo answered (the messages sent to them since). */
async function say(from, message) {
  const start = graph.calls.length;
  const res = await post(metaBody(from, message));
  assert.equal(res.status, 200);
  await notices.idle();
  return graph.calls.slice(start).filter(call => call.url.endsWith('/PNID/messages') && call.body?.to === from && !call.body.status).map(call => call.body);
}
const text = body => ({ type: 'text', text: { body } });
const tap = (id, title = 'x') => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title } } });
const replyTo = (body, wamid) => ({ type: 'text', text: { body }, context: { id: wamid } });
const bodies = replies => replies.map(reply => reply.text?.body ?? reply.interactive?.body?.text ?? reply.image?.caption ?? reply.template?.name ?? '');
const rowIds = reply => reply.interactive?.action?.sections?.[0]?.rows?.map(row => row.id) ?? reply.interactive?.action?.buttons?.map(button => button.reply.id) ?? [];
const sentTo = (waId, since) => graph.calls.slice(since).filter(call => call.url.endsWith('/PNID/messages') && call.body?.to === waId && !call.body.status).map(call => call.body);

describe('the webhook', () => {
  test("Meta's address check takes the verify token; bodies need the app secret's signature and are stored once", async () => {
    const ok = await fetch(`${server.base}/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me-please&hub.challenge=1158201444`);
    assert.deepEqual([ok.status, await ok.text()], [200, '1158201444']);
    const wrong = await fetch(`${server.base}/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`);
    assert.equal(wrong.status, 403);

    const body = metaBody('2348011112222', text('hello'));
    assert.equal((await post(body, 'sha256=00')).status, 401, 'a wrong signature is refused');
    assert.equal((await post(body)).status, 200);
    assert.equal((await post(body)).status, 200, "Meta's retry of the same body");
    await notices.idle();
    const stored = await prisma.whatsappNotice.findMany({ where: {} });
    assert.equal(stored.filter(row => row.status === 'processed').length >= 1, true);
    assert.equal(await prisma.whatsappMessage.count({ where: { wamid: body.entry[0].changes[0].value.messages[0].id } }), 1, 'each message handled once');
    assert.doesNotMatch(stored[0].bodyEncrypted, /hello/, 'kept encrypted');
  });
});

describe('numbers, the menu, STOP and START', () => {
  test('a stranger gets the menu; STOP stops everything until START', async () => {
    const waId = '2348022223333';
    const menu = await say(waId, text('Hi'));
    assert.equal(menu.length, 1);
    assert.deepEqual(rowIds(menu[0]), ['menu:find', 'menu:want', 'menu:sell', 'menu:chats', 'menu:help']);
    assert.match(bodies(await say(waId, text('STOP')))[0], /no more messages/);
    assert.deepEqual(await say(waId, text('hello?')), [], 'nothing while opted out');
    const back = await say(waId, text('start'));
    assert.match(bodies(back)[0], /Welcome back/);
    // Selling needs an account: a number never makes one.
    assert.match(bodies(await say(waId, tap('menu:sell')))[0], /connect your Udozo account first/);
  });

  test("a customer's confirmed mobile links by itself; another number links with the code from udozo.com", async () => {
    const kemi = await customer('Kemi Adeyemi');
    await say(kemi.waId, text('hello'));
    const contact = await prisma.whatsappContact.findUniqueOrThrow({ where: { waId: kemi.waId } });
    assert.equal(contact.customerId, kemi.id);

    const channels = await (await fetch(`${server.base}/v1/classifieds/channels?country=ng`)).json();
    assert.deepEqual([channels.whatsapp, channels.wanted], [{ available: true, number: '+2348000000000' }, true]);
    const status = await kemi.get('/v1/store/account/whatsapp');
    assert.deepEqual([status.json.available, status.json.connected, status.json.number], [true, true, '+2348000000000']);

    const other = '2348033334444';
    const link = await kemi.post('/v1/store/account/whatsapp/link');
    assert.equal(link.status, 200, JSON.stringify(link.json));
    assert.match(link.json.link, /^https:\/\/wa\.me\/2348000000000\?text=LINK%20[A-Z0-9]{8}$/);
    assert.match(bodies(await say(other, text(`LINK ${link.json.code}`)))[0], /now connected to your Udozo account, Kemi/);
    assert.equal((await prisma.whatsappContact.findUniqueOrThrow({ where: { waId: other } })).customerId, kemi.id);
    assert.equal((await prisma.whatsappContact.findUniqueOrThrow({ where: { waId: kemi.waId } })).customerId, null, 'the account keeps one number');
    assert.match(bodies(await say('2348044445555', text(`link ${link.json.code}`)))[0], /did not work/, 'a code works once');

    assert.equal((await kemi.patch('/v1/store/account/whatsapp', { chats: false })).json.chats, false);
    assert.equal((await kemi.delete('/v1/store/account/whatsapp')).json.connected, false);
  });
});

describe('finding and chatting', () => {
  test('words find listings; a listing opens with its photo; the chat is relayed both ways, outside the window by template', async () => {
    const seller = await customer('Chinedu Okafor');
    const buyer = await customer('Amaka Eze');
    const tv = await live(seller, 'Hisense 50 inch smart TV');
    await say(seller.waId, text('hi'));

    const results = await say(buyer.waId, text('hisense'));
    assert.ok(rowIds(results.at(-1)).includes(`l:${tv.ref}`), JSON.stringify(results));
    const card = await say(buyer.waId, tap(`l:${tv.ref}`));
    assert.equal(card[0].type, 'image');
    assert.match(card[0].image.caption, /Hisense 50 inch smart TV[\s\S]*₦250,000[\s\S]*Chinedu O\./);
    assert.deepEqual(rowIds(card[1]), [`chat:${tv.id}`, `cb:${tv.id}`, `more:${tv.id}`]);

    assert.match(bodies(await say(buyer.waId, tap(`chat:${tv.id}`)))[0], /Write your message to the seller/);
    const since = graph.calls.length;
    assert.match(bodies(await say(buyer.waId, text('Is it still available?')))[0], /Sent to Chinedu O\./);
    await services.outbox.idle();
    const chat = await prisma.classifiedConversation.findUniqueOrThrow({ where: { listingId_buyerId: { listingId: tv.id, buyerId: buyer.id } }, include: { messages: { orderBy: { seq: 'asc' } } } });
    assert.deepEqual(chat.messages.map(message => [message.kind, message.channel]).slice(-1), [['text', 'whatsapp']]);
    const forwarded = sentTo(seller.waId, since);
    assert.equal(forwarded.length, 1);
    assert.equal(forwarded[0].text.body, '*Hisense 50 inch smart TV*\nAmaka E.: Is it still available?', 'never a number');
    const forwardedRow = await prisma.whatsappMessage.findFirstOrThrow({ where: { conversationId: chat.id, direction: 'out', contact: { waId: seller.waId } } });

    // The seller replies to it on WhatsApp: it goes into that chat, and to the buyer.
    const before = graph.calls.length;
    await say(seller.waId, replyTo('Yes, come and see it', forwardedRow.wamid));
    await services.outbox.idle();
    const last = await prisma.classifiedMessage.findFirstOrThrow({ where: { conversationId: chat.id }, orderBy: { seq: 'desc' } });
    assert.deepEqual([last.senderId, last.body, last.channel], [seller.id, 'Yes, come and see it', 'whatsapp']);
    assert.equal(sentTo(buyer.waId, before).at(-1).text.body, '*Hisense 50 inch smart TV*\nChinedu O.: Yes, come and see it');

    // Written on udozo.com, outside the buyer's 24 hours: the template goes instead, once an hour per chat.
    await prisma.whatsappContact.update({ where: { waId: buyer.waId }, data: { lastInboundAt: new Date(Date.now() - 25 * 3600_000) } });
    const web = graph.calls.length;
    assert.equal((await seller.post(`/v1/classifieds/conversations/${chat.id}/messages`, { body: 'Are you coming today?' })).status, 201);
    assert.equal((await seller.post(`/v1/classifieds/conversations/${chat.id}/messages`, { body: 'Hello?' })).status, 201);
    await services.outbox.idle();
    const outside = sentTo(buyer.waId, web);
    assert.equal(outside.length, 1, 'one template an hour');
    assert.deepEqual([outside[0].type, outside[0].template.name, outside[0].template.components[0].parameters.map(item => item.text)], ['template', 'udozo_new_message', ['Chinedu O.', 'Hisense 50 inch smart TV']]);
    assert.equal(outside[0].template.components[1].parameters[0].payload, `open:conv:${chat.id}`);

    // Tapping Read it opens the chat with its latest messages.
    const opened = await say(buyer.waId, { type: 'button', button: { payload: `open:conv:${chat.id}`, text: 'Read it' } });
    assert.match(bodies(opened)[0], /Chinedu O\.: Are you coming today\?\nChinedu O\.: Hello\?/);

    // A photo from WhatsApp goes into the chat, and on to the other side uploaded from the private bucket.
    const photoAt = graph.calls.length;
    await say(buyer.waId, { type: 'image', image: { id: 'buyer-photo-1', mime_type: 'image/jpeg' } });
    await services.outbox.idle();
    assert.equal((await prisma.classifiedMessage.findFirstOrThrow({ where: { conversationId: chat.id }, orderBy: { seq: 'desc' } })).kind, 'photo');
    const photo = sentTo(seller.waId, photoAt).at(-1);
    assert.equal(photo.type, 'image');
    assert.match(photo.image.id, /^media-up-/, 'never a public link');
  });
});

describe('selling step by step', () => {
  test('SELL makes a draft and posts it through the listing rules', async () => {
    const seller = await customer('Bola Ade');
    const tvs = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } });
    assert.match(bodies(await say(seller.waId, text('SELL'))).join('\n'), /Write a short title/);
    const asked = await say(seller.waId, text('Samsung 43 inch TV, like new'));
    assert.ok(rowIds(asked[0]).some(id => id.startsWith('sell:top:')));
    const draft = await prisma.classifiedListing.findFirstOrThrow({ where: { customerId: seller.id } });
    assert.equal(draft.status, 'draft');
    assert.ok(rowIds((await say(seller.waId, text('tv')))[0]).includes(`sell:sub:${tvs.id}`), 'typed words find the category');
    assert.deepEqual(rowIds((await say(seller.waId, tap(`sell:sub:${tvs.id}`)))[0]), ['sell:cond:new', 'sell:cond:used', 'sell:cond:untested', 'sell:cond:parts']);
    assert.match(bodies(await say(seller.waId, tap('sell:cond:used')))[0], /What is your price/);
    assert.match(bodies(await say(seller.waId, text('cheap')))[0], /as a number/);
    await say(seller.waId, text('180k'));
    assert.equal((await prisma.classifiedListing.findUniqueOrThrow({ where: { id: draft.id } })).priceMinor, 18000000n);
    const where = await say(seller.waId, text('Gwarinpa'));
    assert.match(bodies(where)[0], /photos/);
    for (let i = 0; i < 3; i += 1) assert.match(bodies(await say(seller.waId, { type: 'image', image: { id: `sell-${i}`, mime_type: 'image/jpeg' } }))[0], /more to go/);
    const fourth = await say(seller.waId, { type: 'image', image: { id: 'sell-3', mime_type: 'image/jpeg' } });
    assert.deepEqual(rowIds(fourth[0]), ['sell:photos:done']);
    assert.match(bodies(await say(seller.waId, tap('sell:photos:done')))[0], /Describe it/);
    const next = await say(seller.waId, text('Bought last year, works perfectly.'));
    const summary = next.some(reply => rowIds(reply).includes('sell:post')) ? next : await say(seller.waId, text('Samsung'));
    assert.deepEqual(rowIds(summary.at(-1)), ['sell:post', 'sell:change', 'sell:draft']);
    assert.match(bodies(summary).at(-1), /Samsung 43 inch TV[\s\S]*₦180,000[\s\S]*Gwarinpa[\s\S]*Photos: 4/);
    const posted = await say(seller.waId, tap('sell:post'));
    assert.match(bodies(posted)[0], /Your ad is live: https:\/\/udozo\.com\/ng\/l\/\d+-samsung/);
    assert.equal((await prisma.classifiedListing.findUniqueOrThrow({ where: { id: draft.id } })).status, 'active');
    const journey = await prisma.postingJourney.findFirst({ where: { customerId: seller.id } });
    assert.equal(journey?.source, 'whatsapp');
  });
});

describe('wanted requests', () => {
  test('a request shows matches, tells sellers once, and a seller answers into a chat (on the web and WhatsApp)', async () => {
    const seller = await customer('Musa Bello');
    const buyer = await customer('Ngozi Obi');
    const tv = await live(seller, 'LG 55 inch OLED TV');
    await say(seller.waId, text('hi'));
    const tvs = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } });

    const since = graph.calls.length;
    const created = await buyer.post('/v1/classifieds/wanted', { words: 'LG OLED TV', category_id: tvs.id, budget_max: 40000000 });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.match(created.json.number, /^WR-\d{6}$/);
    assert.ok(created.json.matches.some(card => card.id === tv.id));
    assert.ok(created.json.sellers_told >= 1);
    await services.outbox.idle();
    const alert = sentTo(seller.waId, since).at(-1);
    assert.deepEqual(rowIds(alert), [`wanted:${created.json.id}`]);

    const forYou = await seller.get('/v1/classifieds/me/wanted-for-you');
    assert.ok(forYou.json.data.some(row => row.id === created.json.id && !row.answered));
    const shown = await say(seller.waId, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: `wanted:${created.json.id}`, title: 'See request' } } });
    assert.ok(rowIds(shown[0]).includes(`wresp:${created.json.id}:${tv.id}`));
    assert.match(bodies(await say(seller.waId, tap(`wresp:${created.json.id}:${tv.id}`)))[0], /the buyer has your listing/);
    const chat = await prisma.classifiedConversation.findUniqueOrThrow({ where: { listingId_buyerId: { listingId: tv.id, buyerId: buyer.id } }, include: { messages: { orderBy: { seq: 'desc' }, take: 1 } } });
    assert.match(chat.messages[0].body, /About your request "LG OLED TV"/);
    assert.equal((await seller.post(`/v1/classifieds/wanted/${created.json.id}/respond`, { listing_id: tv.id })).json.error.code, 'already_answered');
    const mine = await buyer.get(`/v1/classifieds/wanted/${created.json.id}`);
    assert.equal(mine.json.responses.length, 1);

    for (let i = 0; i < 2; i += 1) assert.equal((await buyer.post('/v1/classifieds/wanted', { words: `Another TV ${i}`, category_id: tvs.id })).status, 201);
    assert.equal((await buyer.post('/v1/classifieds/wanted', { words: 'One too many', category_id: tvs.id })).json.error.code, 'too_many_requests');
    assert.equal((await buyer.post(`/v1/classifieds/wanted/${created.json.id}/close`, { fulfilled: true })).json.status, 'fulfilled');

    const listed = await admin.get('/v1/admin/classifieds/wanted?country=NG');
    assert.ok(listed.json.data.some(row => row.id === created.json.id));
  });

  test('WANT on WhatsApp posts a request step by step', async () => {
    const buyer = await customer('Tunde Bakare');
    await say(buyer.waId, text('WANT'));
    const guess = await say(buyer.waId, text('television 4k'));
    const tvs = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } });
    const chooseCategory = rowIds(guess[0]).includes('want:cat:yes') ? tap('want:cat:yes') : tap(`want:sub:${tvs.id}`);
    if (!rowIds(guess[0]).includes('want:cat:yes')) await say(buyer.waId, text('tv'));
    await say(buyer.waId, chooseCategory);
    await say(buyer.waId, tap('want:area:any'));
    await say(buyer.waId, text('300k'));
    const summary = await say(buyer.waId, tap('want:cond:any'));
    assert.deepEqual(rowIds(summary[0]), ['want:post', 'menu:want']);
    assert.match(bodies(await say(buyer.waId, tap('want:post')))[0], /Request WR-\d{6} is up for 14 days/);
    const row = await prisma.classifiedWantedRequest.findFirstOrThrow({ where: { customerId: buyer.id } });
    assert.deepEqual([row.source, row.budgetMaxMinor], ['whatsapp', 30000000n]);
  });
});

describe('admins', () => {
  test("the number's health, templates submitted to Meta, a contact looked up and opted out", async () => {
    const overview = await admin.get('/v1/admin/whatsapp');
    assert.equal(overview.status, 200, JSON.stringify(overview.json));
    assert.deepEqual([overview.json.configured, overview.json.meta.name, overview.json.meta.quality], [true, 'Udozo', 'GREEN']);
    const before = await admin.get('/v1/admin/whatsapp/templates');
    assert.ok(before.json.data.every(item => item.status === 'not_submitted'));
    const submitted = await admin.post('/v1/admin/whatsapp/templates/submit', {});
    assert.equal(submitted.json.submitted.length, 5);
    assert.ok(submitted.json.templates.every(item => item.status === 'pending'));
    const contact = await admin.get('/v1/admin/whatsapp/contacts?phone=%2B2348022223333');
    assert.equal(contact.status, 200);
    const out = await admin.post(`/v1/admin/whatsapp/contacts/${contact.json.id}/opt-out`, { reason: 'Asked us by email' });
    assert.ok(out.json.opted_out_at);
    const tested = await admin.post('/v1/admin/integrations/whatsapp/test', {});
    assert.deepEqual([tested.json.ok, tested.json.message], [true, 'Connected to Udozo (+234 800 000 0000), quality green.']);
  });

  test('the job runs and is Udozo’s', async () => {
    const run = await fetch(`${server.base}/v1/cron/whatsapp`, { headers: { authorization: 'Bearer cron-secret' } });
    assert.equal(run.status, 200);
    const body = await run.json();
    assert.ok('flows_reset' in body.result || 'flows_reset' in body, JSON.stringify(body));
  });
});
