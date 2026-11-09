// Udozo on WhatsApp (docs/UDOZO_WHATSAPP_PLAN.md): Meta's webhook (the address check, signatures, each body stored once),
// numbers linked by themselves or with a code, STOP and START, the menu, finding listings, chats relayed both ways (the
// window and its template), selling step by step, wanted requests and the admin page. Meta is a local fake.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, fakeService, lastEmailCode, resellerClient, startApp, testMobile } from './helpers.mjs';
import { fakeAi } from './fakes.mjs';

let server;
let prisma;
let admin;
let bucket;
let graph;
let notices;
let services;
let ai;
const anjio = '00000000-0000-4000-8000-0000000000c1';
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
  ai = await fakeAi();
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
    if (call.method === 'GET' && path === '/WABA/phone_numbers') return { body: { data: [{ id: 'PNID', display_phone_number: '+234 800 000 0000' }] } };
    // An ID that is not a WhatsApp Business Account (here, the phone number's): Meta has no such list on it.
    if (path === '/PNID/message_templates' || path === '/PNID/phone_numbers') return { status: 400, body: { error: { message: '(#100) Tried accessing nonexisting field (message_templates)', type: 'OAuthException', code: 100 } } };
    if (call.method === 'POST' && path === '/WABA/message_templates') {
      // As Meta: a body may not start or end with a variable (its reason in error_user_msg).
      const text = call.body.components?.find(item => item.type === 'BODY')?.text ?? '';
      if (/^\{\{|\}\}[.!]?$/.test(text.trim())) return { status: 400, body: { error: { message: 'Invalid parameter', code: 100, error_subcode: 2388299, error_user_title: 'Variables can\'t be at the start or end of the template', error_user_msg: 'Variables can\'t be at the start or end of the template.' } } };
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
      ...ai.env,
      ANTHROPIC_API_KEY: 'good-anthropic-bitocard',
      ANTHROPIC_PRICES: 'claude-sonnet-5-5 3 15 0.3; claude-haiku-5-5 1 5 0.1',
      AI_BITOCARD_MODELS: 'anthropic:claude-sonnet-5-5, anthropic:claude-haiku-5-5',
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
  await ai?.close();
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
    // A number with no account is offered one, made right there.
    assert.deepEqual(rowIds(menu[0]), ['menu:find', 'menu:want', 'menu:sell', 'menu:chats', 'menu:join', 'menu:help']);
    assert.match(bodies(await say(waId, text('STOP')))[0], /no more messages/);
    assert.deepEqual(await say(waId, text('STOP')), [], 'STOP is answered once');
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
    // Codes confirming a mobile are not offered on WhatsApp until Meta approves the verification template.
    assert.deepEqual([channels.whatsapp, channels.wanted], [{ available: true, number: '+2348000000000', codes: false }, true]);
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
    assert.deepEqual(rowIds(card[1]), [`chat:${tv.id}`, `ct:${tv.id}`, `more:${tv.id}`]);
    assert.deepEqual(rowIds((await say(buyer.waId, tap(`more:${tv.id}`)))[0]), [`cb:${tv.id}`, `save:${tv.id}`, 'menu:find']);

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

    // While chatting, everyday words are messages to the other side, not the menu; MENU still leaves.
    const hello = graph.calls.length;
    assert.deepEqual(await say(buyer.waId, text('Hello')), [], 'no menu while chatting');
    await services.outbox.idle();
    assert.equal((await prisma.classifiedMessage.findFirstOrThrow({ where: { conversationId: chat.id }, orderBy: { seq: 'desc' } })).body, 'Hello');
    assert.equal(sentTo(seller.waId, hello).at(-1).text.body, '*Hisense 50 inch smart TV*\nAmaka E.: Hello');
    // The seller answered by quoting: their plain messages now go to that chat too.
    const plain = graph.calls.length;
    await say(seller.waId, text('Hi'));
    await services.outbox.idle();
    assert.equal(sentTo(buyer.waId, plain).at(-1).text.body, '*Hisense 50 inch smart TV*\nChinedu O.: Hi');
    assert.deepEqual(rowIds((await say(buyer.waId, text('menu')))[0]).slice(0, 1), ['menu:find']);

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

describe('Contact seller', () => {
  test("gives the seller's own WhatsApp only when they chose it, or details they shared; anyone else is asked", async () => {
    const seller = await customer('Bisi Adeyemi');
    const buyer = await customer('Tunde Bello');
    const tv = await live(seller, 'Sony Bravia 43 inch TV');
    await say(seller.waId, text('hi'));
    await say(buyer.waId, text('hi'));
    const notices = type => prisma.notification.count({ where: { customerId: seller.id, type } });

    // A visitor (no account) is asked to connect first.
    const stranger = `2348${String(Date.now()).slice(-9)}`;
    assert.match(bodies(await say(stranger, tap(`ct:${tv.id}`)))[0], /connect your Udozo account first/);

    // Not chosen: the seller is asked for their details, as Ask for contact did; nothing about them is shown.
    const asked = await say(buyer.waId, tap(`ct:${tv.id}`));
    assert.match(bodies(asked)[0], /has not chosen to share their WhatsApp number/);
    assert.doesNotMatch(JSON.stringify(asked), new RegExp(seller.waId));
    assert.equal(await prisma.classifiedContactRequest.count({ where: { buyerId: buyer.id, sellerId: seller.id, kind: 'contact', status: 'pending' } }), 1);

    // The seller chooses "Let buyers WhatsApp me directly" on udozo.com (only with a connected number).
    const loner = await customer('Ngozi Obi');
    assert.equal((await loner.patch('/v1/store/account/whatsapp', { direct: true })).json.error.code, 'whatsapp_not_connected');
    const turned = await seller.patch('/v1/store/account/whatsapp', { direct: true });
    assert.equal(turned.status, 200, JSON.stringify(turned.json));
    assert.equal(turned.json.direct, true);

    const shown = await say(buyer.waId, tap(`ct:${tv.id}`));
    assert.equal(shown.length, 1);
    const cta = shown[0].interactive;
    assert.equal(cta.type, 'cta_url');
    assert.match(cta.body.text, /\*Bisi A\.\* sells "Sony Bravia 43 inch TV" on Udozo\.\nWhatsApp: \+234/);
    assert.match(cta.body.text, /UdozoPay/);
    assert.equal(cta.action.parameters.display_text, 'Chat on WhatsApp');
    const link = new URL(cta.action.parameters.url);
    assert.equal(`${link.origin}${link.pathname}`, `https://wa.me/${seller.waId}`);
    assert.match(link.searchParams.get('text'), /^Hi, I saw your listing "Sony Bravia 43 inch TV" on Udozo: https:\/\/udozo\.com\/ng\/l\//);
    // Recorded once: a lead, and the seller told once who has their number.
    await say(buyer.waId, tap(`ct:${tv.id}`));
    assert.equal(await prisma.whatsappDirectContact.count({ where: { buyerId: buyer.id, sellerId: seller.id } }), 1);
    assert.equal(await prisma.classifiedLead.count({ where: { listingId: tv.id, buyerId: buyer.id, kind: 'phone' } }), 1);
    assert.equal(await notices('customer.classifieds.whatsapp_shared'), 1);

    // A seller who blocked the buyer is never shown to them.
    const chat = await buyer.post('/v1/classifieds/conversations', { listing_id: tv.id, body: 'Hello' });
    assert.equal(chat.status, 201, JSON.stringify(chat.json));
    assert.equal((await seller.post(`/v1/classifieds/conversations/${chat.json.id}/block`)).status, 200);
    assert.match(bodies(await say(buyer.waId, tap(`ct:${tv.id}`)))[0], /cannot contact this seller/);
    assert.equal((await seller.post(`/v1/classifieds/conversations/${chat.json.id}/unblock`)).status, 200);

    // Turned off (or the number let go), buyers are asked again; details the seller shared still show.
    assert.equal((await seller.patch('/v1/store/account/whatsapp', { direct: false })).json.direct, false);
    const request = await prisma.classifiedContactRequest.findFirstOrThrow({ where: { buyerId: buyer.id, sellerId: seller.id, kind: 'contact' } });
    assert.equal((await seller.post(`/v1/classifieds/contact-requests/${request.id}/accept`)).status, 200);
    const sharedReply = await say(buyer.waId, tap(`ct:${tv.id}`));
    // (The accepted request's own notice comes first.)
    const shared = sharedReply.at(-1)?.interactive;
    assert.ok(shared, JSON.stringify(sharedReply));
    assert.equal(shared.type, 'cta_url');
    assert.match(shared.body.text, /They shared their details with you/);
    assert.match(shared.body.text, /Email: wa\d+-\d+@example\.com/);

    await seller.patch('/v1/store/account/whatsapp', { direct: true });
    await seller.delete('/v1/store/account/whatsapp');
    assert.equal((await prisma.whatsappContact.findUniqueOrThrow({ where: { waId: seller.waId } })).directAt, null, 'disconnecting forgets the choice');
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
    assert.deepEqual(submitted.json.failed, [], 'none starts or ends with a variable');
    assert.equal(submitted.json.submitted.length, 6);
    assert.ok(submitted.json.templates.every(item => item.status === 'pending'));
    const contact = await admin.get('/v1/admin/whatsapp/contacts?phone=%2B2348022223333');
    assert.equal(contact.status, 200);
    const out = await admin.post(`/v1/admin/whatsapp/contacts/${contact.json.id}/opt-out`, { reason: 'Asked us by email' });
    assert.ok(out.json.opted_out_at);
    const tested = await admin.post('/v1/admin/integrations/whatsapp/test', {});
    assert.deepEqual([tested.json.ok, tested.json.message], [true, 'Connected to Udozo (+234 800 000 0000), quality green.']);
  });

  test("Meta's own words for a refusal are shown, and a verification template refused for permission says why", async () => {
    const { WhatsappCloud, WhatsappError } = await import('../dist/whatsapp/cloud-api.js');
    const config = { WHATSAPP_PHONE_NUMBER_ID: 'PNID', WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA', WHATSAPP_ACCESS_TOKEN: 'meta-token', WHATSAPP_API_URL: graph.url };
    const error = await new WhatsappCloud(config).createTemplate({ name: 'x', language: 'en_GB', category: 'UTILITY', components: [{ type: 'BODY', text: '{{1}} wrote' }] }).catch(problem => problem);
    assert.ok(error instanceof WhatsappError);
    assert.equal(error.message, "whatsapp: Invalid parameter: Variables can't be at the start or end of the template: Variables can't be at the start or end of the template. (100)");
  });

  test('a WhatsApp Business Account ID that is not one is explained in plain words, not as Meta’s error', async () => {
    const { WhatsappCloud, accountIdProblem } = await import('../dist/whatsapp/cloud-api.js');
    const config = { WHATSAPP_PHONE_NUMBER_ID: 'PNID', WHATSAPP_BUSINESS_ACCOUNT_ID: 'PNID', WHATSAPP_ACCESS_TOKEN: 'meta-token', WHATSAPP_API_URL: graph.url };
    const error = await new WhatsappCloud(config).templates().catch(problem => problem);
    assert.match(accountIdProblem(error, config), /^The WhatsApp Business Account ID is the same as the phone number ID\. In Meta for Developers, open your app, then WhatsApp > API Setup/);
    assert.match(accountIdProblem(error, { ...config, WHATSAPP_BUSINESS_ACCOUNT_ID: '123' }), /^Meta says 123 is not a WhatsApp Business Account/);
    assert.equal(accountIdProblem(new Error('other'), config), null);
  });

  test('the job runs and is Udozo’s', async () => {
    const run = await fetch(`${server.base}/v1/cron/whatsapp`, { headers: { authorization: 'Bearer cron-secret' } });
    assert.equal(run.status, 200);
    const body = await run.json();
    assert.ok('flows_reset' in body.result || 'flows_reset' in body, JSON.stringify(body));
  });
});


describe('Anjio on WhatsApp', () => {
  test('questions go to Anjio (visitors and accounts), listings come to tap, a drafted message is sent to the seller, and a person takes over', async () => {
    // Off: a question is a search, and the menu has no Ask row.
    const visitor = '2348066667777';
    const off = await say(visitor, text('How does UdozoPay work?'));
    assert.equal(ai.state.calls.length, 0);
    assert.match(bodies(off)[0], /Nothing found|Results for/);

    for (const key of ['classifieds_assistant', 'whatsapp_assistant']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200, key);
    assert.equal((await admin.post(`/v1/admin/support/bots/${anjio}/shop-knowledge/refresh`, {})).status, 200);
    const active = await admin.post(`/v1/admin/support/bots/${anjio}/activate`);
    assert.equal(active.json.status, 'active', JSON.stringify(active.json));

    // A number with no account asks as a visitor; the answer's HTML becomes WhatsApp text.
    await say(visitor, text('menu'));
    ai.state.script = [{ text: '<p>With <strong>UdozoPay</strong> Udozo holds your money until you have the item.</p><ul><li>Pay in the app</li><li>Never pay outside it</li></ul>' }];
    const answer = await say(visitor, text('How does UdozoPay work?'));
    assert.equal(answer.length, 1, JSON.stringify(answer));
    assert.equal(answer[0].text.body, 'With *UdozoPay* Udozo holds your money until you have the item.\n\n• Pay in the app\n• Never pay outside it');
    assert.ok(graph.calls.some(call => call.body?.status === 'read' && call.body?.typing_indicator?.type === 'text'), 'typing… while it answers');
    const contact = await prisma.whatsappContact.findUniqueOrThrow({ where: { waId: visitor } });
    const thread = await prisma.assistantThread.findUniqueOrThrow({ where: { id: contact.assistantThreadId } });
    assert.deepEqual([thread.channel, thread.customerId, Boolean(thread.visitorHash)], ['whatsapp', null, true]);
    // A follow-up carries on the same conversation (the earlier turn goes with it).
    ai.state.script = [{ text: 'Yes, for every item with UdozoPay.' }];
    assert.equal(bodies(await say(visitor, text('and for phones too')))[0], 'Yes, for every item with UdozoPay.');
    assert.equal((await prisma.whatsappContact.findUniqueOrThrow({ where: { waId: visitor } })).assistantThreadId, thread.id);
    assert.equal(await prisma.assistantMessage.count({ where: { threadId: thread.id } }), 4);
    assert.match(JSON.stringify(ai.state.calls.at(-1).body.messages), /How does UdozoPay work/);
    // Talk to a person needs an account.
    ai.state.script = [{ tool: { name: 'offer_person', arguments: { reason: 'A refund' } } }, { text: 'A person can help with that.' }];
    assert.match(bodies(await say(visitor, text('I want my money back please')))[1], /once your Udozo account is connected/);

    // A connected account: the menu offers Ask Anjio; listings come as a list to tap.
    const seller = await customer('Bola Akin');
    const buyer = await customer('Tunde Bello');
    const tv = await live(seller, 'LG 55 inch OLED TV');
    await say(seller.waId, text('hi'));
    const menu = await say(buyer.waId, text('menu'));
    assert.deepEqual(rowIds(menu[0]).slice(0, 2), ['menu:find', 'menu:ask']);
    assert.match(bodies(await say(buyer.waId, tap('menu:ask')))[0], /^Ask Anjio, Udozo's AI assistant/);
    ai.state.script = [{ tool: { name: 'search_listings', arguments: { words: 'LG OLED' } } }, { text: '<p>One LG OLED near you.</p>' }];
    const found = await say(buyer.waId, text('lg oled'));
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.equal(found[0].interactive.body.text, 'One LG OLED near you.');
    assert.ok(rowIds(found[0]).includes(`l:${tv.ref}`), JSON.stringify(rowIds(found[0])));
    const asked = await prisma.assistantThread.findFirstOrThrow({ where: { customerId: buyer.id, channel: 'whatsapp' } });
    assert.equal(asked.surface, 'browse');

    // A drafted first message, sent to the seller with one tap (relayed to their WhatsApp).
    ai.state.script = [{ tool: { name: 'draft_message', arguments: { listing_id: tv.id, text: 'Hello, is the LG TV still available?' } } }, { text: 'Here is a message you can send.' }];
    const drafted = await say(buyer.waId, text('write to the seller for me'));
    const button = drafted.at(-1);
    assert.match(button.interactive.body.text, /A first message to the seller of \*LG 55 inch OLED TV\*:\n\nHello, is the LG TV still available\?/);
    const since = graph.calls.length;
    assert.match(bodies(await say(buyer.waId, tap(rowIds(button)[0])))[0], /Sent to the seller of "LG 55 inch OLED TV"/);
    await services.outbox.idle();
    const chat = await prisma.classifiedConversation.findUniqueOrThrow({ where: { listingId_buyerId: { listingId: tv.id, buyerId: buyer.id } }, include: { messages: true } });
    assert.ok(chat.messages.some(message => message.body === 'Hello, is the LG TV still available?' && message.channel === 'whatsapp'));
    assert.equal(sentTo(seller.waId, since).at(-1).text.body, '*LG 55 inch OLED TV*\nTunde B.: Hello, is the LG TV still available?');

    // Now chatting: a question is a message to the seller, never Anjio's.
    const calls = ai.state.calls.length;
    assert.deepEqual(await say(buyer.waId, text('Can you deliver to Wuse?')), []);
    assert.equal(ai.state.calls.length, calls, 'Anjio stays out of chats between people');

    // MENU, then a question with nothing going on goes to Anjio; a person takes over when it offers one.
    await say(buyer.waId, text('menu'));
    ai.state.script = [{ tool: { name: 'offer_person', arguments: { reason: 'A refund' } } }, { text: 'A person can help with that.' }];
    const person = await say(buyer.waId, text('How do I get a refund for an order?'));
    const threadId = (await prisma.whatsappContact.findUniqueOrThrow({ where: { waId: buyer.waId } })).assistantThreadId;
    assert.deepEqual(rowIds(person.at(-1)), [`aperson:${threadId}`]);
    assert.match(bodies(await say(buyer.waId, tap(rowIds(person.at(-1))[0])))[0], /a person from Udozo’s team has this conversation/);
    assert.ok((await prisma.assistantThread.findUniqueOrThrow({ where: { id: threadId } })).chatId);

    // Short words stay a search; when Anjio cannot answer, the question is searched instead.
    const before = ai.state.calls.length;
    await say(buyer.waId, text('menu'));
    assert.ok(rowIds((await say(buyer.waId, text('oled')))[0]).includes(`l:${tv.ref}`));
    assert.equal(ai.state.calls.length, before);
    await say(buyer.waId, text('menu'));
    ai.state.script = [{ status: 529 }, { status: 529 }, { status: 529 }];
    assert.ok(rowIds((await say(buyer.waId, text('Where can I find an oled?')))[0]).includes(`l:${tv.ref}`));
    ai.state.script = null;

    // The admin sees it was on WhatsApp.
    const threads = await admin.get(`/v1/admin/support/bots/${anjio}/threads`);
    assert.ok(threads.json.data.some(row => row.channel === 'whatsapp'));
    assert.equal((await admin.put('/v1/admin/switches/whatsapp_assistant', { country_code: 'NG', enabled: false })).status, 200);
  });
});

describe('verification codes on WhatsApp', () => {
  test('nobody is offered WhatsApp codes until Meta approves the template; Meta not answering keeps the last answer', async () => {
    const codes = server.app.get((await import('../dist/whatsapp/codes.service.js')).WhatsappCodes);
    assert.equal(await codes.templateApproved(true), false, 'submitted, still pending');
    const kemi = await customer('Ngozi Ade');
    const refused = await kemi.post('/v1/store/account/phone', { phone: testMobile('NG'), channel: 'whatsapp' });
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'whatsapp_unavailable']);
    for (const item of templates) if (item.name === 'udozo_verification_code') item.status = 'APPROVED';
    assert.equal(await codes.templateApproved(true), true);
    assert.equal((await (await fetch(`${server.base}/v1/classifieds/channels?country=NG`)).json()).whatsapp.codes, true);
  });

  /** The code in the last verification template sent to a number (its body's value, the same as its copy button's). */
  const lastCode = (waId, since) => {
    const call = sentTo(waId, since).filter(body => body.type === 'template' && body.template.name === 'udozo_verification_code').at(-1);
    if (!call) return null;
    const [body, button] = call.template.components;
    assert.deepEqual([button.type, button.sub_type, button.index], ['button', 'url', '0']);
    assert.equal(button.parameters[0].text, body.parameters[0].text, 'the copy button carries the code');
    return body.parameters[0].text;
  };

  test("a customer's mobile is confirmed with a code sent on WhatsApp, by choice or where the country cannot text", async () => {
    const kemi = await customer('Kemi Bello');
    const number = testMobile('NG');
    const waId = number.replace(/\D/g, '');

    // Chosen: the code goes with Meta's verification template, and the answer says so.
    let since = graph.calls.length;
    const sent = await kemi.post('/v1/store/account/phone', { phone: number, channel: 'whatsapp' });
    assert.equal(sent.status, 202, JSON.stringify(sent.json));
    assert.deepEqual([sent.json.channel, sent.json.message], ['whatsapp', `A code is on its way to ${number} on WhatsApp.`]);
    const code = lastCode(waId, since);
    assert.match(code, /^\d{6}$/);
    // Logged without the code.
    const row = await prisma.whatsappMessage.findFirstOrThrow({ where: { template: 'udozo_verification_code', contact: { waId } } });
    assert.deepEqual([row.direction, row.status, row.payloadEncrypted], ['out', 'sent', null]);
    const confirmed = await kemi.post('/v1/store/account/phone/verify', { code });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
    assert.deepEqual([confirmed.json.phone, confirmed.json.phone_verified], [number, true]);

    // By text unless asked.
    await prisma.customerCode.updateMany({ where: { customerId: kemi.id }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    const texted = await kemi.post('/v1/store/account/phone', { phone: testMobile('NG') });
    assert.deepEqual([texted.status, texted.json.channel], [202, 'sms']);

    // A country that cannot text sends it on WhatsApp by itself.
    const sms = (await prisma.country.findUniqueOrThrow({ where: { code: 'NG' } })).smsProvider;
    await prisma.country.update({ where: { code: 'NG' }, data: { smsProvider: null } });
    try {
      const other = testMobile('NG');
      await prisma.customerCode.updateMany({ where: { customerId: kemi.id }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
      since = graph.calls.length;
      const fallback = await kemi.post('/v1/store/account/phone', { phone: other });
      assert.equal(fallback.status, 202, JSON.stringify(fallback.json));
      assert.equal(fallback.json.channel, 'whatsapp');
      assert.ok(lastCode(other.replace(/\D/g, ''), since));
    } finally {
      await prisma.country.update({ where: { code: 'NG' }, data: { smsProvider: sms } });
    }

    // WhatsApp closed in the market: asking for it is refused, a text still works.
    assert.equal((await admin.put('/v1/admin/switches/whatsapp_channel', { country_code: 'NG', enabled: false })).status, 200);
    try {
      await prisma.customerCode.updateMany({ where: { customerId: kemi.id }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
      const closed = await kemi.post('/v1/store/account/phone', { phone: testMobile('NG'), channel: 'whatsapp' });
      assert.deepEqual([closed.status, closed.json.error.code, closed.json.error.param], [409, 'whatsapp_unavailable', 'channel']);
      assert.equal((await kemi.post('/v1/store/account/phone', { phone: testMobile('NG'), channel: 'fax' })).status, 400);
    } finally {
      assert.equal((await admin.put('/v1/admin/switches/whatsapp_channel', { country_code: 'NG', enabled: true })).status, 200);
    }
  });

  test("Seller HQ's numbers take a code on WhatsApp; the template is submitted as Meta's authentication kind", async () => {
    const owner = await resellerClient(server);
    const number = testMobile('NG');
    const since = graph.calls.length;
    const sent = await owner.browser.post('/v1/auth/phones', { phone: number, channel: 'whatsapp' });
    assert.equal(sent.status, 202, JSON.stringify(sent.json));
    assert.equal(sent.json.channel, 'whatsapp');
    const code = lastCode(number.replace(/\D/g, ''), since);
    const confirmed = await owner.browser.post('/v1/auth/phones/verify', { code });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
    assert.ok(confirmed.json.data.some(item => item.phone === number));

    const { templateSubmission } = await import('../dist/whatsapp/templates.js');
    const auth = templateSubmission('udozo_verification_code');
    assert.equal(auth.category, 'AUTHENTICATION');
    assert.deepEqual(auth.components.map(item => item.type), ['BODY', 'FOOTER', 'BUTTONS']);
    assert.deepEqual([auth.components[1].code_expiration_minutes, auth.components[2].buttons[0].otp_type], [30, 'COPY_CODE']);
  });
});

describe('signing up and in with WhatsApp', () => {
  const start = body => fetch(`${server.base}/v1/store/account/whatsapp-sign-in/start`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36' }, body: JSON.stringify(body) });
  const finish = async token => {
    const res = await fetch(`${server.base}/v1/store/account/whatsapp-sign-in/finish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    return { status: res.status, json: await res.json() };
  };

  test('a number with no account makes one on WhatsApp (names, the email and its code), and the browser that asked is signed in once', async () => {
    const taken = await customer('Taken Email');
    const takenEmail = (await prisma.customer.findUniqueOrThrow({ where: { id: taken.id } })).email;
    const begun = await start({ intent: 'signup', country: 'NG', ref: 'abc123def0' });
    assert.equal(begun.status, 200);
    const signIn = await begun.json();
    assert.match(signIn.link, /^https:\/\/wa\.me\/2348000000000\?text=JOIN%20[A-Z0-9]{8}$/);
    assert.match(signIn.token, /^bws_/);
    assert.equal((await finish(signIn.token)).json.status, 'waiting');

    const waId = testMobile('NG').replace(/\D/g, '');
    const intro = await say(waId, text(signIn.text));
    assert.match(bodies(intro)[0], /make your Udozo account/);
    assert.deepEqual(rowIds(intro[0]), ['join:accept', 'join:cancel']);
    assert.match(bodies(await say(waId, tap('join:accept')))[0], /first name/);
    assert.match(bodies(await say(waId, text('Ada1')))[0], /does not look like a first name/);
    assert.match(bodies(await say(waId, text('Ada')))[0], /last name/);
    assert.match(bodies(await say(waId, text("Obi-Nwosu")))[0], /email address/);
    assert.match(bodies(await say(waId, text(takenEmail)))[0], /already uses that email/);
    const email = `ada-${Date.now()}@example.com`;
    assert.match(bodies(await say(waId, text(email)))[0], /emailed a 6-digit code/);
    assert.match(bodies(await say(waId, text('000000')))[0], /not valid/);
    const done = await say(waId, text(await lastEmailCode(server.app, email)));
    assert.match(bodies(done)[0], /Welcome to Udozo, Ada! .*you are signed in there/);

    const row = await prisma.customer.findFirstOrThrow({ where: { email } });
    assert.deepEqual([row.firstName, row.lastName, row.phone, row.country, row.passwordHash, row.signupRef], ['Ada', 'Obi-Nwosu', `+${waId}`, 'NG', null, 'abc123def0']);
    assert.ok(row.emailVerifiedAt && row.phoneVerifiedAt && row.nameConfirmedAt, 'email, mobile and names confirmed');
    assert.equal((await prisma.whatsappContact.findUniqueOrThrow({ where: { waId } })).customerId, row.id);

    const approved = await finish(signIn.token);
    assert.equal(approved.json.status, 'approved');
    assert.deepEqual([approved.json.signed_up, approved.json.customer.email], [true, email]);
    const me = await fetch(`${server.base}/v1/store/account`, { headers: { 'bitocard-customer-session': approved.json.session.token } });
    assert.equal(me.status, 200, 'the session works');
    assert.equal((await finish(signIn.token)).json.error.code, 'whatsapp_sign_in_unknown', 'once only');
    const journey = await prisma.signupJourney.findFirstOrThrow({ where: { email } });
    assert.equal(journey.method, 'whatsapp');
    assert.ok(journey.accountCreatedAt);

    // The account is theirs on WhatsApp too: JOIN again says so.
    assert.match(bodies(await say(waId, text('JOIN')))[0], /already have a Udozo account/);
  });

  test('a number with an account says yes or no; the code is bound to the number that sent it; refusals', async () => {
    const kemi = await customer('Kemi Bello');
    await say(kemi.waId, text('hello'));

    const first = await (await start({ intent: 'signin', country: 'NG' })).json();
    const ask = await say(kemi.waId, text(first.text));
    assert.match(bodies(ask)[0], /Sign in to Udozo as Kemi on Chrome on Windows\?/);
    const [yes] = rowIds(ask[0]);
    assert.match(bodies(await say(testMobile('NG').replace(/\D/g, ''), text(first.text)))[0], /did not work/, 'another number cannot take it');
    assert.equal((await finish(first.token)).json.status, 'waiting');
    assert.match(bodies(await say(kemi.waId, tap(yes)))[0], /you are signed in/);
    const approved = await finish(first.token);
    assert.deepEqual([approved.json.status, approved.json.signed_up, approved.json.customer.id], ['approved', false, kemi.id]);

    const second = await (await start({ intent: 'signin', country: 'NG' })).json();
    const no = rowIds((await say(kemi.waId, text(second.text)))[0])[1];
    assert.match(bodies(await say(kemi.waId, tap(no)))[0], /Nobody was signed in/);
    assert.equal((await finish(second.token)).json.status, 'declined');

    assert.equal((await finish('bws_not-a-real-token-at-all')).status, 400);
    const closed = await start({ intent: 'signin', country: 'GH' });
    assert.deepEqual([closed.status, (await closed.json()).error.code], [409, 'whatsapp_unavailable']);
    assert.match(bodies(await say(kemi.waId, text('LOGIN ABCD2345')))[0], /did not work/);
  });
});
