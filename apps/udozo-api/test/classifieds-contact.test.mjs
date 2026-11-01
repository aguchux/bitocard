// Getting in touch without details on the page: Request contact (the seller's phone and email shown to that buyer on
// every listing of theirs once accepted), Request a call back (the buyer's name, mobile and email to the seller), and
// calls in the browser while both are on udozo.com, relayed through Cloudflare's TURN service.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, fakeService, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let turn;

before(async () => {
  turn = await fakeService(call => {
    if (call.method === 'POST' && /\/v1\/turn\/keys\/turn-key-1\/credentials\/generate-ice-servers$/.test(call.url)) {
      if (call.headers.authorization !== 'Bearer turn-token') return { status: 401, body: { errors: [{ message: 'unauthorised' }] } };
      return {
        status: 201,
        body: {
          iceServers: [
            { urls: ['stun:stun.cloudflare.com:3478'] },
            { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u-1', credential: 'c-1' },
          ],
        },
      };
    }
    return { status: 404, body: {} };
  });
  server = await startApp({ env: { APP_PRODUCT: 'udozo', CLOUDFLARE_TURN_KEY_ID: 'turn-key-1', CLOUDFLARE_TURN_API_TOKEN: 'turn-token', CLOUDFLARE_TURN_API_URL: turn.url } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  const admin = await adminClient(server);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
});

after(async () => {
  await server?.close();
  await turn?.close();
});

function storeServer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `contact-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = res.status === 204 ? null : await res.json();
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), del: path => request('DELETE', path) };
}

let counter = 0;
async function customer(name, { phone } = {}) {
  const shopper = storeServer();
  const email = `contact${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  await confirmMobile(server.app, shopper);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
  shopper.id = signup.json.customer.id;
  shopper.email = email;
  if (phone) await prisma.customer.update({ where: { id: shopper.id }, data: { phone, phoneVerifiedAt: new Date() } });
  shopper.phone = (await prisma.customer.findUniqueOrThrow({ where: { id: shopper.id } })).phone;
  return shopper;
}

async function live(seller, title, { contact = 'both' } = {}) {
  const [cat, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
  const draft = (await seller.post('/v1/classifieds/listings', { title, price: 25000000, condition: 'used', category_id: cat.id, area_id: area.id, contact })).json;
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.id, kind: 'photo', position, url: `https://media.test/${draft.id}-${position}.jpg` })) });
  const submitted = (await seller.post(`/v1/classifieds/listings/${draft.id}/submit`)).json;
  assert.equal(submitted.status, 'active', JSON.stringify(submitted));
  return submitted;
}

const notices = (customerId, type) => prisma.notification.count({ where: { customerId, type } });
const viewer = (who, listing) => who.get(`/v1/classifieds/listings/${listing.id}/viewer`).then(res => res.json);

describe('Request contact', () => {
  test('the seller accepts: their phone and email show to that buyer on every listing of theirs, until they stop sharing', async () => {
    const seller = await customer('Chinedu Okafor', { phone: '+2348031120001' });
    const buyer = await customer('Kemi Adeyemi');
    const tv = await live(seller, 'Hisense 50 inch TV');
    const radio = await live(seller, 'Sony radio and speakers');

    const before = await viewer(buyer, tv);
    assert.deepEqual(before.contact, { available: true, shared: null, request: null }, 'nothing about the seller on the page');
    assert.equal(before.callback.available, true);

    assert.equal((await seller.post(`/v1/classifieds/listings/${tv.id}/contact-requests`)).json.error.param, 'listing_id', 'not on your own listing');
    assert.equal((await storeServer().post(`/v1/classifieds/listings/${tv.id}/contact-requests`)).status, 401, 'signed in only');

    const asked = await buyer.post(`/v1/classifieds/listings/${tv.id}/contact-requests`, { note: 'Call me on 08031234567 please, see https://bit.ly/x' });
    assert.equal(asked.status, 201, JSON.stringify(asked.json));
    assert.deepEqual([asked.json.kind, asked.json.status, asked.json.role, asked.json.with.name], ['contact', 'pending', 'buyer', 'Chinedu O.']);
    assert.doesNotMatch(asked.json.note, /08031234567|bit\.ly/, 'numbers and links hidden in the note');
    const again = await buyer.post(`/v1/classifieds/listings/${radio.id}/contact-requests`);
    assert.equal(again.json.id, asked.json.id, 'one open request per seller, whatever listing');
    assert.equal(await notices(seller.id, 'customer.classifieds.contact_request'), 1);
    assert.equal((await viewer(buyer, tv)).contact.request.status, 'pending');

    const incoming = await seller.get('/v1/classifieds/me/contact-requests');
    assert.equal(incoming.json.pending, 1);
    assert.deepEqual(incoming.json.data[0].with, { name: 'Kemi A.', phone: null, email: null }, 'a contact request shows the buyer by their public name only');
    assert.equal((await buyer.post(`/v1/classifieds/contact-requests/${asked.json.id}/accept`)).json.error.param, 'action', 'only the seller accepts');
    const stranger = await customer('Tunde Bakare');
    assert.equal((await stranger.post(`/v1/classifieds/contact-requests/${asked.json.id}/accept`)).status, 404);

    const accepted = await seller.post(`/v1/classifieds/contact-requests/${asked.json.id}/accept`);
    assert.deepEqual([accepted.status, accepted.json.status], [200, 'accepted']);
    assert.equal((await seller.post(`/v1/classifieds/contact-requests/${asked.json.id}/accept`)).json.error.code, 'request_answered');
    assert.equal(await notices(buyer.id, 'customer.classifieds.contact_answered'), 1);
    const shared = await viewer(buyer, radio);
    assert.deepEqual(shared.contact.shared, { phone: '+2348031120001', email: seller.email }, 'shown on every listing of the seller');
    assert.equal(shared.contact.request, null);
    assert.equal((await viewer(stranger, tv)).contact.shared, null, 'never to anyone else');
    const stats = await seller.get(`/v1/classifieds/me/listings/${tv.id}/stats`);
    assert.deepEqual([stats.json.leads, stats.json.phone_reveals], [1, 1]);

    const shares = await seller.get('/v1/classifieds/me/contact-shares');
    assert.deepEqual(shares.json.data.map(row => row.buyer.name), ['Kemi A.']);
    assert.equal((await seller.del(`/v1/classifieds/me/contact-shares/${buyer.id}`)).status, 200);
    assert.equal((await viewer(buyer, tv)).contact.shared, null, 'stopped sharing');
    assert.equal((await seller.del(`/v1/classifieds/me/contact-shares/${buyer.id}`)).status, 404);
  });

  test('declined, the buyer may ask again after a week; messages-only listings and blocked buyers cannot ask; ten an hour', async () => {
    const seller = await customer('Ada Eze', { phone: '+2348031120002' });
    const buyer = await customer('Musa Bello');
    const tv = await live(seller, 'LG 43 inch smart TV');
    const chatOnly = await live(seller, 'LG soundbar', { contact: 'chat' });

    assert.equal((await buyer.post(`/v1/classifieds/listings/${chatOnly.id}/contact-requests`)).json.error.code, 'contact_not_offered');
    assert.equal((await viewer(buyer, chatOnly)).contact.available, false);
    const asked = (await buyer.post(`/v1/classifieds/listings/${tv.id}/contact-requests`)).json;
    assert.equal((await seller.post(`/v1/classifieds/contact-requests/${asked.id}/decline`)).json.status, 'declined');
    const refused = await buyer.post(`/v1/classifieds/listings/${tv.id}/contact-requests`);
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'contact_declined']);
    assert.ok((await viewer(buyer, tv)).contact.request.ask_again_at);
    await prisma.classifiedContactRequest.update({ where: { id: asked.id }, data: { answeredAt: new Date(Date.now() - 8 * 86_400_000) } });
    assert.equal((await buyer.post(`/v1/classifieds/listings/${tv.id}/contact-requests`)).status, 201, 'a week on, they may ask again');

    const blocker = await customer('Bisi Ola', { phone: '+2348031120003' });
    const blocked = await live(blocker, 'Samsung 32 inch TV');
    const chat = (await buyer.post('/v1/classifieds/conversations', { listing_id: blocked.id, body: 'Last price?' })).json;
    await blocker.post(`/v1/classifieds/conversations/${chat.id}/block`);
    for (const path of ['contact-requests', 'callbacks', 'calls']) {
      assert.equal((await buyer.post(`/v1/classifieds/listings/${blocked.id}/${path}`)).json.error.code, 'seller_unavailable', path);
    }

    const busy = await customer('Yemi Ade');
    await prisma.classifiedContactRequest.createMany({ data: Array.from({ length: 10 }, () => ({ kind: 'contact', listingId: tv.id, buyerId: busy.id, sellerId: seller.id, country: 'NG', status: 'cancelled' })) });
    const limited = await busy.post(`/v1/classifieds/listings/${tv.id}/contact-requests`);
    assert.deepEqual([limited.status, limited.json.error.code], [429, 'contact_request_limit']);
  });
});

describe('Request a call back', () => {
  test("the seller is given the buyer's name, confirmed mobile and email while it waits", async () => {
    const seller = await customer('Gbenga Lawal', { phone: '+2348031120004' });
    const buyer = await customer('Ifeoma Nwosu');
    const tv = await live(seller, 'Toshiba 55 inch TV');

    const asked = await buyer.post(`/v1/classifieds/listings/${tv.id}/callbacks`, { note: 'After 5pm please' });
    assert.deepEqual([asked.status, asked.json.kind, asked.json.status], [201, 'callback', 'pending'], JSON.stringify(asked.json));
    assert.equal((await buyer.post(`/v1/classifieds/listings/${tv.id}/callbacks`)).json.id, asked.json.id, 'one open call back per listing');
    assert.equal(await notices(seller.id, 'customer.classifieds.callback_request'), 1);
    const notice = await prisma.notification.findFirstOrThrow({ where: { customerId: seller.id, type: 'customer.classifieds.callback_request' } });
    assert.doesNotMatch(`${notice.title} ${notice.body}`, new RegExp(buyer.phone.slice(-6)), 'never the number in a notice');
    assert.equal((await viewer(buyer, tv)).callback.request.status, 'pending');

    const incoming = (await seller.get('/v1/classifieds/me/contact-requests?kind=callback')).json.data[0];
    assert.deepEqual(incoming.with, { name: 'Ifeoma Nwosu', phone: buyer.phone, email: buyer.email });
    assert.equal(incoming.note, 'After 5pm please');
    assert.equal((await seller.post(`/v1/classifieds/contact-requests/${incoming.id}/accept`)).json.error.param, 'action');
    assert.equal((await seller.post(`/v1/classifieds/contact-requests/${incoming.id}/done`)).json.status, 'done');
    const done = (await seller.get('/v1/classifieds/me/contact-requests?kind=callback')).json.data[0];
    assert.deepEqual([done.with.phone, done.with.email], [null, null], 'once done, the details are no longer shown');
    assert.equal((await seller.get(`/v1/classifieds/me/listings/${tv.id}/stats`)).json.leads, 1);
  });

  test('needs a confirmed mobile, takes no messages-only listing, five an hour; the buyer may cancel', async () => {
    const seller = await customer('Rita Okon', { phone: '+2348031120005' });
    const buyer = await customer('Femi Ade');
    const tv = await live(seller, 'Philips 50 inch TV');
    const chatOnly = await live(seller, 'Philips speaker', { contact: 'chat' });
    assert.equal((await buyer.post(`/v1/classifieds/listings/${chatOnly.id}/callbacks`)).json.error.code, 'callback_not_offered');

    const asked = (await buyer.post(`/v1/classifieds/listings/${tv.id}/callbacks`)).json;
    assert.equal((await buyer.post(`/v1/classifieds/contact-requests/${asked.id}/cancel`)).json.status, 'cancelled');
    assert.equal((await seller.get('/v1/classifieds/me/contact-requests')).json.data.length, 0, 'cancelled ones are left out');

    // Only where the market cannot text is an account without a confirmed mobile (elsewhere none gets this far).
    const market = await prisma.country.findUniqueOrThrow({ where: { code: 'NG' } });
    await prisma.country.update({ where: { code: 'NG' }, data: { smsProvider: null } });
    await prisma.customer.update({ where: { id: buyer.id }, data: { phoneVerifiedAt: null } });
    try {
      assert.equal((await buyer.post(`/v1/classifieds/listings/${tv.id}/callbacks`)).json.error.code, 'phone_required');
    } finally {
      await prisma.country.update({ where: { code: 'NG' }, data: { smsProvider: market.smsProvider } });
      await prisma.customer.update({ where: { id: buyer.id }, data: { phoneVerifiedAt: new Date() } });
    }
    await prisma.classifiedContactRequest.createMany({ data: Array.from({ length: 4 }, () => ({ kind: 'callback', listingId: tv.id, buyerId: buyer.id, sellerId: seller.id, country: 'NG', status: 'cancelled' })) });
    assert.equal((await buyer.post(`/v1/classifieds/listings/${tv.id}/callbacks`)).json.error.code, 'callback_limit');
  });
});

describe('calls', () => {
  test('the Calls integration offers Test connection, which makes a short-lived credential', async () => {
    const admin = await adminClient(server);
    const listed = await admin.get('/v1/admin/integrations');
    assert.equal(listed.json.data.find(group => group.id === 'calls')?.testable, true);
    const tested = await admin.post('/v1/admin/integrations/calls/test');
    assert.equal(tested.status, 200, JSON.stringify(tested.json));
    assert.deepEqual([tested.json.ok, tested.json.message], [true, 'Calls will be relayed through 2 TURN addresses.']);
  });

  test('a listing takes chat and calls unless the seller chooses otherwise', async () => {
    const seller = await customer('Ada Okafor', { phone: '+2348031120019' });
    const cat = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } });
    const draft = await seller.post('/v1/classifieds/listings', { title: 'Samsung 43 inch TV', category_id: cat.id });
    assert.equal(draft.json.contact, 'both', JSON.stringify(draft.json));
  });

  test('ring an online seller, answer, swap connection details through the relay, then end', async () => {
    const seller = await customer('Obi Nnamdi', { phone: '+2348031120006' });
    const buyer = await customer('Zainab Musa');
    const tv = await live(seller, 'Haier 32 inch TV');

    const offline = await buyer.post(`/v1/classifieds/listings/${tv.id}/calls`);
    assert.deepEqual([offline.status, offline.json.error.code], [409, 'seller_offline']);
    assert.equal((await viewer(buyer, tv)).seller_online, false);
    const here = await seller.post('/v1/classifieds/presence');
    assert.deepEqual([here.status, here.json.calls, here.json.incoming], [200, true, null]);
    const view = await viewer(buyer, tv);
    assert.deepEqual([view.seller_online, view.calls], [true, true]);

    const started = await buyer.post(`/v1/classifieds/listings/${tv.id}/calls`);
    assert.equal(started.status, 201, JSON.stringify(started.json));
    const call = started.json;
    assert.deepEqual([call.status, call.role, call.with.name], ['ringing', 'caller', 'Obi N.']);
    assert.deepEqual(call.ice_servers, [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u-1', credential: 'c-1' }], 'the relay only, never port 53');
    assert.ok(!JSON.stringify(call).includes(seller.phone), 'never a number');
    assert.equal(await notices(seller.id, 'customer.classifieds.call_incoming'), 1);
    assert.equal((await buyer.post(`/v1/classifieds/listings/${tv.id}/calls`)).json.error.code, 'call_in_progress');
    const other = await customer('Lola Ige');
    assert.equal((await other.post(`/v1/classifieds/listings/${tv.id}/calls`)).json.error.code, 'seller_busy');

    const ringing = (await seller.post('/v1/classifieds/presence')).json.incoming;
    assert.deepEqual([ringing.id, ringing.role, ringing.with.name, ringing.listing.title], [call.id, 'callee', 'Zainab M.', 'Haier 32 inch TV']);
    assert.equal((await buyer.post(`/v1/classifieds/calls/${call.id}/answer`)).status, 404, 'only the seller answers');
    const answered = await seller.post(`/v1/classifieds/calls/${call.id}/answer`);
    assert.deepEqual([answered.status, answered.json.status, answered.json.ice_servers.length], [200, 'answered', 1]);

    const offer = await buyer.post(`/v1/classifieds/calls/${call.id}/signals`, { kind: 'offer', payload: { type: 'offer', sdp: 'v=0 offer', extra: 'dropped' } });
    assert.equal(offer.status, 201, JSON.stringify(offer.json));
    await buyer.post(`/v1/classifieds/calls/${call.id}/signals`, { kind: 'candidate', payload: { candidate: 'candidate:1 1 udp 1 1.2.3.4 3478 typ relay', sdpMid: '0', sdpMLineIndex: 0 } });
    assert.equal((await buyer.post(`/v1/classifieds/calls/${call.id}/signals`, { kind: 'offer', payload: { type: 'answer', sdp: 'x' } })).json.error.param, 'payload');
    assert.equal((await other.get(`/v1/classifieds/calls/${call.id}`)).status, 404, 'only the two sides');

    const polled = await seller.get(`/v1/classifieds/calls/${call.id}`);
    assert.deepEqual(polled.json.signals.map(signal => signal.kind), ['offer', 'candidate']);
    assert.deepEqual(polled.json.signals[0].payload, { type: 'offer', sdp: 'v=0 offer' });
    await seller.post(`/v1/classifieds/calls/${call.id}/signals`, { kind: 'answer', payload: { type: 'answer', sdp: 'v=0 answer' } });
    const mine = await buyer.get(`/v1/classifieds/calls/${call.id}?after=${polled.json.signals.at(-1).id}`);
    assert.deepEqual(mine.json.signals.map(signal => signal.kind), ['answer'], "only the other side's, after the last read");

    const ended = await buyer.post(`/v1/classifieds/calls/${call.id}/end`);
    assert.equal(ended.json.status, 'ended');
    assert.equal(await prisma.classifiedCallSignal.count({ where: { callId: call.id } }), 0, 'connection details deleted');
    assert.deepEqual((await seller.get(`/v1/classifieds/calls/${call.id}`)).json.signals, []);
    assert.deepEqual((await seller.get('/v1/classifieds/me/calls')).json.data.map(row => [row.role, row.status]), [['callee', 'ended']]);
  });

  test('a chat says who is online and whether a call can be made; either side calls the other from it', async () => {
    const seller = await customer('Ngozi Eze', { phone: '+2348031120008' });
    const buyer = await customer('Kola Ade');
    const tv = await live(seller, 'TCL 43 inch TV');
    const speaker = await live(seller, 'TCL speaker', { contact: 'chat' });
    const chat = (await buyer.post('/v1/classifieds/conversations', { listing_id: tv.id, body: 'Still there?' })).json;
    const quiet = (await buyer.post('/v1/classifieds/conversations', { listing_id: speaker.id, body: 'Still there?' })).json;

    const before = (await buyer.get('/v1/classifieds/conversations')).json.data.find(row => row.id === chat.id);
    assert.deepEqual([before.with.online, before.can_call], [false, true]);
    await seller.post('/v1/classifieds/presence');
    const listed = (await buyer.get('/v1/classifieds/conversations')).json.data;
    assert.equal(listed.find(row => row.id === chat.id).with.online, true);
    assert.equal(listed.find(row => row.id === quiet.id).can_call, false, 'a buyer never calls a seller who takes messages only');
    assert.equal((await seller.get(`/v1/classifieds/conversations/${quiet.id}`)).json.can_call, true, 'the seller may call them back');
    assert.equal((await buyer.post(`/v1/classifieds/conversations/${quiet.id}/calls`)).json.error.code, 'calls_not_offered');

    const offline = await seller.post(`/v1/classifieds/conversations/${quiet.id}/calls`);
    assert.deepEqual([offline.status, offline.json.error.code], [409, 'buyer_offline']);
    await buyer.post('/v1/classifieds/presence');
    const back = await seller.post(`/v1/classifieds/conversations/${quiet.id}/calls`);
    assert.equal(back.status, 201, JSON.stringify(back.json));
    assert.deepEqual([back.json.role, back.json.with.name], ['caller', 'Kola A.']);
    const ringing = (await buyer.post('/v1/classifieds/presence')).json.incoming;
    assert.deepEqual([ringing.id, ringing.role, ringing.with.name], [back.json.id, 'callee', 'Ngozi E.']);
    const notice = await prisma.notification.findFirstOrThrow({ where: { customerId: buyer.id, type: 'customer.classifieds.call_incoming' } });
    assert.match(notice.link, /^\/ng\/l\//, "the buyer's notice opens the listing");
    await buyer.post(`/v1/classifieds/calls/${back.json.id}/end`);

    assert.equal((await (await customer('Ife Obi')).post(`/v1/classifieds/conversations/${chat.id}/calls`)).status, 404, 'only the two sides');
    await seller.post(`/v1/classifieds/conversations/${chat.id}/block`);
    assert.equal((await buyer.post(`/v1/classifieds/conversations/${chat.id}/calls`)).json.error.code, 'conversation_blocked');
    assert.equal((await buyer.get(`/v1/classifieds/conversations/${chat.id}`)).json.can_call, false);
  });

  test('unanswered calls are missed (the seller told once), declined or cancelled; a quiet side ends a call', async () => {
    const seller = await customer('Sade Ojo', { phone: '+2348031120007' });
    const buyer = await customer('Uche Eze');
    const tv = await live(seller, 'Sharp 40 inch TV');
    const chatOnly = await live(seller, 'Sharp microwave', { contact: 'chat' });
    await seller.post('/v1/classifieds/presence');
    assert.equal((await buyer.post(`/v1/classifieds/listings/${chatOnly.id}/calls`)).json.error.code, 'calls_not_offered');

    const missed = (await buyer.post(`/v1/classifieds/listings/${tv.id}/calls`)).json;
    await prisma.classifiedCall.update({ where: { id: missed.id }, data: { createdAt: new Date(Date.now() - 60_000) } });
    assert.equal((await seller.post('/v1/classifieds/presence')).json.incoming, null);
    assert.equal((await buyer.get(`/v1/classifieds/calls/${missed.id}`)).json.status, 'missed');
    assert.equal(await notices(seller.id, 'customer.classifieds.call_missed'), 1);
    assert.equal((await seller.post(`/v1/classifieds/calls/${missed.id}/answer`)).json.error.code, 'call_ended');

    const declined = (await buyer.post(`/v1/classifieds/listings/${tv.id}/calls`)).json;
    assert.equal((await seller.post(`/v1/classifieds/calls/${declined.id}/end`)).json.status, 'declined');
    const cancelled = (await buyer.post(`/v1/classifieds/listings/${tv.id}/calls`)).json;
    assert.equal((await buyer.post(`/v1/classifieds/calls/${cancelled.id}/end`)).json.status, 'cancelled');

    const quiet = (await buyer.post(`/v1/classifieds/listings/${tv.id}/calls`)).json;
    await seller.post(`/v1/classifieds/calls/${quiet.id}/answer`);
    await prisma.classifiedCall.update({ where: { id: quiet.id }, data: { callerSeenAt: new Date(Date.now() - 60_000) } });
    const { CallsService } = await import('../dist/classifieds/calls.service.js');
    const job = await server.app.get(CallsService).job();
    assert.ok(job.settled >= 1);
    assert.equal((await prisma.classifiedCall.findUniqueOrThrow({ where: { id: quiet.id } })).status, 'lost');
    assert.equal(await notices(seller.id, 'customer.classifieds.call_missed'), 1, 'only a missed call is told');

    await prisma.classifiedCall.update({ where: { id: missed.id }, data: { createdAt: new Date(Date.now() - 91 * 86_400_000) } });
    const old = await prisma.classifiedContactRequest.create({ data: { kind: 'callback', listingId: tv.id, buyerId: buyer.id, sellerId: seller.id, country: 'NG', status: 'done', answeredAt: new Date(Date.now() - 366 * 86_400_000) } });
    const later = await server.app.get(CallsService).job();
    assert.ok(later.deleted >= 1 && later.old_requests >= 1);
    assert.equal(await prisma.classifiedCall.count({ where: { id: missed.id } }), 0, 'calls kept 90 days');
    assert.equal(await prisma.classifiedContactRequest.count({ where: { id: old.id } }), 0, 'answered requests kept 12 months');
  });
});
