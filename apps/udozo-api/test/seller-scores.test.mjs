// Anjio's seller scores (docs/UDOZO_RATINGS_PLAN.md phase 3): the rules, then a seller scored by the nightly job, what
// the public, the seller and admins see, and Anjio's summary written with the fake AI and refused when it breaks a rule.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';
import { fakeAi } from './fakes.mjs';

const rules = await import('../dist/classifieds/scores/metrics.js');
const anjio = '00000000-0000-4000-8000-0000000000c1';
const minuteMs = 60_000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;

let server;
let ai;
let prisma;
let admin;
let scores;

before(async () => {
  ai = await fakeAi();
  server = await startApp({ env: { APP_PRODUCT: 'udozo', ...ai.env, ANTHROPIC_API_KEY: 'good-anthropic-udozo', ANTHROPIC_PRICES: 'claude-haiku-5-5 1 5 0.1', AI_BITOCARD_MODELS: 'anthropic:claude-haiku-5-5' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  scores = server.app.get((await import('../dist/classifieds/scores/scores.service.js')).SellerScoresService);
  admin = await adminClient(server);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0, monthlyListingLimit: 100 } });
});

after(async () => {
  await server?.close();
  await ai?.close();
});

function storeServer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `score-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = res.status === 204 ? null : await res.json();
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

let counter = 0;
async function customer(name) {
  const shopper = storeServer();
  const email = `score${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  await confirmMobile(server.app, shopper);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
  shopper.id = signup.json.customer.id;
  return shopper;
}

async function live(seller, title, price = 25000000) {
  const [cat, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
  const draft = (await seller.post('/v1/classifieds/listings', { title, price, condition: 'used', category_id: cat.id, area_id: area.id })).json;
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.id, kind: 'photo', position, url: `https://media.test/${draft.id}-${position}.jpg` })) });
  const submitted = (await seller.post(`/v1/classifieds/listings/${draft.id}/submit`)).json;
  assert.equal(submitted.status, 'active', JSON.stringify(submitted));
  return submitted;
}

describe('the rules', () => {
  test('response time, costing, bands, the overall needs weight behind it, and the public view', () => {
    assert.equal(rules.responseScore(10 * minuteMs), 100);
    assert.equal(rules.responseScore(hourMs), 85);
    assert.equal(Math.round(rules.responseScore(2.5 * hourMs)), 75);
    assert.equal(rules.responseScore(dayMs), 30);
    assert.equal(rules.responseScore(30 * dayMs), 0);
    assert.equal(rules.costingScore(90, 100, 200, 150), 100);
    assert.equal(rules.costingScore(150, 100, 200, 150), 75);
    assert.equal(rules.costingScore(200, 100, 200, 150), 50);
    assert.equal(rules.costingScore(300, 100, 200, 150), 0);
    assert.deepEqual([90, 75, 60, 45, 10].map(rules.bandOf), ['excellent', 'very_good', 'good', 'fair', 'needs_work']);
    assert.equal(Math.round(rules.smoothed(100 * 2, 2, 90)), 93, 'two positives pulled towards the market');
    const only = { response: { score: 90, n: 6, median_ms: 20 * minuteMs }, attention: null, pricing: null, costing: null, reliability: null, satisfaction: null, salesmanship: null };
    assert.equal(rules.overall(only), null, 'one metric is not enough');
    const some = { ...only, attention: { score: 70, n: 9 }, salesmanship: { score: 10, n: 6 } };
    assert.equal(rules.overall(some), Math.round((90 * 15 + 70 * 15 + 10 * 10) / 40));
    const view = rules.publicScores({ ...some, reliability: { score: 95, n: 4 }, pricing: { score: 60, n: 6 } }, 60);
    assert.deepEqual([view.response, view.attention, view.band_label], ['Usually replies within an hour', 'Answers most requests', 'Good']);
    assert.deepEqual(view.highlights.map(item => item.key), ['reliability'], 'only strong metrics, never salesmanship');
    assert.equal(rules.publicScores(some, 50).band, null, 'below Good the band is not shown');
    assert.equal(rules.publicScores({ ...only, response: null }, null).new_seller, true);
    assert.deepEqual(rules.numbersIn('Since 2026, 12 reviews and 4.5 stars'), ['2026', '12', '4.5']);
  });
});

describe('a seller scored', () => {
  test('the job scores active sellers; public words only with the switch; numbers and tips for the seller; flags for admins', async () => {
    const seller = await customer('Chinedu Okafor');
    const buyer = await customer('Kemi Adeyemi');
    const listings = [];
    for (let index = 0; index < 5; index += 1) listings.push(await live(seller, `Samsung TV ${index}`));
    const now = Date.now();
    for (const [index, listing] of listings.entries()) {
      const created = new Date(now - (3 + index) * dayMs);
      await prisma.classifiedConversation.create({ data: { listingId: listing.id, buyerId: buyer.id, sellerId: seller.id, country: 'NG', createdAt: created, sellerRepliedAt: index === 4 ? null : new Date(created.getTime() + 20 * minuteMs) } });
      await prisma.classifiedContactRequest.create({ data: { kind: 'contact', listingId: listing.id, buyerId: buyer.id, sellerId: seller.id, country: 'NG', status: 'accepted', answeredAt: created, createdAt: created } });
    }
    // One price raised within a week of the buyer asking.
    await prisma.classifiedPriceHistory.updateMany({ where: { listingId: listings[0].id }, data: { from: new Date(now - 10 * dayMs) } });
    await prisma.classifiedPriceHistory.create({ data: { listingId: listings[0].id, priceMinor: 30000000n, from: new Date(now - 2 * dayMs) } });

    const run = await scores.run(60_000);
    assert.ok(run.scored >= 1, JSON.stringify(run));
    const row = await prisma.classifiedSellerScore.findUniqueOrThrow({ where: { sellerId: seller.id } });
    assert.equal(row.metrics.response.n, 5);
    assert.equal(row.metrics.response.score, Math.round(rules.responseScore(20 * minuteMs)), 'the median of four quick replies and a week');
    assert.equal(row.metrics.attention.n, 10);
    assert.equal(row.metrics.attention.score, 90, 'one chat of ten approaches unanswered');
    assert.equal(row.metrics.pricing.score, 90, 'one of five contacted listings rose');
    assert.equal(row.metrics.salesmanship, null);
    assert.ok(row.overallScore !== null);
    assert.ok(row.details.tips.some(tip => /1 of your 5 chats waited over a day/.test(tip)), JSON.stringify(row.details.tips));
    assert.ok(row.details.tips.some(tip => /went up in price within a week/.test(tip)));
    assert.equal((await scores.run(60_000)).scored, 0, 'done for today: the cursor carries on, nothing twice');
    assert.equal(await prisma.classifiedSellerScoreMonth.count({ where: { sellerId: seller.id } }), 1, "the month's snapshot");

    const handle = (await prisma.customer.findUniqueOrThrow({ where: { id: seller.id } })).sellerHandle;
    assert.equal((await storeServer().get(`/v1/classifieds/sellers/${handle}`)).json.scores, null, 'not public until the switch');
    const mine = (await seller.get('/v1/classifieds/me/scores')).json;
    assert.equal(mine.public, false);
    assert.equal(mine.metrics.find(item => item.key === 'response').n, 5);
    assert.equal(mine.metrics.find(item => item.key === 'salesmanship').public, false);
    assert.ok(mine.tips.length >= 2);

    assert.equal((await admin.put('/v1/admin/switches/seller_scores', { country_code: 'NG', enabled: true })).status, 200);
    const shown = (await storeServer().get(`/v1/classifieds/sellers/${handle}`)).json.scores;
    assert.equal(shown.response, 'Usually replies within an hour');
    assert.equal(shown.attention, 'Answers almost every request');
    assert.equal(shown.summary, null);
    const text = JSON.stringify(shown);
    for (const leak of ['score', 'salesmanship', 'tips', '"n"']) assert.ok(!text.includes(leak), `no ${leak} in public`);

    const viewed = (await admin.get(`/v1/admin/classifieds/sellers/${seller.id}/scores`)).json;
    assert.equal(viewed.metrics.find(item => item.key === 'pricing').score, 90);
    assert.equal((await admin.post(`/v1/admin/classifieds/sellers/${seller.id}/scores/recompute`)).status, 200);
    assert.equal(await prisma.auditLog.count({ where: { action: 'classifieds.seller_scores_recomputed', targetId: seller.id } }), 1);
    const report = (await admin.get('/v1/admin/classifieds/scores/report?country=NG')).json;
    assert.ok(report.sellers >= 1);
    assert.equal(report.bands.reduce((sum, band) => sum + band.count, 0), report.sellers);
  });

  test("Anjio's summary: from figures only, checked, within the caps; sellers report it, admins hide and regenerate it", async () => {
    const seller = await customer('Ada Eze');
    const buyer = await customer('Tunde Bello');
    const now = Date.now();
    for (let index = 0; index < 5; index += 1) {
      const listing = await live(seller, `LG TV ${index}`);
      const created = new Date(now - (2 + index) * dayMs);
      await prisma.classifiedConversation.create({ data: { listingId: listing.id, buyerId: buyer.id, sellerId: seller.id, country: 'NG', createdAt: created, sellerRepliedAt: new Date(created.getTime() + 5 * minuteMs) } });
      await prisma.classifiedContactRequest.create({ data: { kind: 'callback', listingId: listing.id, buyerId: buyer.id, sellerId: seller.id, country: 'NG', status: 'done', answeredAt: created, createdAt: created } });
    }
    await scores.refresh(seller.id, 'NG');
    assert.equal(await scores.summarise(seller.id), 'switched_off');
    for (const key of ['seller_score_summaries', 'classifieds_assistant', 'seller_scores']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200);
    await prisma.supportBot.update({ where: { id: anjio }, data: { status: 'active', provider: 'anthropic', model: 'claude-haiku-5-5', limits: { monthly_budget_usd: 100, summaries_daily: 1, summary_budget_share: 0.25 } } });

    ai.state.script = [{ tool: { name: 'write_summary', arguments: { text: 'Usually replies within an hour and answers almost every request. Sells TVs on Udozo.' } } }];
    assert.equal(await scores.summarise(seller.id), 'written');
    const sent = ai.state.calls.at(-1).body;
    const prompt = JSON.stringify(sent.messages);
    assert.ok(!prompt.includes('Ada') && !prompt.includes('25000000'), 'no names or prices sent');
    let row = await prisma.classifiedSellerScore.findUniqueOrThrow({ where: { sellerId: seller.id } });
    assert.match(row.summaryText, /replies within an hour/);
    assert.equal(row.summaryModel, 'claude-haiku-5-5');
    assert.equal(await prisma.aiUsage.count({ where: { kind: 'shop_summary', botId: anjio } }), 1);

    const handle = (await prisma.customer.findUniqueOrThrow({ where: { id: seller.id } })).sellerHandle;
    const shown = (await storeServer().get(`/v1/classifieds/sellers/${handle}`)).json.scores.summary;
    assert.match(shown.text, /replies within an hour/);
    assert.match(shown.credit, /Written by Anjio/);

    // Broken rules keep the summary there was.
    ai.state.script = [{ tool: { name: 'write_summary', arguments: { text: 'A trustworthy seller who answers 99 of every 100 buyers quickly.' } } }];
    assert.equal(await scores.summarise(seller.id), 'daily_cap', 'one a day');
    await prisma.supportBot.update({ where: { id: anjio }, data: { limits: { monthly_budget_usd: 100, summaries_daily: 10, summary_budget_share: 0.25 } } });
    assert.equal(await scores.summarise(seller.id), 'rejected');
    ai.state.script = [{ tool: { name: 'write_summary', arguments: { text: 'Usually replies within an hour, and is a good choice for buyers.' } } }];
    assert.equal(await scores.summarise(seller.id), 'written');
    row = await prisma.classifiedSellerScore.findUniqueOrThrow({ where: { sellerId: seller.id } });
    assert.ok(!scores.needsSummary(row, 0), 'nothing changed: not written again');
    assert.ok(scores.needsSummary({ ...row, band: 'fair' }, 0), 'a band change writes it again');

    assert.equal((await seller.post('/v1/classifieds/me/scores/summary/report', { details: 'I sell fridges too' })).status, 200);
    assert.equal(await prisma.notification.count({ where: { type: 'admin.classifieds.seller_summary_reported' } }), 1);
    assert.equal((await admin.post(`/v1/admin/classifieds/sellers/${seller.id}/scores/summary/hide`, { reason: 'The seller says it is wrong' })).status, 200);
    assert.equal((await storeServer().get(`/v1/classifieds/sellers/${handle}`)).json.scores.summary, null);
    assert.equal((await admin.post(`/v1/admin/classifieds/sellers/${seller.id}/scores/summary/unhide`, { reason: 'Checked' })).status, 200);
    ai.state.script = [{ tool: { name: 'write_summary', arguments: { text: 'Usually replies within an hour and answers almost every request.' } } }];
    const again = await admin.post(`/v1/admin/classifieds/sellers/${seller.id}/scores/summary/regenerate`);
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.equal(again.json.summary.reported, null, 'writing it again clears the report');

    await prisma.supportBot.update({ where: { id: anjio }, data: { limits: { monthly_budget_usd: 0.000001, summaries_daily: 10, summary_budget_share: 0.25 } } });
    assert.equal(await scores.summarise(seller.id), 'budget');
  });
});
