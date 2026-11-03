// Udozo's sign-up journeys (Reports > Sign-up journeys): every step of sign-up on udozo.com and Seller HQ is kept with
// why it was refused, so admins see where people get stuck; journeys are rolled into daily counts and deleted 7 days
// after completing (30 days unfinished).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, lastEmailCode, lastSmsCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let journeys;
let counter = 0;
const password = 'correct horse battery';
const day = 24 * 60 * 60 * 1000;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo', PRODUCT_ROUTES: 'separate', STOREFRONT_URL: 'https://udozo.com' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  journeys = server.app.get((await import('../dist/signups/journeys.service.js')).SignupJourneysService);
});

after(() => server?.close());

/** udozo.com's server, keeping the session and forwarding its visitor's browser as the site does. */
function site(agent = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36') {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        'bitocard-client-agent': agent,
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `journey-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

const unique = () => `journey${(counter += 1)}-${Date.now()}@example.com`;
const journeyOf = (surface, email) => prisma.signupJourney.findFirst({ where: { surface, email }, orderBy: { startedAt: 'desc' }, include: { events: { orderBy: { createdAt: 'asc' } } } });

describe('udozo.com sign-ups', () => {
  test('every step is kept with why one was refused, and the journey completes with the usable account', async () => {
    const browser = site();
    const email = unique();
    await browser.post('/v1/store/account/signin/lookup', { email });
    assert.equal((await browser.post('/v1/store/account/signup/email', { email })).status, 202);
    const wrong = await browser.post('/v1/store/account/signup/email/verify', { email, code: '000000' });
    assert.equal(wrong.json.error.code, 'code_invalid');
    const token = (await browser.post('/v1/store/account/signup/email/verify', { email, code: await lastEmailCode(server.app, email) })).json.signup_token;
    const phone = testMobile('NG');
    assert.equal((await browser.post('/v1/store/account/signup/phone', { email, signup_token: token, country: 'NG', phone })).status, 202);
    assert.equal((await browser.post('/v1/store/account/signup/phone/verify', { email, signup_token: token, code: await lastSmsCode(server.app, phone) })).status, 200);
    const made = await browser.post('/v1/store/account/signup', { first_name: 'Amaka', last_name: 'Eze', email, country: 'NG', phone, password, signup_token: token });
    assert.equal(made.status, 201, JSON.stringify(made.json));

    const journey = await journeyOf('udozo', email);
    assert.deepEqual(
      journey.events.map(event => [event.step, event.outcome, event.code]),
      [
        ['signin_lookup', 'ok', null],
        ['email', 'ok', null],
        ['email_verify', 'refused', 'code_invalid'],
        ['email_verify', 'ok', null],
        ['phone', 'ok', null],
        ['phone_verify', 'ok', null],
        ['signup', 'ok', null],
      ],
    );
    assert.ok(journey.emailEnteredAt && journey.emailVerifiedAt && journey.phoneEnteredAt && journey.phoneVerifiedAt && journey.accountCreatedAt && journey.signedInAt && journey.completedAt);
    assert.deepEqual([journey.country, journey.accountId, journey.device, journey.refusals, journey.lastErrorCode], ['NG', made.json.customer.id, 'Chrome on Android', 1, 'code_invalid']);

    // Signing in afterwards adds nothing: the journey is over, and an account's lookup never opens one.
    await site().post('/v1/store/account/signin', { email, password });
    await site().post('/v1/store/account/signin/lookup', { email });
    assert.equal(await prisma.signupJourney.count({ where: { surface: 'udozo', email } }), 1);

    // Signing up again with the same email is a new journey, refused at its first step.
    const again = await site().post('/v1/store/account/signup/email', { email });
    assert.equal(again.json.error.code, 'email_taken');
    const second = await journeyOf('udozo', email);
    assert.notEqual(second.id, journey.id);
    assert.deepEqual([second.completedAt, second.lastErrorStep, second.lastErrorCode, second.emailEnteredAt], [null, 'email', 'email_taken', null]);
  });

  test('where the country cannot text, the mobile counts as done; a lookup for an unknown email starts a journey', async () => {
    const browser = site();
    const email = unique();
    assert.equal((await browser.post('/v1/store/account/signin/lookup', { email })).json.exists, false);
    assert.ok(await journeyOf('udozo', email), 'opened by the lookup');
    await browser.post('/v1/store/account/signup/email', { email });
    const token = (await browser.post('/v1/store/account/signup/email/verify', { email, code: await lastEmailCode(server.app, email) })).json.signup_token;
    await prisma.country.update({ where: { code: 'KE' }, data: { smsProvider: null } });
    try {
      const unavailable = await browser.post('/v1/store/account/signup/phone', { email, signup_token: token, country: 'KE', phone: testMobile('KE') });
      assert.equal(unavailable.json.error.code, 'phone_verification_unavailable');
      await browser.post('/v1/store/account/signup', { first_name: 'Wanjiru', last_name: 'Kamau', email, country: 'KE', phone: testMobile('KE'), password, signup_token: token });
    } finally {
      await prisma.country.update({ where: { code: 'KE' }, data: { smsProvider: 'termii' } });
    }
    const journey = await journeyOf('udozo', email);
    assert.deepEqual([journey.phoneSkipped, Boolean(journey.completedAt), journey.country], [true, true, 'KE']);
  });

  test('a mobile the customer chose to confirm later counts as done, and the journey completes', async () => {
    const browser = site();
    const email = unique();
    await browser.post('/v1/store/account/signup/email', { email });
    const token = (await browser.post('/v1/store/account/signup/email/verify', { email, code: await lastEmailCode(server.app, email) })).json.signup_token;
    const phone = testMobile('NG');
    assert.equal((await browser.post('/v1/store/account/signup/phone', { email, signup_token: token, country: 'NG', phone })).status, 202);
    // The code did not come: carry on without it.
    const made = await browser.post('/v1/store/account/signup', { first_name: 'Chidi', last_name: 'Okeke', email, country: 'NG', phone, phone_later: true, password, signup_token: token });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const journey = await journeyOf('udozo', email);
    assert.deepEqual([journey.phoneSkipped, Boolean(journey.phoneVerifiedAt), Boolean(journey.completedAt)], [true, false, true]);
  });

  test('a sign-up page opened is counted, with nothing about the visitor', async () => {
    const before = (await prisma.signupVisitDay.findMany({ where: { surface: 'udozo' } })).reduce((sum, row) => sum + row.visits, 0);
    const visit = await client(server.base).post('/v1/signup-journeys/visits', { surface: 'udozo' });
    assert.equal(visit.status, 200, JSON.stringify(visit.json));
    const after = (await prisma.signupVisitDay.findMany({ where: { surface: 'udozo' } })).reduce((sum, row) => sum + row.visits, 0);
    assert.equal(after, before + 1);
    assert.equal((await client(server.base).post('/v1/signup-journeys/visits', { surface: 'elsewhere' })).status, 400);
  });
});

describe('Seller HQ sign-ups', () => {
  test('email, its code and the account with its business complete the journey', async () => {
    const browser = client(server.base, { autoIdempotency: true });
    const email = unique();
    assert.equal((await browser.post('/v1/auth/signup/email', { email })).status, 202);
    const token = (await browser.post('/v1/auth/signup/email/verify', { email, code: await lastEmailCode(server.app, email) })).json.signup_token;
    const made = await browser.post('/v1/auth/signup', { name: 'Kofi Mensah', email, password, country: 'GH', business_name: 'Kofi Digital', signup_token: token });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const journey = await journeyOf('shq', email);
    assert.deepEqual(journey.events.map(event => event.step), ['email', 'email_verify', 'signup']);
    assert.ok(journey.completedAt, 'a business account: done');
    assert.equal(journey.accountId, made.json.user.id);
    assert.equal(await prisma.signupJourney.count({ where: { surface: 'udozo', email } }), 0, 'never udozo.com’s');
  });
});

describe('Reports > Sign-up journeys', () => {
  test('the funnel, where people are stuck and why, each journey’s history (audited), for operations and support only', async () => {
    const browser = site('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1');
    const taken = testMobile('NG');
    await site().post('/v1/store/account/signup', { first_name: 'Kemi', last_name: 'Ade', email: unique(), country: 'NG', phone: taken, password });
    const email = unique();
    await browser.post('/v1/store/account/signup/email', { email });
    const token = (await browser.post('/v1/store/account/signup/email/verify', { email, code: await lastEmailCode(server.app, email) })).json.signup_token;
    assert.equal((await browser.post('/v1/store/account/signup/phone', { email, signup_token: token, country: 'NG', phone: taken })).json.error.code, 'phone_in_use');

    const support = await adminClient(server, ['support']);
    let list = await support.get(`/v1/admin/signup-journeys?surface=udozo&q=${encodeURIComponent(email)}`);
    assert.equal(list.status, 200, JSON.stringify(list.json));
    assert.deepEqual([list.json.data[0].status, list.json.data[0].stuck_at, list.json.data[0].last_error], ['in_progress', 'phone_entered', { step: 'phone', code: 'phone_in_use' }]);

    // Quiet for two hours: stuck.
    const journey = await journeyOf('udozo', email);
    await prisma.signupJourney.update({ where: { id: journey.id }, data: { lastEventAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
    list = await support.get('/v1/admin/signup-journeys?surface=udozo&status=stuck&stuck_at=phone_entered');
    assert.ok(list.json.data.some(row => row.id === journey.id));
    assert.ok((await support.get('/v1/admin/signup-journeys?surface=udozo&code=phone_in_use')).json.data.some(row => row.id === journey.id));

    const summary = await support.get('/v1/admin/signup-journeys/summary?surface=udozo&days=7');
    assert.equal(summary.status, 200, JSON.stringify(summary.json));
    const funnel = Object.fromEntries(summary.json.funnel.map(row => [row.milestone, row.count]));
    assert.ok(funnel.email_entered >= funnel.email_verified && funnel.email_verified >= funnel.phone_verified && funnel.completed >= 1);
    assert.ok(summary.json.blockers.some(row => row.step === 'phone' && row.code === 'phone_in_use' && row.journeys >= 1));
    assert.ok(summary.json.stuck_at.find(row => row.milestone === 'phone_entered').count >= 1);
    assert.ok(summary.json.devices.some(row => row.device === 'Safari on iOS'), JSON.stringify(summary.json.devices));
    assert.equal(summary.json.daily.length, 7);

    const detail = await support.get(`/v1/admin/signup-journeys/${journey.id}`);
    assert.equal(detail.status, 200);
    assert.deepEqual([detail.json.email, detail.json.events.map(event => event.step)], [email, ['email', 'email_verify', 'phone']]);
    assert.equal(await prisma.auditLog.count({ where: { action: 'signup_journey.viewed', targetId: journey.id } }), 1);

    const finance = await adminClient(server, ['finance']);
    assert.equal((await finance.get('/v1/admin/signup-journeys/summary?surface=udozo')).status, 403);
  });

  test('journeys roll into daily counts and go 7 days after completing, 30 days unfinished; the funnel keeps them', async () => {
    const support = await adminClient(server, ['support']);
    const at = new Date(Date.now() - 20 * day);
    const done = await prisma.signupJourney.create({
      data: { surface: 'shq', email: unique(), country: 'NG', startedAt: at, lastEventAt: at, emailEnteredAt: at, emailVerifiedAt: at, accountCreatedAt: at, signedInAt: at, completedAt: new Date(at.getTime() + 12 * 60 * 1000) },
    });
    const stale = new Date(Date.now() - 31 * day);
    const left = await prisma.signupJourney.create({
      data: { surface: 'shq', email: unique(), country: 'NG', startedAt: stale, lastEventAt: stale, emailEnteredAt: stale, lastErrorStep: 'email_verify', lastErrorCode: 'code_expired', refusals: 1, events: { create: { step: 'email_verify', outcome: 'refused', code: 'code_expired', createdAt: stale } } },
    });
    const recent = await prisma.signupJourney.create({ data: { surface: 'shq', email: unique(), completedAt: new Date(Date.now() - day) } });
    const before = (await support.get('/v1/admin/signup-journeys/summary?surface=shq&days=90')).json;

    const result = await journeys.purge();
    assert.ok(result.journeys_rolled_up >= 2);
    assert.equal(await prisma.signupJourney.count({ where: { id: { in: [done.id, left.id] } } }), 0);
    assert.equal(await prisma.signupJourney.count({ where: { id: recent.id } }), 1, 'completed a day ago: kept');

    const afterwards = (await support.get('/v1/admin/signup-journeys/summary?surface=shq&days=90')).json;
    assert.deepEqual(afterwards.funnel, before.funnel, 'counted the same once rolled up');
    assert.equal(afterwards.totals.started, before.totals.started);
    assert.ok(afterwards.blockers.some(row => row.step === 'email_verify' && row.code === 'code_expired'));
    assert.ok((await prisma.signupFunnelDay.count({ where: { surface: 'shq' } })) >= 1);
    // Running again counts nothing twice.
    await journeys.purge();
    assert.deepEqual((await support.get('/v1/admin/signup-journeys/summary?surface=shq&days=90')).json.funnel, before.funnel);
  });
});
