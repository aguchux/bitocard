// Verify in Afrippa's name (docs/CRYPTO_SPINOFF_PLAN.md, step 2 item 6 and step 4 part 4): a trader starts their check
// through Afrippa's signed server; its link is on verify.afrippa.com and opens only on Afrippa's Verify routes
// (`/v1/afrippa/kyc`), its documents are sealed in Afrippa's own private bucket, and only Afrippa's admins review it
// (`/v1/afrippa/admin/kyc/cases`). BitoCard's Verify, admins and lists never reach it, nor Afrippa's BitoCard's.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, afrippaAdminClient, fakeService, startApp } from './helpers.mjs';

const { signAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { afrippaStoreId } = await import('../dist/afrippa/ids.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { EmailService } = await import('../dist/notifications/email.service.js');

const secret = 'afrippa-verify-secret-afrippa-verify-secret';
let server;
let prisma;
let afrippaBucket;
let bitocardBucket;
let afrippaAdmin;
let counter = 0;

/** A fake Spaces bucket, keeping each object as it was stored. */
function bucket() {
  const objects = new Map();
  return fakeService(call => {
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
  }).then(service => Object.assign(service, { objects }));
}

before(async () => {
  afrippaBucket = await bucket();
  bitocardBucket = await bucket();
  server = await startApp({
    env: { CRYPTO_ROUTES: 'closed', AFRIPPA_SERVER_SECRET: secret, KYC_SPACES_KEY: 'bc-key', KYC_SPACES_SECRET: 'bc-secret', KYC_SPACES_BUCKET: 'bitocard-private', KYC_SPACES_ENDPOINT: bitocardBucket.url },
  });
  prisma = server.app.get(PrismaService);
  afrippaAdmin = await afrippaAdminClient(server, ['super_admin']);
  const saved = await afrippaAdmin.put('/v1/afrippa/admin/integrations/kyc_storage', {
    values: { KYC_SPACES_KEY: 'afrippa-key', KYC_SPACES_SECRET: 'afrippa-secret', KYC_SPACES_BUCKET: 'afrippa-private', KYC_SPACES_ENDPOINT: afrippaBucket.url },
    code: await adminCode(server, afrippaAdmin),
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
});

after(async () => {
  await server?.close();
  await afrippaBucket?.close();
  await bitocardBucket?.close();
});

function afrippaServer(token = null) {
  const request = async (method, path, body) => {
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        'afrippa-signature': signAfrippaRequest(secret, { method, url: path, body: raw }),
        ...(raw !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `verify-${Date.now()}-${Math.random()}` } : {}),
      },
      body: raw,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

const outbox = () => server.app.get(EmailService).outbox;
const lastCodeTo = email => /\b(\d{6})\b/.exec(outbox().filter(item => item.to === email).at(-1).subject)[1];

async function trader(name = 'Ada Trader Obi') {
  const client = afrippaServer();
  const email = `verify-trader${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await client.post('/v1/afrippa/account/signup', { name, email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await prisma.customer.update({ where: { id: signup.json.customer.id }, data: { emailVerifiedAt: new Date() } });
  await prisma.customerCode.updateMany({ where: { customer: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup', { method: 'email' })).status, 200);
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup/confirm', { code: lastCodeTo(email) })).status, 200);
  return { client, id: signup.json.customer.id, email };
}

async function call(method, path, { headers = {}, body, form } = {}) {
  const res = await fetch(`${server.base}${path}`, {
    method,
    headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'idempotency-key': `kyc-${Date.now()}-${Math.random()}` } : {}) },
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  return { status: res.status, json: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null };
}

/** verify.afrippa.com's server: the session from the link, then Afrippa's Verify routes with it. */
function applicant(session, base = '/v1/afrippa/kyc/case') {
  const headers = { 'bitocard-kyc-session': session };
  return {
    get: () => call('GET', base, { headers }),
    put: (path, body) => call('PUT', `${base}/${path}`, { headers, body }),
    post: (path, body = {}) => call('POST', `${base}/${path}`, { headers, body }),
    upload: (kind, bytes, type) => {
      const form = new FormData();
      form.set('kind', kind);
      form.set('file', new Blob([bytes], { type }), `${kind}.bin`);
      return call('POST', `${base}/documents`, { headers, form });
    },
  };
}

const u16 = value => Buffer.from([value >> 8, value & 0xff]);
function jpeg() {
  const exif = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from('GPSDATA-LAGOS')]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), u16(exif.length + 2), exif]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x30, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, sos, Buffer.from(`pixels-${Math.random()}`), Buffer.from([0xff, 0xd9])]);
}

describe("A trader's identity check", () => {
  test('the sandbox simulates it, through Afrippa’s server only', async () => {
    const { client } = await trader();
    const status = (await client.get('/v1/afrippa/account/verification')).json;
    assert.deepEqual([status.mode, status.verified, status.latest], ['test', false, null]);
    const started = await client.post('/v1/afrippa/account/verification', { consent: true });
    assert.equal(started.status, 200, JSON.stringify(started.json));
    assert.equal((await client.post('/v1/afrippa/account/verification/simulate', { outcome: 'approved' })).status, 200);
    assert.equal((await client.get('/v1/afrippa/account/verification')).json.verified, true);
    // Consent is required; unsigned requests never reach it.
    assert.equal((await client.post('/v1/afrippa/account/verification', { consent: false })).status, 400);
    assert.equal((await call('GET', '/v1/afrippa/account/verification')).status, 404);
  });

  test("live: on verify.afrippa.com, documents in Afrippa's bucket, reviewed by Afrippa's admins only", async () => {
    await prisma.store.update({ where: { id: afrippaStoreId }, data: { checkoutMode: 'live' } });
    try {
      const ada = await trader('Ada Trader Obi');
      const started = await ada.client.post('/v1/afrippa/account/verification', { consent: true });
      assert.equal(started.status, 200, JSON.stringify(started.json));
      assert.match(started.json.url, /^https:\/\/verify\.afrippa\.com\/s#t=bkh_/);
      const token = new URL(started.json.url).hash.replace('#t=', '');

      // BitoCard's Verify does not know the link (and does not spend it); Afrippa's opens it, once.
      const wrong = await call('POST', '/v1/kyc/session', { body: { token } });
      assert.deepEqual([wrong.status, wrong.json.error.code], [404, 'kyc_link_invalid']);
      const exchanged = await call('POST', '/v1/afrippa/kyc/session', { body: { token } });
      assert.equal(exchanged.status, 200, JSON.stringify(exchanged.json));
      assert.equal(exchanged.json.case.brand.name, 'Afrippa');
      assert.equal(exchanged.json.case.kind, 'kyc');
      assert.equal((await call('POST', '/v1/afrippa/kyc/session', { body: { token } })).status, 404, 'once');
      const session = exchanged.json.session.token;
      assert.equal((await applicant(session, '/v1/kyc/case').get()).status, 401, "never on BitoCard's Verify routes");

      const person = applicant(session);
      assert.equal((await person.put('consent', { consent: true })).status, 200);
      const identity = await person.put('identity', { id_type: 'drivers_licence', id_number: `DL-${Date.now()}`, full_name: 'Ada Trader Obi', date_of_birth: '1990-04-01' });
      assert.equal(identity.status, 200, JSON.stringify(identity.json));
      for (const kind of ['id_front', 'id_back', 'selfie']) assert.equal((await person.upload(kind, jpeg(), 'image/jpeg')).status, 200, kind);
      const steps = (await person.post('liveness')).json.liveness.steps;
      for (let step = 0; step < steps.length; step += 1) for (let frame = 0; frame < 3; frame += 1) assert.equal((await person.upload(`liveness_${step}_${frame}`, jpeg(), 'image/jpeg')).status, 200);
      const submitted = await person.post('submit');
      assert.equal(submitted.status, 200, JSON.stringify(submitted.json));
      const caseId = submitted.json.id;

      // Sealed in Afrippa's bucket only.
      assert.ok([...afrippaBucket.objects.keys()].some(key => key.includes(`/kyc/${caseId}/`)));
      assert.ok(![...bitocardBucket.objects.keys()].some(key => key.includes(`/kyc/${caseId}/`)));

      // Afrippa's admins are told; BitoCard's admins never see the case or its check.
      assert.ok(await prisma.notification.findFirst({ where: { type: 'admin.afrippa.kyc_submitted', link: `/verifications/${caseId}` } }));
      const bitocard = await adminClient(server, ['super_admin']);
      assert.ok(!(await bitocard.get('/v1/admin/kyc/cases?status=all')).json.data.some(item => item.id === caseId));
      assert.equal((await bitocard.get(`/v1/admin/kyc/cases/${caseId}`)).status, 404);
      assert.ok(!(await bitocard.get('/v1/admin/verifications?limit=100')).json.data.some(item => item.reseller_id === '00000000-0000-4000-8000-0000000000a1'));
      assert.equal((await bitocard.get(`/v1/afrippa/admin/kyc/cases/${caseId}`)).status >= 401, true);

      // Afrippa's admins review it, with its documents.
      const listed = (await afrippaAdmin.get('/v1/afrippa/admin/kyc/cases')).json.data;
      assert.ok(listed.some(item => item.id === caseId));
      assert.ok(listed.every(item => item.reseller.name === 'Afrippa'), 'only Afrippa’s cases');
      const detail = (await afrippaAdmin.get(`/v1/afrippa/admin/kyc/cases/${caseId}`)).json;
      assert.equal(detail.applicant.name, 'Ada Trader Obi');
      assert.match(detail.documents[0].url, new RegExp(`^/v1/afrippa/admin/kyc/cases/${caseId}/documents/`));
      const cookie = [...afrippaAdmin.jar].map(([name, value]) => `${name}=${value}`).join('; ');
      const file = await fetch(`${server.base}${detail.documents.find(item => item.kind === 'selfie').url}`, { headers: { cookie } });
      const bytes = Buffer.from(await file.arrayBuffer());
      assert.deepEqual([file.status, file.headers.get('content-type'), file.headers.get('cache-control')], [200, 'image/jpeg', 'no-store, private']);
      assert.ok(bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])) && !bytes.includes(Buffer.from('GPSDATA')), 'opened from Afrippa’s bucket, metadata removed');
      const approved = await afrippaAdmin.post(`/v1/afrippa/admin/kyc/cases/${caseId}/approve`, { verified_name: 'Ada Trader Obi' });
      assert.equal(approved.status, 200, JSON.stringify(approved.json));
      assert.equal(approved.json.decided_by.name, 'Afrippa');

      // The trader is verified, told from Afrippa, and the decision is in Afrippa's trail.
      assert.equal((await ada.client.get('/v1/afrippa/account/verification')).json.verified, true);
      assert.ok(outbox().some(item => item.to === ada.email && /verified|approved/i.test(item.subject)));
      const audited = await prisma.auditLog.findFirst({ where: { action: 'kyc.approved', targetId: caseId } });
      assert.equal(audited.platform, 'afrippa');
    } finally {
      await prisma.store.update({ where: { id: afrippaStoreId }, data: { checkoutMode: 'test' } });
    }
  });
});
