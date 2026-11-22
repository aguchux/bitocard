// Resellers sell as an individual or a business: the business profile (legal name, address, phone, description), and
// switching type. A live individual switching to business is paused until its business passes KYB (only the business
// and its documents are asked, the owner's identity already approved); switching back makes it live again.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, fakeService, lastEmailCode, resellerClient, startApp } from './helpers.mjs';

let server;
let admin;
let prisma;
let bucket;

before(async () => {
  const objects = new Map();
  bucket = await fakeService(call => {
    const key = decodeURIComponent(new URL(call.url, 'http://x').pathname);
    if (call.method === 'PUT') {
      objects.set(key, call.raw);
      return { status: 200, body: '' };
    }
    if (call.method === 'GET') return objects.has(key) ? { status: 200, body: objects.get(key) } : { status: 404, body: '' };
    if (call.method === 'DELETE') {
      objects.delete(key);
      return { status: 204, body: '' };
    }
    return { status: 405, body: '' };
  });
  server = await startApp({
    env: {
      KYC_SPACES_KEY: 'k',
      KYC_SPACES_SECRET: 's',
      KYC_SPACES_BUCKET: 'kyc',
      KYC_SPACES_ENDPOINT: bucket.url,
      VERIFY_URL: 'https://verify.example',
    },
  });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server);
});

after(async () => {
  await server?.close();
  await bucket?.close();
});

function jpeg() {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x30, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, sos, Buffer.from(`pixels-${Math.random()}`), Buffer.from([0xff, 0xd9])]);
}
const pdf = () => Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');

async function call(method, path, { headers = {}, body, form } = {}) {
  const res = await fetch(`${server.base}${path}`, {
    method,
    headers: {
      ...headers,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'idempotency-key': `acct-${Date.now()}-${Math.random()}` } : {}),
    },
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function applicant(url) {
  const exchanged = await call('POST', '/v1/kyc/session', {
    body: { token: new URL(url).hash.replace('#t=', '') },
  });
  assert.equal(exchanged.status, 200, JSON.stringify(exchanged.json));
  const headers = { 'bitocard-kyc-session': exchanged.json.session.token };
  return {
    case: exchanged.json.case,
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

/** An individual reseller whose identity check BitoCard approved and an admin activated. */
async function liveIndividual() {
  const reseller = await resellerClient(server, { country: 'NG' });
  await reseller.browser.post('/v1/auth/email/verify', {
    code: await lastEmailCode(server.app, reseller.email),
  });
  const started = await reseller.browser.post('/v1/account/verification', {
    consent: true,
  });
  assert.equal(started.json.account_type, 'individual');
  const person = await applicant(started.json.url);
  assert.deepEqual([person.case.business_type, person.case.business_types], ['unregistered', ['unregistered']], 'an individual is checked as one');
  assert.equal(
    (
      await person.put('business', {
        business_type: 'registered',
        registered_name: 'Ada Digital Ltd',
        registration_number: 'RC123456',
        business_address: '1 Marina, Lagos',
      })
    ).json.error.code,
    'business_type_not_allowed',
  );
  await person.put('consent', { consent: true });
  await person.put('identity', {
    id_type: 'drivers_licence',
    id_number: `A${Math.floor(Math.random() * 1e8)}`,
    full_name: 'Ada Obi',
    date_of_birth: '1990-04-01',
  });
  for (const kind of ['id_front', 'id_back', 'selfie']) assert.equal((await person.upload(kind, jpeg(), 'image/jpeg')).status, 200);
  const steps = (await person.post('liveness')).json.liveness.steps;
  for (let step = 0; step < steps.length; step += 1) for (let frame = 0; frame < 3; frame += 1) await person.upload(`liveness_${step}_${frame}`, jpeg(), 'image/jpeg');
  const submitted = await person.post('submit');
  assert.equal(submitted.status, 200, JSON.stringify(submitted.json));
  assert.equal(
    (
      await admin.post(`/v1/admin/kyc/cases/${submitted.json.id}/approve`, {
        verified_name: 'Ada Obi',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await admin.patch(`/v1/admin/resellers/${reseller.resellerId}`, {
        status: 'active',
      })
    ).status,
    200,
  );
  return reseller;
}

describe('the business profile', () => {
  test('owners and admins keep the legal name, address, phone and description; empty clears one', async () => {
    const reseller = await resellerClient(server, { country: 'NG' });
    const empty = (await reseller.browser.get('/v1/reseller/profile')).json;
    assert.deepEqual([empty.object, empty.account_type, empty.legal_name, empty.business_verified], ['business_profile', 'individual', null, false]);
    const saved = await reseller.browser.patch('/v1/reseller/profile', {
      legal_name: ' Golojan Ltd ',
      address_line: '1 Marina',
      city: 'Lagos Island',
      state: 'Lagos',
      postal_code: '101001',
      phone: '+234 803 123 4567',
      description: 'Gift cards and airtime for Lagos.',
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual([saved.json.legal_name, saved.json.city, saved.json.state, saved.json.phone], ['Golojan Ltd', 'Lagos Island', 'Lagos', '+234 803 123 4567']);
    assert.equal(
      (
        await reseller.browser.patch('/v1/reseller/profile', {
          phone: 'call me',
        })
      ).status,
      400,
      'a telephone number',
    );
    assert.equal(
      (
        await reseller.browser.patch('/v1/reseller/profile', {
          postal_code: '',
        })
      ).json.postal_code,
      null,
    );
    assert.ok(
      await prisma.auditLog.findFirst({
        where: {
          action: 'reseller.profile_updated',
          targetId: reseller.resellerId,
        },
      }),
    );
  });
});

describe('switching between individual and business', () => {
  test('a live individual switching to business is paused until its business passes KYB, asked only for the business', async () => {
    const reseller = await liveIndividual();
    await reseller.browser.patch('/v1/reseller/profile', {
      legal_name: 'Ada Digital Ltd',
      address_line: '1 Marina',
      city: 'Lagos',
      state: 'Lagos',
    });
    assert.equal(
      (
        await reseller.browser.post('/v1/account/verification/business', {
          consent: true,
        })
      ).json.error.code,
      'account_type_individual',
    );

    const switched = await reseller.browser.put('/v1/reseller/account-type', {
      account_type: 'business',
    });
    assert.equal(switched.status, 200, JSON.stringify(switched.json));
    assert.deepEqual([switched.json.account_type, switched.json.status, switched.json.paused_for_kyb], ['business', 'pending', true]);

    const started = await reseller.browser.post('/v1/account/verification/business', { consent: true });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    assert.match(started.json.business_url, /^https:\/\/verify\.example\/s#t=bkh_/);
    assert.deepEqual([started.json.verified, started.json.paused_for_kyb, started.json.business_check.status], [true, true, 'in_progress']);
    const person = await applicant(started.json.business_url);
    assert.equal(person.case.owner_verified, true);
    assert.deepEqual(person.case.required, ['consent', 'business'], 'no identity, ID photos or liveness again');
    assert.deepEqual(
      [person.case.business_types, person.case.business.registered_name, person.case.business.business_address],
      [['registered'], 'Ada Digital Ltd', '1 Marina, Lagos, Lagos'],
      'prefilled from the profile',
    );
    await person.put('consent', { consent: true });
    assert.equal(
      (
        await person.put('business', {
          business_type: 'registered',
          registered_name: 'Ada Digital Ltd',
          registration_number: 'RC123456',
          business_address: '1 Marina, Lagos',
        })
      ).status,
      200,
    );
    for (const kind of ['business_registration', 'business_address', 'business_directors']) assert.equal((await person.upload(kind, pdf(), 'application/pdf')).status, 200);
    assert.equal((await person.upload('selfie', jpeg(), 'image/jpeg')).json.error.code, 'document_kind_invalid');
    const submitted = await person.post('submit');
    assert.equal(submitted.status, 200, JSON.stringify(submitted.json));
    assert.equal(
      (
        await reseller.browser.put('/v1/reseller/account-type', {
          account_type: 'individual',
        })
      ).json.error.code,
      'verification_in_review',
      'not while it is reviewed',
    );

    const detail = (await admin.get(`/v1/admin/kyc/cases/${submitted.json.id}`)).json;
    assert.deepEqual([detail.owner_verified, detail.identity], [true, null]);
    assert.equal(
      (
        await admin.post(`/v1/admin/kyc/cases/${submitted.json.id}/approve`, {
          verified_name: 'Ada Obi',
        })
      ).status,
      200,
    );
    const after = await prisma.reseller.findUniqueOrThrow({
      where: { id: reseller.resellerId },
    });
    assert.deepEqual(
      [after.status, after.accountType, after.businessType, after.registeredName, Boolean(after.kybVerifiedAt), after.kybPausedAt, after.verifiedName],
      ['active', 'business', 'registered', 'Ada Digital Ltd', true, null, 'Ada Obi'],
      'live again as a business',
    );
    const status = (await reseller.browser.get('/v1/account/verification')).json;
    assert.deepEqual([status.kyb_verified, status.business_check.status, status.paused_for_kyb], [true, 'approved', false]);
    assert.ok(
      await prisma.auditLog.findFirst({
        where: {
          action: 'reseller.kyb_resumed',
          targetId: reseller.resellerId,
        },
      }),
    );

    // A verified business switches type without being paused.
    assert.equal(
      (
        await reseller.browser.put('/v1/reseller/account-type', {
          account_type: 'individual',
        })
      ).json.status,
      'active',
    );
    const back = await reseller.browser.put('/v1/reseller/account-type', {
      account_type: 'business',
    });
    assert.deepEqual([back.json.status, back.json.paused_for_kyb, back.json.business_verified], ['active', false, true]);
  });

  test('switching back to individual with the identity approved is live again; the business check is closed', async () => {
    const reseller = await liveIndividual();
    await reseller.browser.put('/v1/reseller/account-type', {
      account_type: 'business',
    });
    const started = await reseller.browser.post('/v1/account/verification/business', { consent: true });
    assert.equal(started.status, 201);
    const back = await reseller.browser.put('/v1/reseller/account-type', {
      account_type: 'individual',
    });
    assert.deepEqual([back.json.account_type, back.json.status, back.json.paused_for_kyb], ['individual', 'active', false]);
    const status = (await reseller.browser.get('/v1/account/verification')).json;
    assert.equal(status.business_check.status, 'expired', 'closed');
    assert.ok(
      await prisma.auditLog.findFirst({
        where: {
          action: 'reseller.account_type_changed',
          targetId: reseller.resellerId,
        },
      }),
    );
  });

  test('only the owner switches; an unverified business account does its whole check as a business', async () => {
    const reseller = await resellerClient(server, { country: 'NG' });
    await reseller.browser.post('/v1/auth/email/verify', {
      code: await lastEmailCode(server.app, reseller.email),
    });
    await reseller.browser.put('/v1/reseller/account-type', {
      account_type: 'business',
    });
    assert.equal(
      (
        await reseller.browser.post('/v1/account/verification/business', {
          consent: true,
        })
      ).json.error.code,
      'verification_required',
    );
    const started = await reseller.browser.post('/v1/account/verification', {
      consent: true,
    });
    const person = await applicant(started.json.url);
    assert.deepEqual([person.case.owner_verified, person.case.business_types], [false, ['registered']]);
    assert.ok(person.case.required.includes('identity') && person.case.required.includes('business'));
    // Back to individual while it is filled in: the case follows.
    await reseller.browser.put('/v1/reseller/account-type', {
      account_type: 'individual',
    });
    const reread = await call('GET', '/v1/kyc/case', { headers: {} });
    assert.equal(reread.status, 401);
    const kase = await prisma.kycCase.findUniqueOrThrow({
      where: { id: person.case.id },
    });
    assert.equal(kase.businessType, 'unregistered');

    const member = await resellerClient(server, { country: 'NG' });
    const invited = await prisma.resellerMember.create({
      data: {
        resellerId: reseller.resellerId,
        userId: member.userId,
        role: 'admin',
      },
    });
    assert.ok(invited);
    const refused = await member.browser.put('/v1/reseller/account-type', { account_type: 'business' }, { 'bitocard-reseller': reseller.resellerId });
    assert.equal(refused.status, 403, JSON.stringify(refused.json));
  });
});
