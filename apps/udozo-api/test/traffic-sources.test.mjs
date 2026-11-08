// Where udozo.com's visitors come from (8 November 2026, the owner's request): each landing from outside is counted
// for the day by channel (ad, social, search, messaging, email, another site, campaign, direct), source, campaign, the
// kind of page and the market, from udozo.com's signed reports only; nothing about the visitor is kept. A new account is
// credited to the visit that led to it (with the visitor's consent), and admins read it all in Reports > Traffic sources.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

const secret = 'traffic-secret-0123456789-abcdefghijklmnop';
let server;
let prisma;
let classify;
let landingOf;
let cleanTag;
let trafficSignature;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo', STORE_SERVER_SECRET: secret } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  ({ classify, landingOf, cleanTag } = await import('../dist/traffic/sources.js'));
  ({ trafficSignature } = await import('../dist/traffic/traffic.service.js'));
  const admin = await adminClient(server);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
});

after(async () => {
  await server?.close();
});

const own = ['udozo.com'];
const chrome = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

async function visit(body, { sign = true, wrong = false } = {}) {
  const text = JSON.stringify({ user_agent: chrome, ...body });
  const res = await fetch(`${server.base}/v1/traffic/visits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(sign ? { 'udozo-traffic-signature': trafficSignature(wrong ? 'not-the-secret-not-the-secret-xx' : secret, text) } : {}) },
    body: text,
  });
  return res.status;
}

const counted = async () => (await prisma.trafficSourceDay.findMany({ orderBy: [{ channel: 'asc' }, { source: 'asc' }, { landing: 'asc' }] })).map(row => [row.country, row.channel, row.source, row.medium, row.campaign, row.landing, row.visits]);

describe('Where a visit came from', () => {
  test('ad click ids, campaign tags, search engines, social networks, messaging apps, webmail, other sites and direct', () => {
    const is = (params, referrer, expected) => assert.deepEqual(classify(params, referrer, own), { medium: '', campaign: '', ...expected });
    is({ gclid: 'abc' }, 'https://www.google.com/', { channel: 'paid', source: 'google' });
    is({ msclkid: 'abc' }, null, { channel: 'paid', source: 'bing' });
    is({ ttclid: 'x' }, null, { channel: 'paid', source: 'tiktok' });
    // fbclid is on every link out of Facebook: an ad only when the campaign says so.
    is({ fbclid: 'IwAR0' }, 'https://l.facebook.com/', { channel: 'social', source: 'facebook' });
    is({ fbclid: 'IwAR0', utm_source: 'fb', utm_medium: 'paid_social', utm_campaign: 'Lagos Phones Nov' }, 'https://m.facebook.com/', { channel: 'paid', source: 'facebook', medium: 'paid_social', campaign: 'lagos_phones_nov' });
    is({ utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'week-45' }, null, { channel: 'email', source: 'newsletter', medium: 'email', campaign: 'week-45' });
    is({ utm_source: 'whatsapp', utm_medium: 'broadcast' }, null, { channel: 'messaging', source: 'whatsapp', medium: 'broadcast' });
    is({ utm_source: 'jiji_sellers', utm_medium: 'outreach' }, null, { channel: 'campaign', source: 'jiji_sellers', medium: 'outreach' });
    is({}, 'https://www.google.com.ng/', { channel: 'search', source: 'google' });
    is({}, 'https://www.bing.com/search?q=udozo', { channel: 'search', source: 'bing' });
    is({}, 'https://duckduckgo.com/', { channel: 'search', source: 'duckduckgo' });
    is({}, 'https://t.co/abc', { channel: 'social', source: 'x' });
    is({}, 'https://www.instagram.com/', { channel: 'social', source: 'instagram' });
    is({}, 'https://www.nairaland.com/123/phones', { channel: 'social', source: 'nairaland' });
    is({}, 'https://web.whatsapp.com/', { channel: 'messaging', source: 'whatsapp' });
    is({}, 'android-app://com.google.android.gm', { channel: 'email', source: 'gmail' });
    is({}, 'android-app://com.whatsapp/', { channel: 'messaging', source: 'whatsapp' });
    is({}, 'https://www.techcabal.com/2026/11/udozo', { channel: 'referral', source: 'techcabal.com' });
    is({}, 'https://udozo.com/ng', { channel: 'direct', source: 'direct' });
    is({}, 'https://acme.udozo.com/', { channel: 'direct', source: 'direct' });
    is({}, null, { channel: 'direct', source: 'direct' });
  });

  test('tags are cleaned: never a phone number, an email or a long code; only the kind of page is kept', () => {
    assert.equal(cleanTag('Lagos Phones (Nov) 2026!'), 'lagos_phones_nov_2026');
    assert.equal(cleanTag('ada@example.com'), '');
    assert.equal(cleanTag('call 0803 123 4567'), '');
    assert.equal(cleanTag('a'.repeat(40)), '');
    assert.deepEqual(landingOf('/'), { kind: 'home', country: null });
    assert.deepEqual(landingOf('/ng'), { kind: 'market', country: 'NG' });
    assert.deepEqual(landingOf('/ng/l/100001-hisense-tv'), { kind: 'listing', country: 'NG' });
    assert.deepEqual(landingOf('/gh/c/mobile-phones'), { kind: 'category', country: 'GH' });
    assert.deepEqual(landingOf('/ng/lagos/ikeja'), { kind: 'place', country: 'NG' });
    assert.deepEqual(landingOf('/ng/seller/chinedu'), { kind: 'seller', country: 'NG' });
    assert.deepEqual(landingOf('/start-here'), { kind: 'start_here', country: null });
    assert.deepEqual(landingOf('/i/abc123'), { kind: 'invite', country: null });
  });
});

describe('Counting visits', () => {
  test("only udozo.com's signed reports count, robots never, and nothing about the visitor is kept", async () => {
    await prisma.trafficSourceDay.deleteMany();
    assert.equal(await visit({ path: '/ng/l/100001-tv', params: { fbclid: 'IwAR0abcdef', utm_source: 'facebook', utm_medium: 'cpc', utm_campaign: 'tv_week' }, referrer: 'https://l.facebook.com/' }), 204);
    assert.equal(await visit({ path: '/ng/c/tvs', params: { fbclid: 'IwAR1zzz', utm_source: 'facebook', utm_medium: 'cpc', utm_campaign: 'tv_week' }, referrer: 'https://m.facebook.com/' }), 204);
    assert.equal(await visit({ path: '/ng/l/100002-phone', params: { fbclid: 'IwAR2' , utm_source: 'facebook', utm_medium: 'cpc', utm_campaign: 'tv_week' } }), 204);
    assert.equal(await visit({ path: '/', referrer: 'https://www.google.com/' }), 204);
    assert.equal(await visit({ path: '/start-here' }), 204);
    // Unsigned, wrongly signed, and a robot: accepted and ignored alike.
    assert.equal(await visit({ path: '/', referrer: 'https://www.bing.com/' }, { sign: false }), 204);
    assert.equal(await visit({ path: '/', referrer: 'https://www.bing.com/' }, { wrong: true }), 204);
    assert.equal(await visit({ path: '/', referrer: 'https://www.bing.com/', user_agent: 'Mozilla/5.0 (compatible; bingbot/2.0)' }), 204);

    assert.deepEqual(await counted(), [
      ['WW', 'direct', 'direct', '', '', 'start_here', 1],
      ['NG', 'paid', 'facebook', 'cpc', 'tv_week', 'category', 1],
      ['NG', 'paid', 'facebook', 'cpc', 'tv_week', 'listing', 2],
      ['WW', 'search', 'google', '', '', 'home', 1],
    ]);
    const kept = JSON.stringify(await prisma.trafficSourceDay.findMany());
    assert.ok(!kept.includes('IwAR'), 'never the click id');
    assert.ok(!kept.includes('100001'), 'never the address');
  });

  test('a new account is credited to the visit that led to it, once; admins read the report by channel, source and campaign', async () => {
    const shopper = await signedUp();
    const credit = body => post(shopper, '/v1/store/account/attribution', body);
    const first = await credit({ path: '/ng/l/100001-tv', params: { fbclid: 'IwAR9', utm_source: 'facebook', utm_medium: 'cpc', utm_campaign: 'tv_week' }, referrer: 'https://l.facebook.com/' });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.deepEqual([first.json.attributed, first.json.channel, first.json.source], [true, 'paid', 'facebook']);
    assert.equal((await credit({ path: '/', referrer: 'https://www.google.com/' })).json.attributed, false, 'only the first');
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: shopper.id } });
    assert.deepEqual([row.acquisitionChannel, row.acquisitionSource, row.acquisitionMedium, row.acquisitionCampaign, row.acquisitionLanding], ['paid', 'facebook', 'cpc', 'tv_week', 'listing']);

    // An old account is never credited.
    const older = await signedUp();
    await prisma.customer.update({ where: { id: older.id }, data: { createdAt: new Date(Date.now() - 3 * 86_400_000) } });
    assert.equal((await post(older, '/v1/store/account/attribution', { path: '/', referrer: 'https://www.google.com/' })).json.attributed, false);
    assert.equal((await client(server.base).post('/v1/store/account/attribution', { path: '/' })).status, 401);

    const admin = await adminClient(server, ['support']);
    const report = await admin.get('/v1/admin/traffic/summary?days=7');
    assert.equal(report.status, 200, JSON.stringify(report.json));
    const summary = report.json;
    assert.equal(summary.visits, 5);
    assert.ok(summary.signups >= 2);
    assert.equal(summary.signups_attributed, 1);
    assert.deepEqual(summary.channels.find(item => item.channel === 'paid'), { channel: 'paid', visits: 3, share: 60, signups: 1 });
    assert.deepEqual(summary.sources[0], { channel: 'paid', source: 'facebook', visits: 3, share: 60, signups: 1 });
    assert.deepEqual(summary.campaigns, [{ source: 'facebook', medium: 'cpc', campaign: 'tv_week', visits: 3 }]);
    assert.deepEqual(summary.landings[0], { landing: 'listing', visits: 2 });
    assert.equal(summary.daily.length, 7);
    assert.equal(summary.daily.at(-1).visits, 5);
    assert.equal(summary.daily.at(-1).paid, 3);
    const nigeria = (await admin.get('/v1/admin/traffic/summary?days=30&country=ng')).json;
    assert.deepEqual([nigeria.country, nigeria.visits], ['NG', 3]);
    assert.equal((await admin.get('/v1/admin/traffic/summary?days=12')).status, 400);
    assert.equal((await client(server.base).get('/v1/admin/traffic/summary')).status, 401);
  });
});

async function post(shopper, path, body) {
  const res = await fetch(`${server.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'bitocard-customer-session': shopper.token }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

let counter = 0;
async function signedUp() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: { ...(token ? { 'bitocard-customer-session': token } : {}), 'content-type': 'application/json', ...(method === 'POST' ? { 'idempotency-key': `traffic-${Date.now()}-${Math.random()}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = res.status === 204 ? null : await res.json();
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  const shopper = { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
  const email = `traffic${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Ada Obi', email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, shopper);
  await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) });
  return { id: signup.json.customer.id, get token() { return token; } };
}
