// BitoCard Verify (verify.bitocard.com): own KYC and KYB with human review in African countries. Links work once,
// documents are checked from their bytes, stripped of metadata and stored encrypted in a private bucket, every view is
// audited, and only BitoCard admins or a registered, KYB-verified reseller (for its own customers) decide.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, fakeService, lastEmailCode, resellerClient, startApp } from './helpers.mjs';

let server;
let admin;
let prisma;
let bucket;
const objects = new Map();

before(async () => {
  bucket = await fakeService(call => {
    const key = decodeURIComponent(new URL(call.url, 'http://x').pathname);
    if (call.method === 'PUT') {
      objects.set(key, { body: call.raw, acl: call.headers['x-amz-acl'], signed: Boolean(call.headers.authorization) });
      return { status: 200, body: '' };
    }
    if (call.method === 'GET') return objects.has(key) ? { status: 200, headers: { 'content-type': 'application/octet-stream' }, body: objects.get(key).body } : { status: 404, body: '' };
    if (call.method === 'DELETE') {
      objects.delete(key);
      return { status: 204, body: '' };
    }
    return { status: 405, body: '' };
  });
  server = await startApp({
    env: { KYC_SPACES_KEY: 'kyc-key', KYC_SPACES_SECRET: 'kyc-secret', KYC_SPACES_BUCKET: 'kyc-private', KYC_SPACES_ENDPOINT: bucket.url, CHECKOUT_SANDBOX: 'off', VERIFY_URL: 'https://verify.example' },
  });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server);
});

after(async () => {
  await server?.close();
  await bucket?.close();
});

// -- Files -----------------------------------------------------------------------------------------------------------

/** A minimal JPEG: SOI, an EXIF block carrying a GPS marker, a frame header (dimensions), a scan and EOI. */
function jpeg(tag = 'GPSDATA-LAGOS') {
  const exif = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from(tag)]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), u16(exif.length + 2), exif]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x30, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, sos, Buffer.from(`pixels-${Math.random()}`), Buffer.from([0xff, 0xd9])]);
}
const u16 = value => Buffer.from([value >> 8, value & 0xff]);

/** A minimal PNG with a text chunk (stripped) and IEND. */
function png() {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(40, 0);
  ihdr.writeUInt32BE(30, 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('tEXt', Buffer.from('Comment\0PHONE-SECRET')), chunk('IDAT', Buffer.from('data')), chunk('IEND', Buffer.alloc(0))]);
}
const pdf = (extra = '') => Buffer.from(`%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj ${extra}\n%%EOF`);

// -- Applicant -------------------------------------------------------------------------------------------------------

/** The verify app's server: exchanges the link, then calls the API with the session header. */
async function applicant(url) {
  const token = new URL(url).hash.replace('#t=', '');
  const exchanged = await call('POST', '/v1/kyc/session', { body: { token } });
  assert.equal(exchanged.status, 200, JSON.stringify(exchanged.json));
  const session = exchanged.json.session.token;
  const headers = { 'bitocard-kyc-session': session };
  return {
    token,
    case: exchanged.json.case,
    get: () => call('GET', '/v1/kyc/case', { headers }),
    put: (path, body) => call('PUT', `/v1/kyc/case/${path}`, { headers, body }),
    post: (path, body = {}) => call('POST', `/v1/kyc/case/${path}`, { headers, body }),
    upload: (kind, bytes, type) => {
      const form = new FormData();
      form.set('kind', kind);
      form.set('file', new Blob([bytes], { type }), `${kind}.bin`);
      return call('POST', '/v1/kyc/case/documents', { headers, form });
    },
  };
}

async function call(method, path, { headers = {}, body, form } = {}) {
  const res = await fetch(`${server.base}${path}`, {
    method,
    headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'idempotency-key': `kyc-${Date.now()}-${Math.random()}` } : {}) },
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

/** Fills in and submits a whole check. */
async function complete(person, { kyb = null, idNumber = `A${Math.floor(Math.random() * 1e8)}` } = {}) {
  assert.equal((await person.put('consent', { consent: true })).status, 200);
  if (kyb) {
    const business = await person.put('business', kyb === 'registered' ? { business_type: 'registered', registered_name: 'Ada Digital Ltd', registration_number: 'RC123456', business_address: '1 Marina, Lagos' } : { business_type: 'unregistered' });
    assert.equal(business.status, 200, JSON.stringify(business.json));
    if (kyb === 'registered') {
      for (const kind of ['business_registration', 'business_address', 'business_directors']) assert.equal((await person.upload(kind, pdf(), 'application/pdf')).status, 200);
    }
  }
  const identity = await person.put('identity', { id_type: 'drivers_licence', id_number: idNumber, full_name: 'Ada Obi', date_of_birth: '1990-04-01' });
  assert.equal(identity.status, 200, JSON.stringify(identity.json));
  assert.equal((await person.upload('id_front', jpeg(), 'image/jpeg')).status, 200);
  assert.equal((await person.upload('id_back', png(), 'image/png')).status, 200);
  assert.equal((await person.upload('selfie', jpeg('SELFIE'), 'image/jpeg')).status, 200);
  const steps = (await person.post('liveness')).json.liveness.steps;
  for (let step = 0; step < steps.length; step += 1) {
    for (let frame = 0; frame < 3; frame += 1) assert.equal((await person.upload(`liveness_${step}_${frame}`, jpeg(), 'image/jpeg')).status, 200);
  }
  const submitted = await person.post('submit');
  assert.equal(submitted.status, 200, JSON.stringify(submitted.json));
  return submitted.json;
}

/** A reseller (owner signed in) whose KYB an admin approves as registered or unregistered; its store published and live. */
async function verifiedReseller(type) {
  const reseller = await resellerClient(server, { country: 'NG' });
  await reseller.browser.post('/v1/auth/email/verify', { code: await lastEmailCode(server.app, reseller.email) });
  const started = await reseller.browser.post('/v1/account/verification', { consent: true });
  assert.equal(started.status, 201, JSON.stringify(started.json));
  const person = await applicant(started.json.url);
  const done = await complete(person, { kyb: type });
  const approved = await admin.post(`/v1/admin/kyc/cases/${done.id}/approve`, { verified_name: 'Ada Obi' });
  assert.equal(approved.status, 200, JSON.stringify(approved.json));
  const store = await reseller.browser.post('/v1/stores', { name: `Ada ${type}`, subdomain: `ada${type.slice(0, 3)}${Date.now().toString(36)}` });
  assert.equal((await reseller.browser.post(`/v1/stores/${store.json.id}/publish`)).status, 200);
  assert.equal((await reseller.browser.patch(`/v1/stores/${store.json.id}`, { checkout_mode: 'live' })).status, 200);
  return { ...reseller, store: store.json };
}

let shopperCount = 0;
/** A customer of a store who starts their check there (as the store's server does). */
async function storeCustomer(subdomain) {
  const email = `verify${(shopperCount += 1)}-${Date.now()}@example.com`;
  let session = null;
  const store = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'bitocard-store': subdomain, ...(session ? { 'bitocard-customer-session': session } : {}), ...(method === 'POST' ? { 'idempotency-key': `s-${Math.random()}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (json?.session?.token) session = json.session.token;
    return { status: res.status, json };
  };
  const signup = await store('POST', '/v1/store/account/signup', { name: 'Chi Okafor', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await store('POST', '/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) });
  const started = await store('POST', '/v1/store/account/verification', { country: 'NG', first_name: 'Chi', last_name: 'Okafor', redirect_url: `https://${subdomain}.bitocard.com/account/verification`, consent: true });
  assert.equal(started.status, 201, JSON.stringify(started.json));
  return { id: signup.json.customer.id, email, store, url: started.json.url };
}

/** A document's bytes as a signed-in browser loads them (an `<img>`: the session cookie, no account header). */
async function download(browser, path) {
  const cookie = [...browser.jar].map(([name, value]) => `${name}=${value}`).join('; ');
  const res = await fetch(`${server.base}${path}`, { headers: { cookie } });
  return { status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), bytes: Buffer.from(await res.arrayBuffer()) };
}

describe('who checks identities', () => {
  test('BitoCard Verify across Africa, Didit elsewhere; admins can change a market', async () => {
    const { IdentityService } = await import('../dist/identity/identity.service.js');
    const identity = server.app.get(IdentityService);
    assert.deepEqual(await Promise.all(['NG', 'GH', 'KE', 'ZA', 'US', 'GB'].map(code => identity.providerFor(code))), ['bitocard', 'bitocard', 'bitocard', 'bitocard', 'didit', 'didit']);
    const countries = (await fetch(`${server.base}/v1/countries`).then(res => res.json())).data;
    assert.equal(countries.find(item => item.code === 'NG').identity_provider, 'bitocard');
    assert.equal((await admin.patch('/v1/admin/countries/KE', { identity_provider: 'didit' })).status, 200);
    assert.equal(await identity.providerFor('KE'), 'didit');
    assert.equal((await admin.patch('/v1/admin/countries/KE', { identity_provider: 'bitocard' })).status, 200);
  });
});

describe('a registered business’s KYB', () => {
  test('one-use link, checked and stripped files, encrypted private storage, admin review that verifies the business', async () => {
    const reseller = await resellerClient(server, { country: 'NG' });
    await reseller.browser.post('/v1/auth/email/verify', { code: await lastEmailCode(server.app, reseller.email) });
    const started = await reseller.browser.post('/v1/account/verification', { consent: true });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    assert.deepEqual([started.json.provider, started.json.kind, started.json.status], ['bitocard', 'kyb', 'in_progress']);
    assert.match(started.json.url, /^https:\/\/verify\.example\/s#t=bkh_/);

    const person = await applicant(started.json.url);
    const again = await call('POST', '/v1/kyc/session', { body: { token: person.token } });
    assert.deepEqual([again.status, again.json.error.code], [404, 'kyc_link_invalid'], 'a link works once');
    // Reads never hand out the spent link; continuing asks again and gets a fresh one into the same case.
    const open = (await reseller.browser.get('/v1/account/verification')).json;
    assert.deepEqual([open.status, open.url], ['in_progress', null]);
    const resumed = await reseller.browser.post('/v1/account/verification', { consent: true });
    assert.notEqual(resumed.json.url, started.json.url);
    assert.equal((await applicant(resumed.json.url)).case.id, person.case.id, 'the same case, resumed');
    assert.equal((await call('GET', '/v1/kyc/case', { headers: { 'bitocard-kyc-session': 'bks_made_up' } })).status, 401);
    assert.deepEqual([person.case.kind, person.case.status, person.case.brand.name], ['kyb', 'draft', 'BitoCard']);
    assert.ok(person.case.id_types.some(item => item.code === 'nin_slip'), 'Nigerian ID types');

    const early = await person.post('submit');
    assert.deepEqual([early.status, early.json.error.code], [400, 'case_incomplete']);
    assert.equal((await person.put('business', { business_type: 'registered' })).json.error.code, 'parameter_missing');

    // Files are checked from their bytes.
    await person.put('consent', { consent: true });
    await person.put('identity', { id_type: 'drivers_licence', id_number: 'ABC12345', full_name: 'Ada Obi', date_of_birth: '1990-04-01' });
    assert.equal((await person.upload('id_front', Buffer.from('<html>not a photo</html>'), 'image/jpeg')).json.error.code, 'file_type_invalid');
    assert.equal((await person.upload('id_front', pdf(), 'application/pdf')).json.error.code, 'file_type_invalid', 'IDs are photos');
    assert.equal((await person.upload('business_registration', pdf(), 'application/pdf')).json.error.code, 'document_kind_invalid', 'no business documents before choosing registered');
    assert.equal((await person.upload('liveness_0_0', jpeg(), 'image/jpeg')).json.error.code, 'document_kind_invalid', 'no frames before the steps are issued');
    const minor = await person.put('identity', { id_type: 'drivers_licence', id_number: 'ABC12345', full_name: 'Ada Obi', date_of_birth: '2015-01-01' });
    assert.equal(minor.json.error.code, 'underage');

    await complete(person, { kyb: 'registered', idNumber: 'DL-55501' });
    assert.ok([...objects.values()].length >= 10);
    for (const object of objects.values()) {
      assert.equal(object.body.subarray(0, 4).toString(), 'BCK1', 'sealed before it leaves');
      assert.equal(object.acl, 'private');
      assert.ok(!object.body.includes(Buffer.from('GPSDATA')) && !object.body.includes(Buffer.from('%PDF')), 'the bucket never sees a readable file');
    }
    const verification = await prisma.identityVerification.findFirstOrThrow({ where: { resellerId: reseller.resellerId, provider: 'bitocard' } });
    assert.equal(verification.status, 'in_review');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'admin.kyc.submitted' } }));
    assert.equal((await person.put('consent', { consent: true })).json.error.code, 'case_locked', 'nothing changes once submitted');

    const list = await admin.get('/v1/admin/kyc/cases?status=submitted&subject=reseller');
    const listed = list.json.data.find(item => item.applicant.id === reseller.resellerId);
    assert.ok(listed, JSON.stringify(list.json));
    const detail = (await admin.get(`/v1/admin/kyc/cases/${listed.id}`)).json;
    assert.deepEqual([detail.identity.id_number, detail.business.registered_name, detail.liveness.steps.length], ['DL-55501', 'Ada Digital Ltd', 2]);
    const front = detail.documents.find(item => item.kind === 'id_front');
    const file = await download(admin, front.url);
    assert.deepEqual([file.status, file.type, file.cache], [200, 'image/jpeg', 'no-store, private']);
    assert.ok(file.bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])) && !file.bytes.includes(Buffer.from('GPSDATA')), 'EXIF removed');
    const back = await download(admin, detail.documents.find(item => item.kind === 'id_back').url);
    assert.ok(!back.bytes.includes(Buffer.from('PHONE-SECRET')), 'PNG text removed');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'kyc.document_viewed', targetId: listed.id } }), 'views are audited');

    const support = await adminClient(server, ['support']);
    assert.equal((await support.post(`/v1/admin/kyc/cases/${listed.id}/approve`, { verified_name: 'Ada Obi' })).status, 403, 'support reads, operations decide');
    const approved = await admin.post(`/v1/admin/kyc/cases/${listed.id}/approve`, { verified_name: 'Ada Obi' });
    assert.equal(approved.status, 200, JSON.stringify(approved.json));
    const after = await prisma.reseller.findUniqueOrThrow({ where: { id: reseller.resellerId } });
    assert.deepEqual([after.businessType, after.registeredName, after.registrationNumber, Boolean(after.kybVerifiedAt), after.verifiedName, after.status], ['registered', 'Ada Digital Ltd', 'RC123456', true, 'Ada Obi', 'active']);
    const status = (await reseller.browser.get('/v1/account/verification')).json;
    assert.deepEqual([status.verified, status.kyb_verified, status.business_type], [true, true, 'registered']);
    assert.equal((await admin.post(`/v1/admin/kyc/cases/${listed.id}/approve`, { verified_name: 'Ada Obi' })).json.error.code, 'case_not_reviewable', 'decided once');
  });
});

describe('customers’ checks', () => {
  test('a registered, KYB-verified store reviews its own customers; its approval is final', async () => {
    const seller = await verifiedReseller('registered');
    const shopper = await storeCustomer(seller.store.subdomain);
    const person = await applicant(shopper.url);
    assert.deepEqual([person.case.kind, person.case.brand.name], ['kyc', seller.store.name]);
    const done = await complete(person, { idNumber: 'NIN-777' });
    const record = await prisma.kycCase.findUniqueOrThrow({ where: { id: done.id } });
    assert.equal(record.reviewer, 'reseller');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'kyc.customer_submitted', resellerId: seller.resellerId } }));

    assert.deepEqual((await seller.browser.get('/v1/kyc/reviews/eligibility')).json.eligible, true);
    const queue = (await seller.browser.get('/v1/kyc/reviews')).json.data;
    assert.ok(queue.some(item => item.id === done.id));
    const detail = (await seller.browser.get(`/v1/kyc/reviews/${done.id}`)).json;
    assert.deepEqual([detail.applicant.email, detail.identity.id_number], [shopper.email, 'NIN-777']);
    const selfie = await download(seller.browser, detail.documents.find(item => item.kind === 'selfie').url);
    assert.equal(selfie.status, 200);

    const approved = await seller.browser.post(`/v1/kyc/reviews/${done.id}/approve`, { verified_name: 'Chi Okafor' });
    assert.equal(approved.status, 200, JSON.stringify(approved.json));
    assert.equal(approved.json.decided_by.realm, 'reseller');
    const status = (await shopper.store('GET', '/v1/store/account/verification?country=NG')).json;
    assert.deepEqual([status.verified, status.provider], [true, 'bitocard'], 'the store’s gates read it');
    assert.ok(await prisma.event.findFirst({ where: { resellerId: seller.resellerId, type: 'customer_verification.approved' } }));
    const customers = (await seller.browser.get(`/v1/stores/${seller.store.id}/customers/${shopper.id}`)).json;
    assert.deepEqual([customers.identity_checked, customers.identity_case.reviewable], [true, true]);

    // BitoCard can still overturn it.
    const revoked = await admin.post(`/v1/admin/kyc/cases/${done.id}/decline`, { reason: 'suspected_fraud', note: 'Same face on other accounts.' });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.json));
    assert.equal((await shopper.store('GET', '/v1/store/account/verification?country=NG')).json.verified, false);
  });

  test('an unregistered business never sees its customers’ documents: BitoCard reviews them', async () => {
    const seller = await verifiedReseller('unregistered');
    const row = await prisma.reseller.findUniqueOrThrow({ where: { id: seller.resellerId } });
    assert.deepEqual([row.businessType, row.kybVerifiedAt, Boolean(row.verifiedAt)], ['unregistered', null, true]);
    const shopper = await storeCustomer(seller.store.subdomain);
    const done = await complete(await applicant(shopper.url));
    assert.equal((await prisma.kycCase.findUniqueOrThrow({ where: { id: done.id } })).reviewer, 'admin');
    assert.deepEqual((await seller.browser.get('/v1/kyc/reviews/eligibility')).json, { object: 'kyc_review_eligibility', eligible: false, reason: 'not_registered', reseller: { id: seller.resellerId, name: row.name } });
    assert.equal((await seller.browser.get('/v1/kyc/reviews')).json.error.code, 'kyb_reviewer_required');
    assert.equal((await seller.browser.get(`/v1/kyc/reviews/${done.id}`)).status, 404);
    const document = await prisma.kycDocument.findFirstOrThrow({ where: { caseId: done.id } });
    assert.equal((await download(seller.browser, `/v1/kyc/reviews/${done.id}/documents/${document.id}`)).status, 404);
    assert.equal((await seller.browser.get(`/v1/stores/${seller.store.id}/customers/${shopper.id}`)).json.identity_case.reviewable, false);
  });

  test('asking for items again keeps the rest; the same ID on another case is flagged; declining closes the check', async () => {
    const seller = await verifiedReseller('unregistered');
    const first = await storeCustomer(seller.store.subdomain);
    const one = await complete(await applicant(first.url), { idNumber: 'dup-4242' });
    const second = await storeCustomer(seller.store.subdomain);
    const person = await applicant(second.url);
    const two = await complete(person, { idNumber: 'DUP 4242' });
    const detail = (await admin.get(`/v1/admin/kyc/cases/${two.id}`)).json;
    assert.deepEqual(detail.duplicates.map(item => item.case_id), [one.id], 'same ID number, however it was typed');

    const asked = await admin.post(`/v1/admin/kyc/cases/${two.id}/resubmit`, { items: ['id_front', 'liveness'], note: 'Your photo was blurred.' });
    assert.equal(asked.status, 200, JSON.stringify(asked.json));
    const open = (await person.get()).json;
    assert.deepEqual([open.status, open.resubmit_items, open.note], ['resubmit', ['id_front', 'liveness'], 'Your photo was blurred.']);
    assert.deepEqual(open.missing.sort(), ['id_front', 'liveness']);
    assert.equal((await person.put('identity', { id_type: 'passport', id_number: 'X1234567', full_name: 'Chi Okafor', date_of_birth: '1990-01-01' })).json.error.code, 'case_locked', 'only what was asked for');
    assert.equal((await person.upload('id_front', jpeg(), 'image/jpeg')).status, 200);
    const steps = (await person.post('liveness')).json.liveness.steps;
    for (let step = 0; step < steps.length; step += 1) for (let frame = 0; frame < 3; frame += 1) await person.upload(`liveness_${step}_${frame}`, jpeg(), 'image/jpeg');
    assert.equal((await person.post('submit')).json.status, 'submitted');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'kyc.resubmit_requested', targetId: two.id } }));

    const declined = await admin.post(`/v1/admin/kyc/cases/${two.id}/decline`, { reason: 'document_mismatch' });
    assert.equal(declined.status, 200);
    assert.equal((await person.get()).json.reason, 'document_mismatch');
    const verification = await prisma.identityVerification.findFirstOrThrow({ where: { providerReference: two.id } });
    assert.equal(verification.status, 'declined');
    const { EmailService } = await import('../dist/notifications/email.service.js');
    assert.ok(server.app.get(EmailService).outbox.some(item => item.to === second.email && /not approved/.test(item.subject)));

    // Retention: a declined case's documents go after 90 days.
    const { KycService } = await import('../dist/kyc/kyc.service.js');
    const keys = (await prisma.kycDocument.findMany({ where: { caseId: two.id } })).map(item => item.objectKey);
    await server.app.get(KycService).job(new Date(Date.now() + 91 * 24 * 3600_000));
    assert.equal(await prisma.kycDocument.count({ where: { caseId: two.id } }), 0);
    assert.ok(keys.every(key => ![...objects.keys()].some(stored => stored.endsWith(key))), 'deleted from the bucket');
  });
});

describe('Ghana reserved accounts', () => {
  test('GHS accounts send the holder’s names and phone, never a BVN', async () => {
    const calls = [];
    const flutterwave = await fakeService(call => {
      calls.push(call.body);
      return { body: { status: 'success', data: { account_number: '1234567890', bank_name: 'First Bank Ghana' } } };
    });
    try {
      const { FlutterwaveProvider } = await import('../dist/payments/flutterwave.provider.js');
      const provider = new FlutterwaveProvider('FLWSECK-test', flutterwave.url);
      await provider.createReservedAccount({ reference: 'bc_ra_live_x', email: 'ama@example.com', name: 'Ama Mensah Trading Enterprise Limited', currency: 'GHS', firstName: 'Ama', lastName: 'Mensah', phone: '+233241234567' });
      assert.deepEqual(calls[0], { currency: 'GHS', is_permanent: true, email: 'ama@example.com', firstname: 'Ama', lastname: 'Mensah', phonenumber: '+233241234567', tx_ref: 'bc_ra_live_x', narration: 'Ama Mensah Trading Enterprise Limit' });
      const { ghanaPhone } = await import('../dist/payments/payments.service.js');
      assert.equal(ghanaPhone('024 123 4567'), '+233241234567');
      assert.throws(() => ghanaPhone('+2348012345678'), /Ghanaian phone number/);
    } finally {
      await flutterwave.close();
    }
  });
});
