// Udozo Connect, phase 3 (docs/UDOZO_CONNECT_PLAN.md): an approved Connect Centre's own people on connect.udozo.com (the
// owner who applied, managers and staff the owner adds), its settings, holiday pauses and storage places; Udozo's team
// pausing, reinstating and closing it; and the public list of active centres for buyers and sellers.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let admin;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server);
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
        ...(method === 'POST' ? { 'idempotency-key': `centre-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json, headers: res.headers };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body), del: path => request('DELETE', path) };
}

let counter = 0;
async function customer(name, { mobile = true } = {}) {
  const shopper = storeServer();
  const email = `centre${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  if (mobile) await confirmMobile(server.app, shopper);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  shopper.email = email;
  return shopper;
}

/** A centre approved for `owner`, as approval makes it (its owner a member). */
async function centre(owner, name = 'Mama Ngozi Phones') {
  const area = await prisma.classifiedArea.findFirst({ where: { country: 'NG', kind: 'area', slug: 'ikeja' } });
  const made = await prisma.connectCentre.create({
    data: { partnerId: owner.id, country: 'NG', stateId: area.parentId, areaId: area.id, name, address: '12 Allen Avenue, Ikeja, Lagos', hours: 'Mon to Sat, 8am to 6pm', phone: '08031234567', capacity: 40, depositMinor: 5_000_000n, currency: 'NGN', photos: ['https://media.udozo.test/front.jpg'] },
  });
  await prisma.connectCentreMember.create({ data: { centreId: made.id, customerId: owner.id, role: 'owner' } });
  return made;
}

describe('Connect Centres', () => {
  test('its people see it with their role; nobody else learns it exists', async () => {
    const owner = await customer('Ngozi Eze');
    const made = await centre(owner);
    const mine = (await owner.get('/v1/connect/centres/mine')).json.data;
    assert.deepEqual(mine.map(row => [row.id, row.role, row.status]), [[made.id, 'owner', 'active']]);
    const got = (await owner.get(`/v1/connect/centres/${made.id}`)).json;
    assert.deepEqual([got.number.startsWith('CC-'), got.people, got.shelves, got.deposit], [true, 1, 0, { amount: 5_000_000, currency: 'NGN' }]);
    const outsider = await customer('Chidi Obi');
    const refused = await outsider.get(`/v1/connect/centres/${made.id}`);
    assert.deepEqual([refused.status, refused.json.error.code], [404, 'centre_unknown']);
    assert.deepEqual((await outsider.get('/v1/connect/centres/mine')).json.data, []);
  });

  test('the owner adds managers and staff by their Udozo account; roles decide who changes what', async () => {
    const owner = await customer('Ngozi Eze');
    const made = await centre(owner);
    const staff = await customer('Bola Ade');
    const unconfirmed = await customer('Tunde Ola', { mobile: false });
    const add = body => owner.post(`/v1/connect/centres/${made.id}/members`, body);
    assert.equal((await add({ email: 'nobody@example.com', role: 'staff' })).json.error.code, 'account_not_found');
    assert.equal((await add({ email: unconfirmed.email, role: 'staff' })).json.error.code, 'mobile_not_confirmed');
    const added = await add({ email: staff.email.toUpperCase(), role: 'staff' });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.deepEqual(added.json.data.map(row => [row.role, row.name]), [['owner', 'Ngozi Eze'], ['staff', 'Bola Ade']]);
    assert.equal((await add({ email: staff.email, role: 'manager' })).json.error.code, 'member_exists');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'customer.connect.centre', customerId: staff.id } }), 'the new member is told');

    // Staff see the centre but change nothing; the owner makes them a manager, who then can.
    assert.equal((await staff.get(`/v1/connect/centres/${made.id}`)).json.role, 'staff');
    const refused = await staff.patch(`/v1/connect/centres/${made.id}`, { hours: 'Every day, 7am to 9pm' });
    assert.deepEqual([refused.status, refused.json.error.code], [403, 'centre_role_required']);
    assert.equal((await staff.post(`/v1/connect/centres/${made.id}/members`, { email: owner.email, role: 'staff' })).status, 403);
    const staffRow = added.json.data.find(row => row.role === 'staff');
    assert.equal((await owner.patch(`/v1/connect/centres/${made.id}/members/${staffRow.id}`, { role: 'manager' })).json.data[1].role, 'manager');
    const changed = await staff.patch(`/v1/connect/centres/${made.id}`, { hours: 'Every day, 7am to 9pm', phone: '+234 803 765 4321', capacity: 60 });
    assert.deepEqual([changed.json.hours, changed.json.phone, changed.json.capacity], ['Every day, 7am to 9pm', '+2348037654321', 60]);
    assert.equal((await staff.patch(`/v1/connect/centres/${made.id}`, { phone: 'ring me' })).json.error.param, 'phone');

    // The owner is never removed; a manager may leave by themselves.
    const ownerRow = added.json.data.find(row => row.role === 'owner');
    assert.equal((await owner.del(`/v1/connect/centres/${made.id}/members/${ownerRow.id}`)).json.error.code, 'owner_fixed');
    assert.equal((await staff.del(`/v1/connect/centres/${made.id}/members/${staffRow.id}`)).status, 200);
    assert.equal((await staff.get(`/v1/connect/centres/${made.id}`)).status, 404, 'gone once they leave');
  });

  test('storage places: codes in capitals, each once per centre, switched off rather than deleted', async () => {
    const owner = await customer('Ngozi Eze');
    const made = await centre(owner);
    const added = await owner.post(`/v1/connect/centres/${made.id}/shelves`, { code: 'a-01', label: 'Front shelf', capacity: 20 });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.deepEqual(added.json.data.map(row => [row.code, row.label, row.capacity, row.active]), [['A-01', 'Front shelf', 20, true]]);
    assert.equal((await owner.post(`/v1/connect/centres/${made.id}/shelves`, { code: 'A-01' })).json.error.code, 'shelf_exists');
    assert.equal((await owner.post(`/v1/connect/centres/${made.id}/shelves`, { code: 'shelf/3' })).json.error.param, 'code');
    await owner.post(`/v1/connect/centres/${made.id}/shelves`, { code: 'Back room' });
    const off = await owner.patch(`/v1/connect/centres/${made.id}/shelves/${added.json.data[0].id}`, { active: false });
    assert.deepEqual(off.json.data.map(row => [row.code, row.active]), [['BACK ROOM', true], ['A-01', false]]);
    assert.equal((await owner.get(`/v1/connect/centres/${made.id}`)).json.shelves, 1, 'only active places count');
  });

  test('a holiday pause takes it off the public list until it reopens, by hand or on its day', async () => {
    const owner = await customer('Ngozi Eze');
    const made = await centre(owner, 'Holiday Centre');
    const listed = async () => (await storeServer().get('/v1/connect/centres?country=NG')).json.data.some(row => row.id === made.id);
    const publicList = await storeServer().get(`/v1/connect/centres?country=ng&state=${made.stateId}`);
    assert.equal(publicList.headers.get('cache-control'), 'public, max-age=60');
    const row = publicList.json.data.find(item => item.id === made.id);
    assert.deepEqual([row.name, row.area.name, row.state.name, row.hours, row.photo], ['Holiday Centre', 'Ikeja', 'Lagos', 'Mon to Sat, 8am to 6pm', 'https://media.udozo.test/front.jpg']);
    assert.equal('deposit' in row, false, 'never the deposit');

    const until = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const paused = (await owner.post(`/v1/connect/centres/${made.id}/pause`, { until, note: 'Closed for Christmas' })).json;
    assert.deepEqual([paused.status, paused.paused.by, paused.paused.reason], ['paused', 'partner', 'Closed for Christmas']);
    assert.equal(await listed(), false);
    assert.equal((await owner.post(`/v1/connect/centres/${made.id}/resume`)).json.status, 'active');
    assert.equal(await listed(), true);

    await owner.post(`/v1/connect/centres/${made.id}/pause`, { until });
    await prisma.connectCentre.update({ where: { id: made.id }, data: { pausedUntil: new Date(Date.now() - 1000) } });
    assert.equal(await listed(), true, 'its day came: open again');
  });

  test('Udozo pauses (only Udozo lifts it), reinstates and closes; support reads, operations act', async () => {
    const owner = await customer('Ngozi Eze');
    const made = await centre(owner, 'Watched Centre');
    await owner.post(`/v1/connect/centres/${made.id}/shelves`, { code: 'A-01' });
    const support = await adminClient(server, ['support']);
    const detail = (await support.get(`/v1/admin/connect/centres/${made.id}`)).json;
    assert.deepEqual([detail.partner.id, detail.members.map(row => row.role), detail.shelves.map(row => row.code)], [owner.id, ['owner'], ['A-01']]);
    assert.equal((await support.post(`/v1/admin/connect/centres/${made.id}/pause`, { reason: 'Checks' })).status, 403);

    const paused = (await admin.post(`/v1/admin/connect/centres/${made.id}/pause`, { reason: 'A buyer reported a missing item.' })).json;
    assert.deepEqual([paused.status, paused.paused.by], ['paused', 'udozo']);
    const listed = (await support.get('/v1/admin/connect/centres?country=NG&status=paused')).json.data.find(row => row.id === made.id);
    assert.deepEqual(listed.paused, { by: 'udozo', reason: 'A buyer reported a missing item.', until: null }, 'the list says why');
    assert.equal((await owner.post(`/v1/connect/centres/${made.id}/resume`)).json.error.code, 'centre_not_paused_by_you');
    assert.equal((await admin.post(`/v1/admin/connect/centres/${made.id}/reinstate`, { reason: 'Item found.' })).json.status, 'active');
    const closed = (await admin.post(`/v1/admin/connect/centres/${made.id}/close`, { reason: 'The office moved.' })).json;
    assert.deepEqual([closed.status, closed.closed.reason], ['closed', 'The office moved.']);
    assert.equal((await owner.patch(`/v1/connect/centres/${made.id}`, { hours: 'Never' })).json.error.code, 'centre_closed');
    assert.equal((await admin.post(`/v1/admin/connect/centres/${made.id}/reinstate`, { reason: 'Again' })).json.error.code, 'centre_status');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'connect_centre.closed', targetId: made.id } }));
    assert.ok(await prisma.notification.findFirst({ where: { type: 'customer.connect.centre', customerId: owner.id } }), 'the owner is told');
  });
});
