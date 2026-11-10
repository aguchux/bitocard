// Udozo Connect, phase 4 (docs/UDOZO_CONNECT_PLAN.md): listings shipped through Udozo Connect, to Connect Centres in the
// states the seller ticks at their own charge per state, through every active centre there or those chosen; checked
// against the market's switch, Connect's states and its centres, and shown to buyers only where an open centre takes it.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let admin;
let place;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  const [tvs, ikeja, gwarinpa] = await Promise.all([
    prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }),
    prisma.classifiedArea.findFirstOrThrow({ where: { country: 'NG', kind: 'area', slug: 'ikeja' } }),
    prisma.classifiedArea.findFirstOrThrow({ where: { country: 'NG', kind: 'area', slug: 'gwarinpa' } }),
  ]);
  const kano = await prisma.classifiedArea.findFirstOrThrow({ where: { country: 'NG', kind: 'state', slug: 'kano' } });
  const accra = await prisma.classifiedArea.findFirst({ where: { country: 'GH', kind: 'state' } });
  place = { tvs: tvs.id, ikeja, gwarinpa, lagos: ikeja.parentId, fct: gwarinpa.parentId, kano: kano.id, accra: accra?.id ?? null };
});

after(() => server?.close());

const shipping = enabled => admin.put('/v1/admin/switches/connect_shipping', { country_code: 'NG', enabled });

function storeServer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `ship-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body) };
}

let counter = 0;
async function seller() {
  const shopper = storeServer();
  const email = `shipper${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Chinedu Okafor', email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, shopper);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
  shopper.id = signup.json.customer.id;
  return shopper;
}

/** A Connect Centre in an area, as approval makes one. */
async function centre(area, name, status = 'active') {
  const partner = await prisma.customer.findFirstOrThrow({ where: { country: 'NG' } });
  return prisma.connectCentre.create({
    data: { partnerId: partner.id, country: 'NG', stateId: area.parentId, areaId: area.id, name, address: '1 Market Road', hours: 'Mon to Sat, 8am to 6pm', phone: '08031234567', capacity: 40, status, depositMinor: 5_000_000n, currency: 'NGN', photos: [] },
  });
}

const draftBody = extra => ({ title: 'Samsung 43 inch TV', price: 25000000, condition: 'used', category_id: place.tvs, area_id: place.ikeja.id, stock: 1, ...extra });

async function draft(owner, extra = {}) {
  const made = await owner.post('/v1/classifieds/listings', draftBody(extra));
  assert.equal(made.status, 201, JSON.stringify(made.json));
  return made.json;
}

async function submit(owner, listing) {
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: listing.id, kind: 'photo', position, url: `https://media.test/${listing.id}-${position}.jpg` })) });
  const submitted = await owner.post(`/v1/classifieds/listings/${listing.id}/submit`);
  // A new seller's first listings wait for review: these are published as a moderator would.
  if (submitted.status === 200) await prisma.classifiedListing.update({ where: { id: listing.id }, data: { status: 'active', publishedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86_400_000) } });
  return submitted;
}

describe('Shipping listings through Udozo Connect', () => {
  test('closed in the market: none can be set, and turning it off is always allowed', async () => {
    await shipping(false);
    const owner = await seller();
    const refused = await owner.post('/v1/classifieds/listings', draftBody({ connect: true }));
    assert.deepEqual([refused.status, refused.json.error.code, refused.json.error.param], [400, 'connect_unavailable', 'connect']);
    const listing = await draft(owner);
    assert.equal((await owner.patch(`/v1/classifieds/listings/${listing.id}`, { connect: false })).status, 200);
    const markets = (await storeServer().get('/v1/classifieds/markets')).json.data;
    assert.equal(markets.find(row => row.country === 'NG').connect_shipping, false);
  });

  test('a seller ticks states with their own charges; buyers see the states an open centre takes it to', async () => {
    await shipping(true);
    assert.equal((await storeServer().get('/v1/classifieds/markets')).json.data.find(row => row.country === 'NG').connect_shipping, true);
    await centre(place.ikeja, 'Ikeja Parcel Hub');
    await centre(place.ikeja, 'Allen Avenue Point');
    const owner = await seller();
    const listing = await draft(owner, { connect: true, connect_states: [{ state_id: place.lagos, shipping: 150000 }, { state_id: place.fct, shipping: 0 }], connect_centres: null });
    assert.equal(listing.connect.enabled, true);
    assert.equal(listing.connect.all_centres, true);
    assert.deepEqual(listing.connect.states.map(row => [row.state.id, row.shipping]).sort(), [[place.fct, 0], [place.lagos, 150000]].sort());

    const live = await submit(owner, listing);
    assert.equal(live.status, 200, JSON.stringify(live.json));
    const page = (await storeServer().get(`/v1/classifieds/listings/${live.json.ref}?country=NG`)).json;
    // The FCT has no open centre yet, so only Lagos is shown, with both of its centres.
    assert.deepEqual(page.connect, { states: [{ id: place.lagos, slug: 'lagos', name: 'Lagos', shipping: 150000, centres: 2 }] });

    // Closing Connect shipping hides it from buyers, while the listing keeps its choice.
    await shipping(false);
    assert.equal((await storeServer().get(`/v1/classifieds/listings/${live.json.ref}?country=NG`)).json.connect, null);
    assert.equal((await owner.get(`/v1/classifieds/me/listings/${listing.id}`)).json.connect.enabled, true);
    await shipping(true);
  });

  test("states and centres are checked: the market's, open for Connect, and centres open in a ticked state", async () => {
    await shipping(true);
    const owner = await seller();
    const listing = await draft(owner);
    const patch = body => owner.patch(`/v1/classifieds/listings/${listing.id}`, body);
    const error = async body => {
      const res = await patch(body);
      return [res.status, res.json.error?.code, res.json.error?.param];
    };
    assert.deepEqual(await error({ connect_states: [{ state_id: place.ikeja.id, shipping: 0 }] }), [400, 'parameter_invalid', 'connect_states[0].state_id'], 'an area is not a state');
    if (place.accra) assert.deepEqual(await error({ connect_states: [{ state_id: place.accra, shipping: 0 }] }), [400, 'parameter_invalid', 'connect_states[0].state_id'], "another country's state");
    assert.deepEqual((await error({ connect_states: [{ state_id: place.lagos, shipping: -1 }] })).slice(0, 2), [400, 'parameter_invalid'], 'a charge below nothing');
    assert.deepEqual(await error({ connect_states: [{ state_id: place.lagos, shipping: 0 }, { state_id: place.lagos, shipping: 5 }] }), [400, 'parameter_invalid', 'connect_states']);

    await admin.put(`/v1/admin/connect/states/${place.kano}`, { enabled: false });
    assert.deepEqual(await error({ connect_states: [{ state_id: place.kano, shipping: 0 }] }), [400, 'state_unavailable', 'connect_states[0].state_id']);

    const ikeja = await centre(place.ikeja, 'Checked Hub');
    const paused = await centre(place.ikeja, 'Paused Hub', 'paused');
    const abuja = await centre(place.gwarinpa, 'Gwarinpa Hub');
    assert.equal((await patch({ connect: true, connect_states: [{ state_id: place.lagos, shipping: 100000 }] })).status, 200);
    assert.deepEqual(await error({ connect_centres: [abuja.id] }), [400, 'centre_unavailable', 'connect_centres[0]'], 'a centre in a state it does not ship to');
    assert.deepEqual(await error({ connect_centres: [ikeja.id, paused.id] }), [400, 'centre_unavailable', 'connect_centres[1]'], 'a paused centre');
    assert.deepEqual(await error({ price_kind: 'on_request' }), [400, 'connect_price_required', 'price_kind'], 'UdozoPay needs a price');
  });

  test('chosen centres: only those take it, and they follow the states ticked', async () => {
    await shipping(true);
    const one = await centre(place.ikeja, 'Chosen Hub');
    await centre(place.ikeja, 'Not Chosen Hub');
    const abuja = await centre(place.gwarinpa, 'Wuse Hub');
    const owner = await seller();
    const listing = await draft(owner, { connect: true, connect_states: [{ state_id: place.lagos, shipping: 200000 }, { state_id: place.fct, shipping: 300000 }], connect_centres: [one.id, abuja.id] });
    assert.equal(listing.connect.all_centres, false);
    assert.deepEqual(listing.connect.centres.map(row => row.id).sort(), [one.id, abuja.id].sort());
    assert.match(listing.connect.centres[0].number, /^CC-\d{6}$/);

    const live = await submit(owner, listing);
    assert.equal(live.status, 200, JSON.stringify(live.json));
    const page = (await storeServer().get(`/v1/classifieds/listings/${live.json.ref}?country=NG`)).json;
    assert.deepEqual(page.connect.states.map(row => [row.id, row.centres]).sort(), [[place.fct, 1], [place.lagos, 1]].sort());

    // Ticking Lagos only drops the FCT's centre; ticking no centre on a live listing is refused.
    const changed = (await owner.patch(`/v1/classifieds/listings/${listing.id}`, { connect_states: [{ state_id: place.lagos, shipping: 200000 }] })).json;
    assert.deepEqual(changed.connect.centres.map(row => row.id), [one.id]);
    const empty = await owner.patch(`/v1/classifieds/listings/${listing.id}`, { connect_centres: [] });
    assert.deepEqual([empty.status, empty.json.error.code, empty.json.error.param], [400, 'listing_incomplete', 'connect_centres']);
    assert.equal((await owner.patch(`/v1/classifieds/listings/${listing.id}`, { connect_centres: null })).json.connect.all_centres, true, 'back to every centre');
  });

  test('a listing may be handed over only through Connect; submitting needs its states', async () => {
    await shipping(true);
    await centre(place.ikeja, 'Only Connect Hub');
    const owner = await seller();
    const listing = await draft(owner, { pickup: false, connect: true });
    const incomplete = await submit(owner, listing);
    assert.deepEqual([incomplete.status, incomplete.json.error.code, incomplete.json.error.param], [400, 'listing_incomplete', 'connect_states']);
    assert.equal((await owner.patch(`/v1/classifieds/listings/${listing.id}`, { connect_states: [{ state_id: place.lagos, shipping: 0 }] })).status, 200);
    const off = await owner.patch(`/v1/classifieds/listings/${listing.id}`, { connect: false });
    assert.deepEqual([off.status, off.json.error.code], [400, 'fulfilment_required'], 'some way to hand it over');
    assert.equal((await owner.post(`/v1/classifieds/listings/${listing.id}/submit`)).status, 200);
  });
});
