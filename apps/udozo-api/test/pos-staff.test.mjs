// Udozo POS milestone 5 (docs/UDOZO_POS_PLAN.md): staff, roles and tills. The owner invites staff by SMS, WhatsApp or a
// link to set a 6-digit PIN; staff sign in with the shop code, phone and PIN (or a name tile and PIN on a linked till);
// five wrong PINs lock for 15 minutes; what each may do is their role's, every cell of the matrix held by the API; a
// manager's PIN approves what a role may only do with approval; and a staff session never reaches a customer route.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

const { ModulesContainer } = await import('@nestjs/core');
const { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } = await import('@nestjs/common/constants.js');

let server;
let prisma;
let rules;
let owner;
let tv;
let tillB;
const staff = {};
const anyId = '00000000-0000-4000-8000-000000000999';

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo', CHECKOUT_SANDBOX: 'on' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  rules = await import('../dist/pos/permissions.js');
  const admin = await adminClient(server);
  for (const key of ['classifieds', 'pos']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
  await prisma.posPlan.update({ where: { code: 'free' }, data: { limits: { products: 10, shops: 1, tills: 3, staff: 2 } } });
  await prisma.posPlan.update({ where: { code: 'premium' }, data: { limits: { products: null, shops: 1, tills: 5, staff: null } } });

  owner = await makeOwner();
  tv = await product(owner, 'Hisense 43-inch TV', { stock: 50 });
  const added = await owner.post(`/v1/pos/owner/shops/${owner.shop.id}/tills`, { name: 'Counter 2' });
  assert.ok([200, 201].includes(added.status), JSON.stringify(added.json));
  tillB = (await owner.get('/v1/pos/owner')).json.account.shops[0].tills.find(till => till.name === 'Counter 2');

  // One of each fixed role, every till, PIN set.
  for (const role of ['manager', 'cashier', 'stock_keeper', 'accountant']) staff[role] = await hire(role, { all_tills: true });
});

after(() => server?.close());

/** A client: an owner or customer (`bitocard-customer-session`), or a member of staff (`udozo-pos-session`). */
function client(kind = 'customer') {
  let token = null;
  let device = null;
  const request = async (method, path, body, headers = {}) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { [kind === 'staff' ? 'udozo-pos-session' : 'bitocard-customer-session']: token } : {}),
        ...(device ? { 'udozo-pos-device': device } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'idempotency-key': `staff-${randomUUID()}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return {
    get token() {
      return token;
    },
    set token(value) {
      token = value;
    },
    set device(value) {
      device = value;
    },
    get: (path, headers) => request('GET', path, undefined, headers),
    post: (path, body = {}, headers) => request('POST', path, body, headers),
    put: (path, body = {}) => request('PUT', path, body),
    patch: (path, body = {}) => request('PATCH', path, body),
    del: path => request('DELETE', path),
  };
}

let counter = 0;
async function makeOwner(plan = 'premium') {
  const who = client();
  const email = `staffowner${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await who.post('/v1/store/account/signup', { name: 'Ada Okafor', email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, who);
  assert.equal((await who.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  who.id = signup.json.customer.id;
  await prisma.customer.update({ where: { id: who.id }, data: { phoneVerifiedAt: new Date() } });
  await who.post('/v1/classifieds/terms/accept', { version: (await who.get('/v1/classifieds/terms')).json.version });
  assert.equal((await who.post('/v1/pos/owner/signup', { plan: 'free', shop: { name: "Ada's Gadget Hub", vat_bps: 0 } })).status, 201);
  await prisma.posAccount.update({ where: { customerId: who.id }, data: { planCode: plan } });
  const me = (await who.get('/v1/pos/owner')).json.account;
  who.shop = me.shops[0];
  who.till = me.shops[0].tills[0];
  return who;
}

async function product(who, title, { price = 100_000, stock = 5 } = {}) {
  const category = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } });
  const made = await who.post('/v1/classifieds/listings', { title, price, category_id: category.id, stock, pos_enabled: true, on_shop: false });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const submitted = await who.post(`/v1/classifieds/listings/${made.json.id}/submit`);
  assert.equal(submitted.json.status, 'active', JSON.stringify(submitted.json));
  return submitted.json;
}

const pins = { manager: '482652', cashier: '739152', stock_keeper: '518052', accountant: '629452' };

/** Invites a member of staff by link, accepts with a PIN and returns their signed-in client. */
async function hire(role, { all_tills = false, till_ids, pin, by = owner, first = role } = {}) {
  const phone = testMobile('NG');
  const invited = await by.post(`/v1/pos/${by === owner ? 'owner' : 'staff'}/staff`, { first_name: first.replace(/_/g, ' '), last_name: 'Test', phone, role, all_tills, till_ids: till_ids ?? (all_tills ? undefined : [owner.till.id]), send_via: 'link' });
  assert.equal(invited.status, 201, JSON.stringify(invited.json));
  const token = new URL(invited.json.invite.url).hash.slice(3);
  const who = client('staff');
  const accepted = await who.post('/v1/pos/invites/accept', { token, pin: pin ?? pins[role] ?? '391752' });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.json));
  who.id = invited.json.id;
  who.phone = phone;
  who.pin = pin ?? pins[role] ?? '391752';
  return who;
}

const sale = (who, { discount = 0, till = owner.till.id, approval, quantity = 1 } = {}) =>
  who.post(`/v1/pos/${who === owner ? 'owner' : 'staff'}/sales`, {
    till_id: till,
    client_sale_id: randomUUID(),
    lines: [{ listing_id: tv.id, quantity }],
    ...(discount ? { discount } : {}),
    payments: [{ method: 'cash', amount: 100_000 * quantity - discount }],
    expected_total: 100_000 * quantity - discount,
    ...(approval ? { approval } : {}),
  });

describe('the rules', () => {
  test('the fixed roles are the design’s matrix, cell by cell', () => {
    const { systemRoles } = rules;
    // Owner, Manager, Cashier, Stock keeper, Accountant (the design's Settings > Staff and roles).
    const matrix = {
      sell: ['yes', 'yes', 'no', 'no'],
      refund: ['yes', 'approval', 'no', 'no'],
      till: ['yes', 'yes', 'no', 'no'],
      stock_view: ['yes', 'yes', 'yes', 'yes'],
      stock_adjust: ['yes', 'no', 'yes', 'no'],
      prices: ['yes', 'no', 'no', 'no'],
      own_sales: ['yes', 'yes', 'yes', 'no'],
      all_sales: ['yes', 'no', 'no', 'yes'],
      cash_up: ['yes', 'no', 'no', 'yes'],
      export: ['no', 'no', 'no', 'yes'],
      customers: ['yes', 'yes', 'no', 'no'],
      transfers: ['yes', 'no', 'no', 'no'],
      staff: ['cashiers', 'no', 'no', 'no'],
      settings: ['yes', 'no', 'no', 'no'],
    };
    for (const [permission, cells] of Object.entries(matrix)) {
      ['manager', 'cashier', 'stock_keeper', 'accountant'].forEach((role, index) => assert.equal(systemRoles[role].permissions[permission], cells[index], `${role} ${permission}`));
    }
    assert.deepEqual(Object.keys(matrix).sort(), [...rules.posPermissions].sort(), 'every permission is in the matrix');
    assert.equal(systemRoles.cashier.discountLimitBps, 500, 'cashiers give up to 5%');
    assert.equal(systemRoles.manager.discountLimitBps, null, 'managers any amount');
  });

  test('easy PINs, permissions sent and discounts as a share', () => {
    for (const pin of ['123456', '654321', '000000', '777777', '121212', '123123', '112211', '890123', '12a456', '4826', '1234567']) assert.equal(rules.weakPin(pin), true, pin);
    for (const pin of ['482652', '739152', '518052', '091352', '271828']) assert.equal(rules.weakPin(pin), false, pin);
    assert.equal(rules.permissionsProblem({ sell: 'yes', refund: 'approval', staff: 'cashiers' }), null);
    assert.equal(rules.permissionsProblem({ sell: 'approval' }).param, 'permissions.sell', 'selling is yes or no');
    assert.equal(rules.permissionsProblem({ staff: 'yes' }).param, 'permissions.staff', 'only the owner manages every member of staff');
    assert.equal(rules.permissionsProblem({ fly: 'yes' }).param, 'permissions.fly');
    assert.equal(rules.discountBps(5_000n, 100_000n), 500);
    assert.equal(rules.discountBps(5_001n, 100_000n), 501, 'rounded up');
    assert.deepEqual(rules.allowedLines(rules.systemRoles.cashier).slice(0, 2), ['Make sales and take payments', 'Give discounts up to 5%']);
  });
});

describe('inviting and signing in', () => {
  test('an invite by SMS, WhatsApp or link; the plan’s limit; one person per phone', async () => {
    const phone = testMobile('NG');
    const sms = await owner.post('/v1/pos/owner/staff', { first_name: 'Kemi', last_name: 'Ade', phone, role: 'cashier', till_ids: [owner.till.id], send_via: 'sms' });
    assert.equal(sms.status, 201, JSON.stringify(sms.json));
    assert.equal(sms.json.status, 'invited');
    assert.equal(typeof sms.json.invite.sent, 'boolean');
    assert.match(sms.json.invite.whatsapp_url, /^https:\/\/wa\.me\/234\d+\?text=/);
    assert.match(sms.json.invite.url, /\/invite#t=upi_/);
    assert.equal(sms.json.invite.shop_code, owner.shop.shop_code);
    const again = await owner.post('/v1/pos/owner/staff', { first_name: 'Kemi', last_name: 'Two', phone, role: 'cashier', all_tills: true, send_via: 'link' });
    assert.equal(again.json.error.code, 'staff_exists');
    const noTills = await owner.post('/v1/pos/owner/staff', { first_name: 'Nobody', last_name: 'Tills', phone: testMobile('NG'), role: 'cashier', send_via: 'link' });
    assert.equal(noTills.json.error.param, 'till_ids');

    // Free allows 2 staff.
    const small = await makeOwner('free');
    for (const name of ['One', 'Two']) assert.equal((await small.post('/v1/pos/owner/staff', { first_name: name, last_name: 'X', phone: testMobile('NG'), role: 'cashier', all_tills: true, send_via: 'link' })).status, 201);
    const third = await small.post('/v1/pos/owner/staff', { first_name: 'Three', last_name: 'X', phone: testMobile('NG'), role: 'cashier', all_tills: true, send_via: 'link' });
    assert.equal(third.json.error.code, 'plan_limit_reached');
  });

  test('the invite page shows the shop and role, refuses an easy PIN, and works once', async () => {
    const invited = await owner.post('/v1/pos/owner/staff', { first_name: 'Tunde', last_name: 'Bakare', phone: testMobile('NG'), role: 'cashier', till_ids: [owner.till.id, tillB.id], send_via: 'whatsapp' });
    const token = new URL(invited.json.invite.url).hash.slice(3);
    const who = client('staff');
    const info = await who.post('/v1/pos/invites/lookup', { token });
    assert.equal(info.status, 200, JSON.stringify(info.json));
    assert.equal(info.json.first_name, 'Tunde');
    assert.equal(info.json.shop.name, "Ada's Gadget Hub");
    assert.equal(info.json.role.name, 'Cashier');
    assert.deepEqual(info.json.tills, ['Till 1', 'Counter 2']);
    assert.ok(info.json.role.allows.includes('Give discounts up to 5%'));
    assert.equal(JSON.stringify(info.json).includes(invited.json.phone), false, 'never the phone');
    assert.equal((await who.post('/v1/pos/invites/accept', { token, pin: '123456' })).json.error.code, 'pin_too_easy');
    const accepted = await who.post('/v1/pos/invites/accept', { token, pin: '246852' });
    assert.equal(accepted.status, 201);
    assert.match(who.token, /^ups_/);
    assert.equal((await who.get('/v1/pos/staff')).json.role.name, 'Cashier');
    assert.equal((await client('staff').post('/v1/pos/invites/lookup', { token })).json.error.code, 'invite_invalid', 'used once');
    assert.equal((await client('staff').post('/v1/pos/invites/lookup', { token: 'upi_nothing' })).json.error.code, 'invite_invalid');
  });

  test('signing in with the shop code, phone and PIN; five wrong PINs lock, even at once', async () => {
    const kemi = await hire('cashier', { pin: '864252', first: 'Lock' });
    const fresh = client('staff');
    const local = `0${kemi.phone.slice(4)}`;
    const ok = await fresh.post('/v1/pos/staff/sign-in', { shop_code: owner.shop.shop_code.toLowerCase(), phone: local, pin: '864252', till_id: owner.till.id });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.equal(ok.json.till_id, owner.till.id);
    for (const wrong of [{ shop_code: 'ZZZ-0000', phone: local, pin: '864252' }, { shop_code: owner.shop.shop_code, phone: testMobile('NG'), pin: '864252' }]) {
      assert.equal((await client('staff').post('/v1/pos/staff/sign-in', wrong)).json.error.code, 'invalid_credentials');
    }
    // Eight wrong PINs at once: only five are tried, the rest find them locked.
    const tries = await Promise.all(Array.from({ length: 8 }, () => client('staff').post('/v1/pos/staff/sign-in', { shop_code: owner.shop.shop_code, phone: local, pin: '135752' })));
    const codes = tries.map(res => res.json.error.code);
    assert.equal(codes.filter(code => code === 'invalid_credentials').length, 5, codes.join());
    assert.equal(codes.filter(code => code === 'pin_locked').length, 3);
    assert.equal((await client('staff').post('/v1/pos/staff/sign-in', { shop_code: owner.shop.shop_code, phone: local, pin: '864252' })).json.error.code, 'pin_locked', 'even the right PIN, while locked');
    await prisma.posStaff.update({ where: { id: kemi.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    assert.equal((await client('staff').post('/v1/pos/staff/sign-in', { shop_code: owner.shop.shop_code, phone: local, pin: '864252' })).status, 201, '15 minutes later');
    const row = await prisma.posStaff.findUniqueOrThrow({ where: { id: kemi.id } });
    assert.equal(row.failedTries, 0);
    assert.equal(await prisma.posStaffSession.count({ where: { staffId: kemi.id, tokenHash: { contains: 'ups_' } } }), 0, 'only hashes are kept');
  });

  test('a PIN from before PINs were 6 digits signs in once, then nothing works until a new 6-digit PIN is chosen', async () => {
    const who = await hire('cashier', { pin: '531952', first: 'Legacy' });
    const passwords = server.app.get((await import('../dist/auth/passwords.service.js')).PasswordsService);
    await prisma.posStaff.update({ where: { id: who.id }, data: { pinHash: await passwords.hash('5319'), pinDigits: 4 } });
    const old = client('staff');
    assert.equal((await old.post('/v1/pos/staff/sign-in', { shop_code: owner.shop.shop_code, phone: who.phone, pin: '5319' })).status, 201);
    const me = await old.get('/v1/pos/staff');
    assert.equal(me.json.pin_change_required, true);
    assert.equal((await old.get('/v1/pos/staff/catalogue')).json.error.code, 'pin_change_required');
    assert.equal((await old.post('/v1/pos/staff/pin', { current_pin: '5319', new_pin: '111111' })).json.error.code, 'pin_too_easy');
    assert.equal((await old.post('/v1/pos/staff/pin', { current_pin: '9999', new_pin: '531952' })).json.error.code, 'pin_wrong');
    assert.equal((await old.post('/v1/pos/staff/pin', { current_pin: '5319', new_pin: '53195' })).status, 400);
    const changed = await old.post('/v1/pos/staff/pin', { current_pin: '5319', new_pin: '846271' });
    assert.equal(changed.status, 200, JSON.stringify(changed.json));
    assert.equal((await old.get('/v1/pos/staff')).json.pin_change_required, false);
    assert.equal((await old.get('/v1/pos/staff/catalogue')).status, 200);
    assert.equal((await client('staff').post('/v1/pos/staff/sign-in', { shop_code: owner.shop.shop_code, phone: who.phone, pin: '5319' })).json.error.code, 'invalid_credentials');
    assert.equal((await client('staff').post('/v1/pos/staff/sign-in', { shop_code: owner.shop.shop_code, phone: who.phone, pin: '846271' })).status, 201);
    // A new invite asks 6 digits.
    assert.equal((await client('staff').post('/v1/pos/invites/accept', { token: 'upi_' + 'x'.repeat(30), pin: '5319' })).status, 400);
  });

  test('a session ends after 12 hours idle, at sign-out, and when they are suspended or removed', async () => {
    const who = await hire('cashier', { pin: '975352', first: 'Idle' });
    assert.equal((await who.get('/v1/pos/staff')).status, 200);
    await prisma.posStaffSession.updateMany({ where: { staffId: who.id }, data: { lastSeenAt: new Date(Date.now() - 13 * 3_600_000) } });
    assert.equal((await who.get('/v1/pos/staff')).json.error.code, 'pos_sign_in_required');

    const next = client('staff');
    await next.post('/v1/pos/staff/sign-in', { shop_code: owner.shop.shop_code, phone: who.phone, pin: '975352' });
    assert.equal((await next.post('/v1/pos/staff/sign-out')).status, 204);
    assert.equal((await next.get('/v1/pos/staff')).status, 401);

    await next.post('/v1/pos/staff/sign-in', { shop_code: owner.shop.shop_code, phone: who.phone, pin: '975352' });
    assert.equal((await owner.post(`/v1/pos/owner/staff/${who.id}/suspend`)).json.status, 'suspended');
    assert.equal((await next.get('/v1/pos/staff')).status, 401, 'signed out at once');
    assert.equal((await client('staff').post('/v1/pos/staff/sign-in', { shop_code: owner.shop.shop_code, phone: who.phone, pin: '975352' })).json.error.code, 'invalid_credentials');
    assert.equal((await owner.post(`/v1/pos/owner/staff/${who.id}/restore`)).json.status, 'active');
    assert.equal((await next.post('/v1/pos/staff/sign-in', { shop_code: owner.shop.shop_code, phone: who.phone, pin: '975352' })).status, 201);
    assert.equal((await owner.del(`/v1/pos/owner/staff/${who.id}`)).json.status, 'removed');
    assert.equal((await next.get('/v1/pos/staff')).status, 401);
    assert.equal((await owner.get('/v1/pos/owner/staff')).json.data.some(row => row.id === who.id), false);
  });

  test('a new invite to someone signed in before resets their PIN', async () => {
    const who = await hire('cashier', { pin: '357952', first: 'Reset' });
    const resent = await owner.post(`/v1/pos/owner/staff/${who.id}/resend`, { send_via: 'link' });
    assert.equal(resent.json.status, 'invited');
    assert.equal((await who.get('/v1/pos/staff')).status, 401, 'signed out');
    const info = await client('staff').post('/v1/pos/invites/lookup', { token: new URL(resent.json.invite.url).hash.slice(3) });
    assert.equal(info.json.reset, true);
  });
});

describe('every role against every route', () => {
  /** What each permission opens, tried as each role: allowed, refused, or (approval) asking for a manager. */
  const probes = [
    { permission: 'sell', call: who => sale(who), ok: 201 },
    { permission: ['sell', 'stock_view'], call: who => who.get('/v1/pos/staff/catalogue'), ok: 200 },
    { permission: 'stock_view', call: who => who.get(`/v1/pos/staff/stock/${tv.id}/movements`), ok: 200 },
    { permission: 'stock_adjust', call: who => who.post(`/v1/pos/staff/stock/${tv.id}`, { kind: 'restock', quantity: 1 }), ok: 201 },
    { permission: ['own_sales', 'all_sales'], call: who => who.get('/v1/pos/staff/sales'), ok: 200 },
    { permission: 'customers', call: who => who.get('/v1/pos/staff/customers'), ok: 200 },
    { permission: 'transfers', call: who => who.get('/v1/pos/staff/collections/transfers'), ok: 200 },
    { permission: 'staff', call: who => who.get('/v1/pos/staff/staff'), ok: 200 },
    { permission: 'settings', call: who => who.get('/v1/pos/staff/devices'), ok: 200 },
  ];

  const expectation = (role, permission) => {
    const levels = [permission].flat().map(key => role.permissions[key]);
    if (levels.some(level => level === 'yes' || level === 'cashiers')) return 'allowed';
    if (levels.includes('approval')) return 'approval';
    return 'refused';
  };

  for (const key of ['manager', 'cashier', 'stock_keeper', 'accountant', 'custom']) {
    test(`${key}: each route as the matrix says`, async () => {
      let who = staff[key];
      let role = rules.systemRoles[key];
      if (key === 'custom') {
        // The owner's own role: selling and seeing stock, refunds with approval, nothing else.
        const made = await owner.post('/v1/pos/owner/roles', { name: 'Weekend helper', permissions: { sell: 'yes', stock_view: 'yes', refund: 'approval', stock_adjust: 'approval' }, discount_limit_bps: 0 });
        assert.equal(made.status, 201, JSON.stringify(made.json));
        who = staff.custom = await hire(made.json.id, { all_tills: true, pin: '258052', first: 'Weekend' });
        role = { permissions: made.json.permissions };
      }
      const me = await who.get('/v1/pos/staff');
      assert.deepEqual(me.json.permissions, role.permissions, 'the till is told what the role allows');
      for (const probe of probes) {
        const res = await probe.call(who);
        const expected = expectation(role, probe.permission);
        const label = `${key} ${[probe.permission].flat().join('|')}: ${JSON.stringify(res.json).slice(0, 200)}`;
        if (expected === 'allowed') assert.equal(res.status, probe.ok, label);
        else if (expected === 'approval') assert.equal(res.json.error.code, 'approval_required', label);
        else assert.equal(res.json.error.code, 'pos_permission_required', label);
      }
    });
  }

  test('refunds: a cashier needs a manager’s PIN; the approval is recorded; another cashier’s PIN will not do', async () => {
    const made = await sale(staff.cashier);
    assert.equal(made.status, 201);
    const url = `/v1/pos/staff/sales/${made.json.id}/refund`;
    assert.equal((await staff.cashier.post(url, { reason: 'Wrong size' })).json.error.code, 'approval_required');
    const otherCashier = await hire('cashier', { all_tills: true, pin: '147052', first: 'Other' });
    assert.equal((await staff.cashier.post(url, { reason: 'Wrong size', approval: { staff_id: otherCashier.id, pin: '147052' } })).json.error.code, 'approval_invalid');
    assert.equal((await staff.cashier.post(url, { reason: 'Wrong size', approval: { staff_id: staff.manager.id, pin: '000052' } })).json.error.param, 'approval.pin');
    const refunded = await staff.cashier.post(url, { reason: 'Wrong size', approval: { staff_id: staff.manager.id, pin: pins.manager } });
    assert.equal(refunded.status, 200, JSON.stringify(refunded.json));
    assert.equal(refunded.json.refunded_by, 'cashier Test');
    const approvals = (await owner.get('/v1/pos/owner/approvals')).json.data;
    assert.ok(approvals.some(row => row.action === 'refund' && row.subject_id === made.json.id && row.approved_by === 'manager Test' && row.requested_by === 'cashier Test'));
    assert.equal((await prisma.posStaff.findUniqueOrThrow({ where: { id: staff.manager.id } })).failedTries, 0, 'the right PIN clears the wrong one');
  });

  test('the till lists who may approve, by name and role only', async () => {
    const approvers = (await staff.cashier.get('/v1/pos/staff')).json.approvers;
    const manager = approvers.find(row => row.id === staff.manager.id);
    assert.deepEqual(manager, { id: staff.manager.id, name: 'manager Test', role: 'Manager', discount_limit_bps: null, refund: true, stock_adjust: true });
    assert.equal(approvers.some(row => row.id === staff.cashier.id), false, 'never themselves');
    assert.equal(approvers.some(row => row.id === staff.accountant.id), false, 'an accountant approves nothing');
    assert.equal(JSON.stringify(approvers).includes('+234'), false, 'never phones');
  });

  test('discounts: a cashier gives up to 5%, more with a manager’s PIN', async () => {
    const five = await sale(staff.cashier, { discount: 5_000 });
    assert.equal(five.status, 201, JSON.stringify(five.json));
    assert.equal(five.json.sold_by, 'cashier Test');
    assert.equal(five.json.sold_by_staff_id, staff.cashier.id);
    assert.equal((await sale(staff.cashier, { discount: 10_000 })).json.error.code, 'approval_required');
    const approved = await sale(staff.cashier, { discount: 10_000, approval: { staff_id: staff.manager.id, pin: pins.manager } });
    assert.equal(approved.status, 201, JSON.stringify(approved.json));
    assert.ok((await owner.get('/v1/pos/owner/approvals')).json.data.some(row => row.action === 'discount' && row.subject_id === approved.json.id));
    assert.equal((await sale(staff.cashier, { discount: 10_000, approval: { staff_id: staff.accountant.id, pin: pins.accountant } })).json.error.code, 'approval_invalid', 'an accountant cannot sell, so cannot approve');
    assert.equal((await sale(staff.manager, { discount: 50_000 })).status, 201, 'a manager gives any discount');
  });

  test('what each sees of the sales: a cashier their own, an accountant every sale', async () => {
    const mine = (await staff.cashier.get('/v1/pos/staff/sales?limit=100')).json.data;
    assert.ok(mine.length > 0);
    assert.ok(mine.every(row => row.sold_by_staff_id === staff.cashier.id));
    const managerSale = (await sale(staff.manager)).json;
    assert.equal((await staff.cashier.get(`/v1/pos/staff/sales/${managerSale.id}`)).status, 404, 'not theirs to see');
    const all = (await staff.accountant.get('/v1/pos/staff/sales?limit=100')).json.data;
    assert.ok(all.some(row => row.id === managerSale.id));
    assert.ok((await owner.get('/v1/pos/owner/sales?limit=100')).json.data.some(row => row.sold_by === 'cashier Test'), 'the owner sees who sold each');
  });

  test('receipts: staff print and send the receipts of the sales they see, in their own name', async () => {
    const mine = (await sale(staff.cashier)).json;
    const overview = await staff.cashier.get(`/v1/pos/staff/sales/${mine.id}/receipts`);
    assert.equal(overview.status, 200, JSON.stringify(overview.json));
    assert.equal(overview.json.number, mine.number);
    const sent = await staff.cashier.post(`/v1/pos/staff/sales/${mine.id}/receipt/email`, { email: 'buyer@example.com' });
    assert.deepEqual([sent.status, sent.json.by, sent.json.to], [201, 'cashier Test', 'b***@example.com']);
    const managerSale = (await sale(staff.manager)).json;
    assert.equal((await staff.cashier.get(`/v1/pos/staff/sales/${managerSale.id}/receipts`)).status, 404, 'not theirs to see');
    assert.equal((await staff.cashier.post(`/v1/pos/staff/sales/${managerSale.id}/receipt/email`, { email: 'buyer@example.com' })).status, 404);
    assert.equal((await staff.accountant.get(`/v1/pos/staff/sales/${managerSale.id}/receipts`)).status, 200, 'an accountant sees every sale');
  });

  test('a stock keeper changes stock with a movement in their name; a custom role needs approval for it', async () => {
    const res = await staff.stock_keeper.post(`/v1/pos/staff/stock/${tv.id}`, { kind: 'restock', quantity: 2, note: 'Delivery' });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assert.equal(res.json.movement.by, 'stock keeper Test');
    const approved = await staff.custom.post(`/v1/pos/staff/stock/${tv.id}`, { kind: 'restock', quantity: 1, approval: { staff_id: staff.stock_keeper.id, pin: pins.stock_keeper } });
    assert.equal(approved.status, 201, JSON.stringify(approved.json));
  });

  test('a manager invites and manages cashiers only; staff and roles beyond stay the owner’s', async () => {
    const accountant = await staff.manager.post('/v1/pos/staff/staff', { first_name: 'Funmi', last_name: 'A', phone: testMobile('NG'), role: 'accountant', all_tills: true, send_via: 'link' });
    assert.equal(accountant.json.error.code, 'pos_permission_required');
    const cashier = await hire('cashier', { by: staff.manager, all_tills: true, pin: '369152', first: 'ManagersHire' });
    assert.equal((await owner.get(`/v1/pos/owner/staff/${cashier.id}`)).json.invited_by, 'manager Test');
    assert.equal((await staff.manager.patch(`/v1/pos/staff/staff/${cashier.id}`, { role: 'manager' })).json.error.code, 'pos_permission_required');
    assert.equal((await staff.manager.post(`/v1/pos/staff/staff/${staff.accountant.id}/suspend`)).json.error.code, 'pos_permission_required');
    const listed = (await staff.manager.get('/v1/pos/staff/staff')).json.data;
    assert.ok(listed.every(row => row.role.key === 'cashier'));
    assert.equal((await staff.manager.post(`/v1/pos/staff/staff/${cashier.id}/suspend`)).json.status, 'suspended');
  });

  test('custom roles: refused when they would manage every member of staff, renamed, and kept while in use', async () => {
    assert.equal((await owner.post('/v1/pos/owner/roles', { name: 'Boss', permissions: { staff: 'yes' } })).json.error.param, 'permissions.staff');
    assert.equal((await owner.post('/v1/pos/owner/roles', { name: 'Cashier', permissions: {} })).json.error.code, 'role_exists');
    const roles = (await owner.get('/v1/pos/owner/roles')).json;
    assert.deepEqual(roles.data.slice(0, 4).map(row => row.key), ['manager', 'cashier', 'stock_keeper', 'accountant']);
    const custom = roles.data.find(row => row.name === 'Weekend helper');
    assert.equal(custom.staff, 1);
    assert.equal((await owner.del(`/v1/pos/owner/roles/${custom.id}`)).json.error.code, 'role_in_use');
    const changed = await owner.patch(`/v1/pos/owner/roles/${custom.id}`, { name: 'Weekend help', permissions: { sell: 'yes' }, discount_limit_bps: 200 });
    assert.equal(changed.json.permissions.stock_view, 'no');
    assert.equal(changed.json.discount_limit_bps, 200);
    assert.equal((await staff.custom.get(`/v1/pos/staff/stock/${tv.id}/movements`)).json.error.code, 'pos_permission_required', 'the change is live');
  });
});

describe('tills and devices', () => {
  test('staff sell only at their tills', async () => {
    const one = await hire('cashier', { till_ids: [owner.till.id], pin: '258152', first: 'OneTill' });
    assert.equal((await sale(one, { till: tillB.id })).json.error.code, 'till_not_allowed');
    assert.equal((await sale(one)).status, 201);
    const chosen = client('staff');
    assert.equal((await chosen.post('/v1/pos/staff/sign-in', { shop_code: owner.shop.shop_code, phone: one.phone, pin: '258152', till_id: tillB.id })).json.error.code, 'till_not_allowed');
  });

  test('linking a device: a one-time code, the name tiles, PIN sign-in at its till, and unlinking ends it at once', async () => {
    const onlyB = await hire('cashier', { till_ids: [tillB.id], pin: '741052', first: 'OnlyB' });
    const code = await owner.post(`/v1/pos/owner/tills/${owner.till.id}/devices/link-code`);
    assert.equal(code.status, 201, JSON.stringify(code.json));
    assert.match(code.json.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const device = client('staff');
    const linked = await device.post('/v1/pos/devices/link', { code: code.json.code.toLowerCase().replace('-', ' '), name: 'Front counter', platform: 'windows' });
    assert.equal(linked.status, 201, JSON.stringify(linked.json));
    assert.match(linked.json.token, /^upd_/);
    assert.equal((await client('staff').post('/v1/pos/devices/link', { code: code.json.code })).json.error.code, 'link_code_invalid', 'once');
    device.device = linked.json.token;
    const tiles = (await device.get('/v1/pos/device')).json;
    assert.equal(tiles.till.name, 'Till 1');
    assert.ok(tiles.staff.some(row => row.id === staff.cashier.id));
    assert.equal(tiles.staff.some(row => row.id === onlyB.id), false, 'only who may sell at this till');
    assert.equal(JSON.stringify(tiles).includes(staff.cashier.phone), false, 'never their phones');
    assert.equal((await device.post('/v1/pos/device/sign-in', { staff_id: onlyB.id, pin: '741052' })).json.error.code, 'till_not_allowed');
    const signed = await device.post('/v1/pos/device/sign-in', { staff_id: staff.cashier.id, pin: pins.cashier });
    assert.equal(signed.status, 201, JSON.stringify(signed.json));
    assert.equal(signed.json.till_id, owner.till.id);
    assert.equal((await sale(device, { till: tillB.id })).json.error.code, 'till_not_allowed', 'a device sells at its own till');
    assert.equal((await sale(device)).status, 201);

    const devices = (await owner.get('/v1/pos/owner/devices')).json.data;
    const row = devices.find(item => item.id === linked.json.device.id);
    assert.equal(row.name, 'Front counter');
    assert.equal(row.platform, 'windows');
    assert.equal((await owner.post(`/v1/pos/owner/devices/${row.id}/unlink`)).json.revoked_at !== null, true);
    assert.equal((await device.get('/v1/pos/staff')).status, 401, 'signed out at once');
    assert.equal((await device.get('/v1/pos/device')).json.error.code, 'device_not_linked');
  });

  test('a link code expires after 10 minutes', async () => {
    const code = await owner.post(`/v1/pos/owner/tills/${owner.till.id}/devices/link-code`);
    await prisma.posDevice.update({ where: { id: code.json.device_id }, data: { codeExpiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await client('staff').post('/v1/pos/devices/link', { code: code.json.code })).json.error.code, 'link_code_invalid');
  });
});

describe('a staff session never reaches the owner’s Udozo account', () => {
  /** Every route behind `CustomerGuard`, and every route of the staff till, read from the running app. */
  function appRoutes() {
    const found = [];
    for (const module of server.app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const type = wrapper.metatype;
        if (!type?.prototype) continue;
        const bases = [Reflect.getMetadata(PATH_METADATA, type) ?? ''].flat();
        for (const name of Object.getOwnPropertyNames(type.prototype)) {
          const handler = name === 'constructor' ? undefined : type.prototype[name];
          if (typeof handler !== 'function' || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
          const guards = [...(Reflect.getMetadata(GUARDS_METADATA, type) ?? []), ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? [])].map(guard => guard?.name);
          for (const base of bases) {
            const joined = [base, Reflect.getMetadata(PATH_METADATA, handler)].map(part => String(part).replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
            found.push({
              method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'][Reflect.getMetadata(METHOD_METADATA, handler)],
              url: `/v1/${joined}`.replace(/:[A-Za-z_]+(\([^)]*\))?\??/g, anyId),
              customer: guards.includes('CustomerGuard'),
              staff: guards.includes('PosGuard'),
              allows: Reflect.getMetadata('pos:allows', handler),
              where: `${type.name}.${name}`,
            });
          }
        }
      }
    }
    return found;
  }

  test('a staff token is no customer session on any customer, wallet, payout, Connect or owner route', async () => {
    const token = staff.manager.token;
    const routes = appRoutes().filter(route => route.customer);
    assert.ok(routes.length > 100, `customer routes found: ${routes.length}`);
    assert.ok(routes.some(route => route.url.startsWith('/v1/pos/owner')));
    assert.ok(routes.some(route => route.url.startsWith('/v1/store/wallet')));
    for (const route of routes) {
      const write = !['GET', 'DELETE'].includes(route.method);
      const res = await fetch(`${server.base}${route.url}`, {
        method: route.method,
        headers: { 'bitocard-customer-session': token, 'udozo-pos-session': token, ...(write ? { 'content-type': 'application/json' } : {}), ...(route.method === 'POST' ? { 'idempotency-key': `sep-${randomUUID()}` } : {}) },
        body: write ? '{}' : undefined,
      });
      assert.ok([401, 404].includes(res.status), `${route.method} ${route.url} (${route.where}) answered ${res.status}`);
    }
  });

  test('a customer session is no staff session, and every staff route names what it needs', async () => {
    const routes = appRoutes().filter(route => route.staff);
    assert.ok(routes.length > 30);
    for (const route of routes) {
      assert.ok(route.allows, `${route.where} names its permission with @PosAllows`);
      const res = await fetch(`${server.base}${route.url}`, { method: route.method, headers: { 'bitocard-customer-session': owner.token, ...(route.method === 'POST' ? { 'idempotency-key': `sep-${randomUUID()}`, 'content-type': 'application/json' } : {}) }, body: route.method === 'POST' ? '{}' : undefined });
      assert.equal(res.status, 401, `${route.method} ${route.url}`);
    }
  });

  test('Udozo’s admins read an account’s staff, roles, devices and approvals, never a PIN', async () => {
    const admin = await adminClient(server);
    const account = await prisma.posAccount.findUniqueOrThrow({ where: { customerId: owner.id } });
    const res = await admin.get(`/v1/admin/pos/accounts/${account.id}/staff`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.ok(res.json.staff.data.some(row => row.id === staff.manager.id && row.role.name === 'Manager'));
    assert.ok(res.json.roles.data.some(row => row.name === 'Weekend help'));
    assert.ok(res.json.devices.length >= 1);
    assert.ok(res.json.approvals.some(row => row.action === 'refund'));
    assert.equal(JSON.stringify(res.json).includes('pin_hash'), false);
    assert.equal(JSON.stringify(res.json).includes('$argon2'), false);
    assert.equal((await admin.get(`/v1/admin/pos/accounts/${anyId}/staff`)).status, 404);
  });

  test('staff never see the owner’s wallet, plan billing or payouts', async () => {
    const me = (await staff.manager.get('/v1/pos/staff')).json;
    assert.equal(me.wallet, undefined);
    assert.equal(me.plans, undefined);
    assert.equal(me.account.charges, undefined);
    assert.equal(JSON.stringify(me).includes('balance'), false);
  });
});
