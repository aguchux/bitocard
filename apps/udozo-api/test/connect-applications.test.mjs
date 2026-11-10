// Udozo Connect, phase 2 (docs/UDOZO_CONNECT_PLAN.md): a Udozo customer applies to run a Connect Centre (the office, its
// photos, the person in charge), meets the requirements (identity check, confirmed mobile, the agreement, the market's
// deposit in their UdozoPay wallet) and submits it, which takes the deposit; Udozo's team asks for changes, schedules a
// visit by staff or a trained agent, records it and approves (a centre is made) or rejects (the deposit goes back). Behind
// `connect_applications` per market, each state open unless switched off.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

/** A PNG header of the given size (the check reads the IHDR chunk). */
function png(width, height) {
  const bytes = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

/** A fake Spaces bucket (path-style): PUTs, server-side copies, reads and deletes. */
async function fakeSpaces() {
  const objects = new Map();
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const key = decodeURIComponent(url.pathname.split('/').slice(2).join('/'));
    if (req.method === 'PUT' && req.headers['x-amz-copy-source']) {
      const source = objects.get(decodeURIComponent(String(req.headers['x-amz-copy-source']).split('/').slice(2).join('/')));
      if (!source) return res.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>');
      objects.set(key, { body: source.body, type: req.headers['content-type'] });
      return res.writeHead(200).end('<CopyObjectResult></CopyObjectResult>');
    }
    if (req.method === 'PUT') {
      objects.set(key, { body: Buffer.concat(chunks), type: req.headers['content-type'] });
      return res.writeHead(200).end();
    }
    const object = objects.get(key);
    if (req.method === 'DELETE') {
      objects.delete(key);
      return res.writeHead(204).end();
    }
    if (!object) return res.writeHead(404).end();
    if (req.method === 'HEAD') return res.writeHead(200, { 'content-length': object.body.length, 'content-type': object.type }).end();
    const range = /bytes=0-(\d+)/.exec(req.headers.range ?? '');
    res.writeHead(range ? 206 : 200, { 'content-type': object.type }).end(range ? object.body.subarray(0, Number(range[1]) + 1) : object.body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, objects, close: () => new Promise(resolve => server.close(resolve)) };
}

let server;
let spaces;
let prisma;
let admin;
let ledger;
let house;

before(async () => {
  spaces = await fakeSpaces();
  server = await startApp({
    env: {
      APP_PRODUCT: 'udozo',
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      SPACES_KEY: 'DO00TESTKEY',
      SPACES_SECRET: 'test-secret',
      SPACES_BUCKET: 'udozo-media',
      SPACES_REGION: 'nyc3',
      SPACES_ENDPOINT: spaces.url,
      SPACES_PUBLIC_URL: 'https://media.udozo.test',
      SPACES_ROOT: 'test',
    },
  });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  ledger = server.app.get((await import('../dist/ledger/ledger.service.js')).LedgerService);
  house = server.app.get((await import('../dist/checkout/house.service.js')).HouseService);
  admin = await adminClient(server);
});

after(async () => {
  await server?.close();
  await spaces?.close();
});

function storeServer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `connect-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body), del: path => request('DELETE', path) };
}

let counter = 0;
async function customer(name = 'Ngozi Eze') {
  const shopper = storeServer();
  const email = `connect${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, shopper);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  shopper.name = name;
  return shopper;
}

/** Their identity check passed (live). */
async function checked(person) {
  const reseller = await house.resellerFor('NG');
  await prisma.identityVerification.create({
    data: { subject: 'customer', resellerId: reseller.id, mode: 'live', customerReference: person.id, method: 'document', provider: 'test', providerReference: randomUUID(), status: 'approved', country: 'NG', consentAt: new Date(), verifiedName: person.name },
  });
}

async function fund(person, amount) {
  await ledger.post({
    mode: 'live',
    type: 'adjustment',
    reference: `test-fund:${randomUUID()}`,
    description: 'Test top-up',
    lines: [
      { account: { kind: 'adjustments', currency: 'NGN' }, debit: BigInt(amount) },
      { account: { kind: 'customer_wallet', currency: 'NGN', customerId: person.id }, credit: BigInt(amount) },
    ],
  });
}

const balance = async (kind, customerId) => (await prisma.ledgerAccount.findFirst({ where: { kind, mode: 'live', currency: 'NGN', customerId } }))?.balanceMinor ?? 0n;

async function ikeja() {
  const area = await prisma.classifiedArea.findFirst({ where: { country: 'NG', kind: 'area', slug: 'ikeja' } });
  return area;
}

const office = async () => ({
  business_name: 'Mama Ngozi Phones',
  registration_number: 'BN 1234567',
  area_id: (await ikeja()).id,
  address: '12 Allen Avenue, Ikeja, Lagos',
  landmark: 'Opposite the filling station',
  hours: 'Mon to Sat, 8am to 6pm',
  phone: '0803 123 4567',
  capacity: 40,
  person_name: 'Ngozi Eze',
  person_role: 'Owner',
});

/** Uploads like connect.udozo.com does: ask for a link, PUT the bytes with its headers, then attach it. */
async function photo(person, id, kind) {
  const bytes = png(800, 600);
  const created = await person.post(`/v1/connect/applications/${id}/photos/uploads`, { filename: `${kind}.png`, content_type: 'image/png', size: bytes.length });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  await fetch(created.json.upload.url, { method: 'PUT', headers: created.json.upload.headers, body: bytes });
  return person.post(`/v1/connect/applications/${id}/photos`, { media_id: created.json.id, kind });
}

/** A full application, ready to submit: details, the three photos, the agreement. */
async function ready(person) {
  const made = await person.post('/v1/connect/applications', await office());
  assert.equal(made.status, 201, JSON.stringify(made.json));
  for (const kind of ["shopfront", "counter", "storage"]) { const added = await photo(person, made.json.id, kind); assert.equal(added.status, 200, JSON.stringify(added.json)); }
  const settings = (await person.get('/v1/connect/apply')).json;
  await person.post('/v1/connect/agreement/accept', { version: settings.agreement.version });
  return made.json.id;
}

describe('Connect Centre applications', () => {
  test('closed until the switch is on for the market, with the deposit, states and agreement on the way in', async () => {
    const person = await customer();
    const closed = await person.get('/v1/connect/apply');
    assert.equal(closed.status, 200);
    assert.deepEqual([closed.json.open, closed.json.deposit, closed.json.application_id], [false, null, null]);
    assert.equal((await person.post('/v1/connect/applications', {})).json.error.code, 'connect_unavailable');

    assert.equal((await admin.put('/v1/admin/switches/connect_applications', { country_code: 'NG', enabled: true })).status, 200);
    assert.equal((await admin.put('/v1/admin/connect/settings/NG', { deposit: 5_000_000 })).status, 200);
    const open = (await person.get('/v1/connect/apply')).json;
    assert.deepEqual([open.open, open.deposit], [true, { amount: 5_000_000, currency: 'NGN' }]);
    assert.ok(open.states.some(state => state.name === 'Lagos' && state.open));
    assert.deepEqual(open.agreement, { version: '2026-11-09', path: '/legal/connect-centres', accepted: false });
    assert.deepEqual(open.photos.required, ['shopfront', 'counter', 'storage']);
    assert.equal((await person.post('/v1/connect/agreement/accept', { version: '2020-01-01' })).json.error.code, 'agreement_changed');
  });

  test('a draft is saved as they go, each field checked; one application at a time', async () => {
    const person = await customer();
    const draft = await person.post('/v1/connect/applications', { business_name: 'Eze Ventures' });
    assert.equal(draft.status, 201);
    assert.deepEqual([draft.json.number.startsWith('CA-'), draft.json.status, draft.json.editable], [true, 'draft', true]);
    assert.deepEqual(draft.json.requirements.map(item => [item.key, item.met]), [
      ['details', false], ['photos', false], ['state', true], ['identity', false], ['mobile', true], ['agreement', false], ['deposit', false],
    ]);
    assert.equal((await person.post('/v1/connect/applications', {})).json.error.code, 'application_open');
    for (const [body, param] of [[{ address: 'short' }, 'address'], [{ phone: 'call me' }, 'phone'], [{ business_name: 'See www.example.com' }, 'business_name'], [{ area_id: randomUUID() }, 'area_id']]) {
      const refused = await person.patch(`/v1/connect/applications/${draft.json.id}`, body);
      assert.deepEqual([refused.status, refused.json.error.param], [400, param]);
    }
    const saved = await person.patch(`/v1/connect/applications/${draft.json.id}`, await office());
    assert.deepEqual([saved.json.state.name, saved.json.area.name, saved.json.capacity, saved.json.phone], ['Lagos', 'Ikeja', 40, '08031234567']);
    // Nobody else reaches it.
    assert.equal((await (await customer('Chidi Obi')).get(`/v1/connect/applications/${draft.json.id}`)).status, 404);
  });

  test('submitting needs every requirement, takes the deposit once, and Udozo’s team approves it into a centre', async () => {
    const person = await customer();
    const id = await ready(person);
    const missing = await person.post(`/v1/connect/applications/${id}/submit`);
    assert.deepEqual([missing.status, missing.json.error.code, missing.json.error.param], [400, 'application_incomplete', 'identity']);
    await checked(person);
    assert.equal((await person.post(`/v1/connect/applications/${id}/submit`)).json.error.param, 'deposit', 'the deposit must be in the wallet');
    await fund(person, 6_000_000);
    assert.equal((await person.post(`/v1/connect/applications/${id}/submit`, { expected_deposit: 1 })).json.error.code, 'deposit_changed');
    const sent = await person.post(`/v1/connect/applications/${id}/submit`, { expected_deposit: 5_000_000 });
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    assert.deepEqual([sent.json.status, sent.json.deposit.amount, sent.json.editable], ['submitted', 5_000_000, false]);
    assert.deepEqual([await balance('customer_wallet', person.id), await balance('connect_centre_deposit', person.id)], [1_000_000n, 5_000_000n]);
    assert.ok(await prisma.notification.findFirst({ where: { type: 'admin.connect.application' } }), 'admins are told');
    assert.equal((await person.patch(`/v1/connect/applications/${id}`, { capacity: 10 })).json.error.code, 'application_locked');

    // Udozo asks for a change; the applicant makes it and sends it back without paying again.
    const support = await adminClient(server, ['support']);
    assert.equal((await support.get(`/v1/admin/connect/applications/${id}`)).status, 200, 'support reads');
    assert.equal((await support.post(`/v1/admin/connect/applications/${id}/approve`)).status, 403, 'only operations decide');
    const listed = (await admin.get('/v1/admin/connect/applications?country=NG')).json;
    assert.ok(listed.data.some(row => row.id === id && row.applicant.id === person.id));
    assert.equal((await admin.post(`/v1/admin/connect/applications/${id}/request-changes`, { note: 'Add a photo of the storage room with the shelves.' })).json.status, 'changes_requested');
    const asked = (await person.get(`/v1/connect/applications/${id}`)).json;
    assert.deepEqual([asked.status, asked.changes.note, asked.editable], ['changes_requested', 'Add a photo of the storage room with the shelves.', true]);
    assert.equal((await photo(person, id, 'storage')).status, 200);
    assert.equal((await person.post(`/v1/connect/applications/${id}/submit`)).json.status, 'submitted');
    assert.equal(await balance('connect_centre_deposit', person.id), 5_000_000n, 'the deposit was taken once');

    // A visit: never by an untrained agent; the applicant confirms it; the visitor's report is the team's.
    const agent = (await admin.post('/v1/admin/connect/visitors', { country: 'NG', name: 'Tunde Agent', kind: 'agent', phone: '08030000000' })).json;
    assert.equal(agent.can_visit, false);
    const at = new Date(Date.now() + 3 * 86_400_000).toISOString();
    assert.equal((await admin.post(`/v1/admin/connect/applications/${id}/visit`, { visitor_id: agent.id, at })).json.error.code, 'visitor_untrained');
    assert.equal((await admin.patch(`/v1/admin/connect/visitors/${agent.id}`, { trained: true })).json.can_visit, true);
    assert.equal((await admin.post(`/v1/admin/connect/applications/${id}/visit`, { visitor_id: agent.id, at: '2020-01-01T10:00:00Z' })).json.error.param, 'at');
    const scheduled = await admin.post(`/v1/admin/connect/applications/${id}/visit`, { visitor_id: agent.id, at, note: 'Please have the storage room open.' });
    assert.equal(scheduled.json.status, 'visit_scheduled');
    assert.equal((await admin.post(`/v1/admin/connect/applications/${id}/approve`)).json.error.code, 'application_not_reviewable');
    const confirmed = (await person.post(`/v1/connect/applications/${id}/visit/confirm`)).json;
    assert.deepEqual([confirmed.visit.visitor.name, Boolean(confirmed.visit.confirmed_at)], ['Tunde Agent', true]);
    assert.equal('report' in confirmed.visit, false);
    assert.equal((await admin.post(`/v1/admin/connect/applications/${id}/visit/result`, { passed: true, report: 'Clean, secure storage room with shelves.' })).json.status, 'visited');

    const approved = await admin.post(`/v1/admin/connect/applications/${id}/approve`);
    assert.equal(approved.status, 200, JSON.stringify(approved.json));
    assert.equal(approved.json.status, 'approved');
    const centre = await prisma.connectCentre.findUnique({ where: { id: approved.json.centre.id } });
    assert.deepEqual([centre.partnerId, centre.name, centre.status, Number(centre.depositMinor), centre.photos.length], [person.id, 'Mama Ngozi Phones', 'active', 5_000_000, 4]);
    assert.match((await person.get(`/v1/connect/applications/${id}`)).json.centre.number, /^CC-\d{6}$/);
    assert.ok((await admin.get('/v1/admin/connect/centres?country=NG')).json.data.some(row => row.id === centre.id));
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'connect_application.approved', targetId: id } }));
    assert.ok(await prisma.connectCentreMember.findFirst({ where: { centreId: centre.id, customerId: person.id, role: 'owner' } }), 'the applicant owns it on connect.udozo.com');
    assert.equal(await balance('connect_centre_deposit', person.id), 5_000_000n, 'the centre keeps its deposit');
  });

  test('rejected or withdrawn, the deposit goes back to the wallet once', async () => {
    const person = await customer();
    await checked(person);
    await fund(person, 5_000_000);
    const id = await ready(person);
    assert.equal((await person.post(`/v1/connect/applications/${id}/submit`)).json.status, 'submitted');
    assert.equal(await balance('customer_wallet', person.id), 0n);
    const rejected = await admin.post(`/v1/admin/connect/applications/${id}/reject`, { reason: 'The office is too small for storage.' });
    assert.equal(rejected.json.status, 'rejected');
    assert.deepEqual([await balance('customer_wallet', person.id), await balance('connect_centre_deposit', person.id)], [5_000_000n, 0n]);
    assert.equal((await admin.post(`/v1/admin/connect/applications/${id}/reject`, { reason: 'Again' })).json.error.code, 'application_not_reviewable');

    // A new application, withdrawn by the applicant.
    const again = await ready(person);
    assert.equal((await person.post(`/v1/connect/applications/${again}/submit`)).json.status, 'submitted');
    assert.equal((await person.post(`/v1/connect/applications/${again}/withdraw`)).json.status, 'withdrawn');
    assert.equal(await balance('customer_wallet', person.id), 5_000_000n);
  });

  test('a state switched off takes no application; the deposit is finance’s, set after the authenticator', async () => {
    const lagos = await prisma.classifiedArea.findFirst({ where: { country: 'NG', kind: 'state', slug: 'lagos' } });
    assert.equal((await admin.put(`/v1/admin/connect/states/${lagos.id}`, { enabled: false })).json.open, false);
    const person = await customer();
    await checked(person);
    await fund(person, 5_000_000);
    const id = await ready(person);
    const refused = await person.post(`/v1/connect/applications/${id}/submit`);
    assert.deepEqual([refused.json.error.code, refused.json.error.param], ['application_incomplete', 'state']);
    assert.ok((await admin.get('/v1/admin/connect/states/NG')).json.data.some(state => state.id === lagos.id && !state.open));
    assert.equal((await admin.put(`/v1/admin/connect/states/${lagos.id}`, { enabled: true })).json.open, true);
    assert.equal((await person.post(`/v1/connect/applications/${id}/submit`)).json.status, 'submitted');

    const support = await adminClient(server, ['support']);
    assert.equal((await support.put('/v1/admin/connect/settings/NG', { deposit: 1 })).status, 403);
    assert.equal((await admin.get('/v1/admin/connect/settings/NG')).json.deposit, 5_000_000);
  });

  test('connect.udozo.com is one of the sites a customer may be handed to signed in', async () => {
    const handoff = server.app.get((await import('../dist/customers/handoff.service.js')).HandoffService);
    assert.equal(await handoff.target('https://connect.udozo.com'), 'https://connect.udozo.com');
    assert.equal(await handoff.target('https://connect.udozo.com.evil.test'), null);
  });
});
