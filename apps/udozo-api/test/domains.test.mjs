// Store domains: buying a .com (Vercel's price plus the margin, held from the wallet and taken when the registrar
// confirms), connecting a domain bought elsewhere, the storefront's lookup by domain, DNS on Vercel with protected records,
// copying records before nameservers move, mailbox providers, order emails from the domain, renewals and admin suspension.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, resellerClient, startApp } from './helpers.mjs';
import { fakeDomains } from './fakes.mjs';
import { responseChecker } from './openapi-docs.mjs';

let server;
let fake;
let admin;
let prisma;
let wallets;
let check;

before(async () => {
  fake = await fakeDomains();
  server = await startApp({ env: { ...fake.env, CRON_SECRET: 'cron-secret' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  check = await responseChecker(server.app);
  // NGN 1,500 per USD from both sources: BitoCard charges 1,500 x 1.015 = NGN 1,522.50 per dollar.
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
});

after(async () => {
  await server?.close();
  await fake?.close();
});

let counter = 0;
const contact = { first_name: 'Ada', last_name: 'Obi', email: 'ada@example.com', phone: '+2348031234567', address1: '1 Marina', city: 'Lagos', state: 'Lagos', zip: '100001', country: 'NG' };

/** A verified reseller with a published store and money in the wallet, the switch on for them. */
async function seller({ funding = 50_000_000, active = true } = {}) {
  const created = await resellerClient(server);
  counter += 1;
  const store = await created.browser.post('/v1/stores', { name: `Ada Digital ${counter}`, subdomain: `adadigital${counter}${Date.now() % 10000}` });
  assert.equal(store.status, 201, JSON.stringify(store.json));
  await prisma.store.update({ where: { id: store.json.id }, data: { status: 'published', publishedAt: new Date() } });
  if (active) await prisma.reseller.update({ where: { id: created.resellerId }, data: { status: 'active', verifiedAt: new Date(), verifiedName: 'Ada Obi' } });
  if (funding) await wallets.adjust(null, { resellerId: created.resellerId, mode: 'live', balance: 'funding', amount: funding, reason: 'Top-up' });
  assert.equal((await admin.put('/v1/admin/switches/custom_domains', { reseller_id: created.resellerId, enabled: true })).status, 200);
  return { ...created, store: store.json, base: `/v1/stores/${store.json.id}/domains` };
}

async function buy(s, name) {
  const search = await s.browser.get(`${s.base}/search?q=${name.split('.')[0]}`);
  const offer = search.json.data.find(item => item.domain === name);
  return s.browser.post(`${s.base}/purchase`, { domain: name, expected_price: offer.price.amount, contact });
}

describe('buying a domain', () => {
  test('closed until the switch is on for the reseller', async () => {
    const created = await resellerClient(server);
    const store = await created.browser.post('/v1/stores', { name: 'Closed Store', subdomain: `closed${Date.now() % 100000}` });
    const listed = await created.browser.get(`/v1/stores/${store.json.id}/domains`);
    assert.deepEqual([listed.status, listed.json.error.code], [403, 'domains_not_enabled']);
  });

  test('search shows each ending sold with Vercel’s price plus the margin; taken names and other endings are not offered', async () => {
    const s = await seller();
    const search = await s.browser.get(`${s.base}/search?q=adashop`);
    assert.equal(search.status, 200, JSON.stringify(search.json));
    check('GET /v1/stores/{store}/domains/search', 200, search.json);
    assert.deepEqual(search.json.data, [{ object: 'domain_offer', domain: 'adashop.com', available: true, price: { amount: 1350, currency: 'USD' }, renewal_price: { amount: 1500, currency: 'USD' } }]);
    assert.equal((await s.browser.get(`${s.base}/search?q=taken.com`)).json.data[0].available, false);
    assert.equal((await s.browser.get(`${s.base}/search?q=adashop.ng`)).json.error.code, 'tld_not_offered');
    const listed = await s.browser.get(s.base);
    check('GET /v1/stores/{store}/domains', 200, listed.json);
    assert.deepEqual([listed.json.buying, listed.json.max_domains], [{ available: true, tlds: ['com'] }, 5]);
  });

  test('buying holds the price, takes it when the registrar confirms, registers in the reseller’s name and serves the store', async () => {
    const s = await seller();
    const before = (await s.browser.get('/v1/wallet')).json.available;
    const changed = await s.browser.post(`${s.base}/purchase`, { domain: 'adabuy.com', expected_price: 999, contact });
    assert.deepEqual([changed.status, changed.json.error.code], [409, 'price_changed']);
    const bought = await buy(s, 'adabuy.com');
    assert.equal(bought.status, 201, JSON.stringify(bought.json));
    check('POST /v1/stores/{store}/domains/purchase', 201, bought.json);
    assert.deepEqual([bought.json.source, bought.json.status, bought.json.dns_mode, bought.json.primary, bought.json.price], ['purchased', 'active', 'vercel', true, { amount: 1350, currency: 'USD' }]);
    assert.ok(bought.json.expires_at);
    const order = Object.values(fake.state.orders).find(item => item.domain === 'adabuy.com');
    assert.deepEqual([order.contact.firstName, order.contact.phone, order.contact.country], ['Ada', '+2348031234567', 'NG']);
    assert.ok(fake.state.projectDomains['adabuy.com'] && fake.state.projectDomains['www.adabuy.com'], 'the store and www are served on it');
    const after = (await s.browser.get('/v1/wallet')).json.available;
    assert.equal(before - after, 2_055_375, 'US$13.50 at NGN 1,522.50, from the wallet');
    const revenue = await prisma.journalEntry.findFirst({ where: { reference: { startsWith: 'hold_capture' } }, orderBy: { createdAt: 'desc' } });
    assert.ok(revenue);
    assert.ok(await prisma.journalEntry.findUnique({ where: { reference: `domain_cost:${bought.json.id}:register` } }), 'Vercel’s price is the cost');
    assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);

    const lookup = await client(server.base).get('/v1/storefronts/domains/www.adabuy.com');
    check('GET /v1/storefronts/domains/{domain}', 200, lookup.json);
    check('GET /v1/storefronts/{subdomain}', 200, (await client(server.base).get(`/v1/storefronts/${s.store.subdomain}`)).json);
    assert.deepEqual(lookup.json, { object: 'storefront_domain', domain: 'adabuy.com', subdomain: s.store.subdomain });
    assert.equal((await client(server.base).get(`/v1/storefronts/${s.store.subdomain}`)).json.domain, 'adabuy.com');
    assert.equal((await client(server.base).get('/v1/storefronts/domains/unknown-shop.com')).status, 404);
  });

  test('a refused purchase returns the money and frees the name; unverified resellers cannot buy', async () => {
    const s = await seller();
    const before = (await s.browser.get('/v1/wallet')).json;
    fake.state.buyReply = 'refuse';
    try {
      const refused = await buy(s, 'adarefused.com');
      assert.deepEqual([refused.status, refused.json.error.code], [502, 'domain_purchase_failed']);
    } finally {
      fake.state.buyReply = 'ok';
    }
    const after = (await s.browser.get('/v1/wallet')).json;
    assert.deepEqual([after.available, after.reserved], [before.available, 0]);
    assert.equal((await buy(s, 'adarefused.com')).status, 201, 'the name can be bought again');
    const pending = await seller({ active: false });
    assert.equal((await buy(pending, 'adapending.com')).json.error.code, 'reseller_not_verified');
  });

  test('a short wallet refuses the purchase before Vercel is asked', async () => {
    const s = await seller({ funding: 1000 });
    const bought = await buy(s, 'adapoor.com');
    assert.deepEqual([bought.status, bought.json.error.code], [402, 'insufficient_funds']);
    assert.ok(!Object.values(fake.state.orders).some(item => item.domain === 'adapoor.com'));
  });
});

describe('connecting a domain bought elsewhere', () => {
  test('it waits for the reseller’s DNS with the records to set, then goes live; it can be disconnected', async () => {
    const s = await seller();
    const connected = await s.browser.post(s.base, { domain: 'https://www.adaconnect.ng/' });
    assert.equal(connected.status, 201, JSON.stringify(connected.json));
    check('POST /v1/stores/{store}/domains', 201, connected.json);
    assert.deepEqual([connected.json.name, connected.json.status, connected.json.dns_mode], ['adaconnect.ng', 'pending', 'external']);
    assert.deepEqual(connected.json.instructions, [{ type: 'A', name: '@', value: '76.76.21.21' }, { type: 'CNAME', name: 'www', value: 'cname.vercel-dns.com' }]);
    assert.deepEqual(connected.json.nameservers, ['ns1.vercel-dns.com', 'ns2.vercel-dns.com']);
    assert.equal((await s.browser.post(s.base, { domain: 'adaconnect.ng' })).json.error.code, 'domain_in_use');
    assert.equal((await s.browser.post(s.base, { domain: 'shop.bitocard.com' })).json.error.code, 'domain_invalid');

    fake.state.configured.add('adaconnect.ng');
    const checked = await s.browser.post(`${s.base}/${connected.json.id}/check`);
    check('POST /v1/stores/{store}/domains/{id}/check', 200, checked.json);
    assert.deepEqual([checked.json.status, checked.json.instructions, checked.json.primary], ['active', [], true]);
    assert.ok(await prisma.notification.findFirst({ where: { resellerId: s.resellerId, type: 'domain.active' } }));

    assert.equal((await s.browser.get(`${s.base}/${connected.json.id}/records`)).json.error.code, 'dns_external');
    const removed = await s.browser.delete(`${s.base}/${connected.json.id}`);
    check('DELETE /v1/stores/{store}/domains/{id}', 200, removed.json);
    assert.deepEqual(removed.json, { object: 'store_domain', id: connected.json.id, deleted: true });
    assert.equal(fake.state.projectDomains['adaconnect.ng'], undefined);
  });

  test('before moving nameservers, its public records are found and copied, so email keeps working', async () => {
    const s = await seller();
    const connected = await s.browser.post(s.base, { domain: 'adamail.ng' });
    fake.state.publicDns['adamail.ng|MX'] = [{ name: 'adamail.ng.', type: 15, TTL: 300, data: '10 mx.zoho.com.' }];
    fake.state.publicDns['adamail.ng|TXT'] = [{ name: 'adamail.ng.', type: 16, TTL: 300, data: '"v=spf1 include:zohomail.com ~all"' }];
    fake.state.publicDns['_dmarc.adamail.ng|TXT'] = [{ name: '_dmarc.adamail.ng.', type: 16, TTL: 300, data: '"v=DMARC1; p=none"' }];
    const preview = await s.browser.get(`${s.base}/${connected.json.id}/dns-import`);
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    check('GET /v1/stores/{store}/domains/{id}/dns-import', 200, preview.json);
    assert.deepEqual(
      preview.json.records.map(record => [record.name, record.type, record.value, record.priority]),
      [
        ['', 'MX', 'mx.zoho.com', 10],
        ['', 'TXT', 'v=spf1 include:zohomail.com ~all', null],
        ['_dmarc', 'TXT', 'v=DMARC1; p=none', null],
      ],
    );
    const imported = await s.browser.post(`${s.base}/${connected.json.id}/dns-import`, { records: preview.json.records.map(({ name, type, value, ttl, priority }) => ({ name, type, value, ttl, ...(priority === null ? {} : { priority }) })) });
    check('POST /v1/stores/{store}/domains/{id}/dns-import', 200, imported.json);
    assert.deepEqual([imported.json.created, imported.json.nameservers], [3, ['ns1.vercel-dns.com', 'ns2.vercel-dns.com']]);
    assert.deepEqual(fake.state.records['adamail.ng'].map(record => [record.type, record.comment]), [['MX', 'bitocard:imported'], ['TXT', 'bitocard:imported'], ['TXT', 'bitocard:imported']]);

    // The nameservers moved: the domain is on BitoCard's DNS now and its records can be edited here.
    fake.state.owned['adamail.ng'] = { expiresAt: null };
    const moved = await s.browser.post(`${s.base}/${connected.json.id}/check`);
    assert.deepEqual([moved.json.dns_mode, moved.json.status], ['vercel', 'active']);
    const records = await s.browser.get(`${s.base}/${connected.json.id}/records`);
    check('GET /v1/stores/{store}/domains/{id}/records', 200, records.json);
    assert.ok(records.json.data.every(record => record.protected === false), 'copied records are the reseller’s to change');
  });
});

describe('DNS, email and sending', () => {
  test('records: the store’s address is protected; mailbox providers write their records, which only the email settings change', async () => {
    const s = await seller();
    const bought = await buy(s, 'adadns.com');
    const id = bought.json.id;
    const apex = await s.browser.post(`${s.base}/${id}/records`, { name: '@', type: 'A', value: '203.0.113.9' });
    assert.deepEqual([apex.status, apex.json.error.code], [400, 'record_invalid']);
    assert.equal((await s.browser.post(`${s.base}/${id}/records`, { name: 'blog', type: 'A', value: 'not-an-ip' })).json.error.code, 'record_invalid');
    const blog = await s.browser.post(`${s.base}/${id}/records`, { name: 'blog', type: 'CNAME', value: 'hosting.example.net' });
    assert.equal(blog.status, 201, JSON.stringify(blog.json));
    check('POST /v1/stores/{store}/domains/{id}/records', 201, blog.json);

    const mail = await s.browser.put(`${s.base}/${id}/mail-provider`, { provider: 'google', verification: 'google-site-verification=abc123' });
    assert.equal(mail.status, 200, JSON.stringify(mail.json));
    check('PUT /v1/stores/{store}/domains/{id}/mail-provider', 200, mail.json);
    assert.deepEqual([mail.json.written, mail.json.records.map(record => [record.type, record.value])], [true, [['MX', 'smtp.google.com'], ['TXT', 'v=spf1 include:_spf.google.com ~all'], ['TXT', 'google-site-verification=abc123']]]);
    const records = (await s.browser.get(`${s.base}/${id}/records`)).json.data;
    const mx = records.find(record => record.type === 'MX');
    assert.deepEqual([mx.value, mx.priority, mx.protected], ['smtp.google.com', 1, true]);
    assert.equal((await s.browser.delete(`${s.base}/${id}/records/${mx.id}`)).json.error.code, 'record_protected');
    const deleted = await s.browser.delete(`${s.base}/${id}/records/${blog.json.id}`);
    check('DELETE /v1/stores/{store}/domains/{id}/records/{record}', 200, deleted.json);

    // Switching provider replaces the records; null removes them.
    await s.browser.put(`${s.base}/${id}/mail-provider`, { provider: 'zoho' });
    assert.deepEqual(fake.state.records['adadns.com'].filter(record => record.type === 'MX').map(record => record.value), ['mx.zoho.com', 'mx2.zoho.com', 'mx3.zoho.com']);
    await s.browser.put(`${s.base}/${id}/mail-provider`, { provider: null });
    assert.equal(fake.state.records['adadns.com'].filter(record => record.comment === 'bitocard:mail').length, 0);
  });

  test('order emails come from the store’s own domain once Resend verifies it', async () => {
    const s = await seller();
    const bought = await buy(s, 'adasend.com');
    const sending = await s.browser.post(`${s.base}/${bought.json.id}/email-sending`);
    assert.equal(sending.status, 200, JSON.stringify(sending.json));
    check('POST /v1/stores/{store}/domains/{id}/email-sending', 200, sending.json);
    assert.deepEqual([sending.json.email_sending.status, sending.json.email_sending.from], ['not_started', 'orders@adasend.com']);
    assert.deepEqual(fake.state.records['adasend.com'].filter(record => record.comment === 'bitocard:email').map(record => [record.name, record.type]), [['resend._domainkey', 'TXT'], ['send', 'MX'], ['send', 'TXT']]);

    const { EmailService } = await import('../dist/notifications/email.service.js');
    const email = server.app.get(EmailService);
    await email.send({ to: 'buyer@example.com', subject: 'Your code', text: 'x', html: 'x' }, { resellerId: s.resellerId, name: 'Ada Digital' });
    assert.notEqual(fake.state.emails.at(-1).from, 'Ada Digital <orders@adasend.com>', 'not before it is verified');

    fake.state.sendingStatus = 'verified';
    try {
      const checked = await s.browser.post(`${s.base}/${bought.json.id}/check`);
      assert.equal(checked.json.email_sending.status, 'verified');
      await email.send({ to: 'buyer@example.com', subject: 'Your code', text: 'x', html: 'x' }, { resellerId: s.resellerId, name: 'Ada "Digital"' });
      assert.equal(fake.state.emails.at(-1).from, 'Ada Digital <orders@adasend.com>');
    } finally {
      fake.state.sendingStatus = 'pending';
    }
  });

  test('the transfer code is the owner’s; a bought domain cannot be disconnected', async () => {
    const s = await seller();
    const bought = await buy(s, 'adamove.com');
    const code = await s.browser.post(`${s.base}/${bought.json.id}/transfer-code`);
    check('POST /v1/stores/{store}/domains/{id}/transfer-code', 200, code.json);
    assert.deepEqual(code.json, { object: 'domain_transfer_code', domain: 'adamove.com', code: 'AUTH-7Kp2' });
    const updated = await s.browser.patch(`${s.base}/${bought.json.id}`, { auto_renew: false });
    check('PATCH /v1/stores/{store}/domains/{id}', 200, updated.json);
    assert.equal(updated.json.auto_renew, false);
    const renewed = await s.browser.post(`${s.base}/${bought.json.id}/renew`);
    check('POST /v1/stores/{store}/domains/{id}/renew', 200, renewed.json);
    assert.equal((await s.browser.delete(`${s.base}/${bought.json.id}`)).json.error.code, 'domain_purchased');
  });
});

describe('renewals and admins', () => {
  const cron = () => client(server.base).get('/v1/cron/domains', { authorization: 'Bearer cron-secret' });

  test('a domain bought here renews from the wallet 14 days before expiry; a short wallet is told, an unclear renewal is never repeated', async () => {
    const s = await seller();
    const bought = await buy(s, 'adarenew.com');
    const soon = new Date(Date.now() + 10 * 24 * 3600_000);
    await prisma.storeDomain.update({ where: { id: bought.json.id }, data: { expiresAt: soon } });
    fake.state.owned['adarenew.com'].expiresAt = soon.getTime();
    const before = (await s.browser.get('/v1/wallet')).json.available;
    const run = await cron();
    assert.equal(run.status, 200, JSON.stringify(run.json));
    const renewed = await prisma.storeDomain.findUniqueOrThrow({ where: { id: bought.json.id } });
    assert.ok(renewed.expiresAt.getTime() > soon.getTime() + 300 * 24 * 3600_000, 'a year more');
    assert.equal(before - (await s.browser.get('/v1/wallet')).json.available, 2_283_750, 'US$15.00 at NGN 1,522.50');
    assert.ok(await prisma.notification.findFirst({ where: { resellerId: s.resellerId, type: 'domain.renewed' } }));

    // Unclear: the money stays held and Vercel is not asked again until the expiry moves.
    const unclear = await seller();
    const second = await buy(unclear, 'adaunclear.com');
    await prisma.storeDomain.update({ where: { id: second.json.id }, data: { expiresAt: soon } });
    fake.state.owned['adaunclear.com'].expiresAt = soon.getTime();
    fake.state.renewReply = 'timeout';
    const renewals = fake.state.renewals;
    try {
      await cron();
      await cron();
    } finally {
      fake.state.renewReply = 'ok';
    }
    const waiting = await prisma.storeDomain.findUniqueOrThrow({ where: { id: second.json.id } });
    assert.deepEqual([waiting.renewalError, fake.state.renewals], ['renewal_pending', renewals]);
    assert.ok((await unclear.browser.get('/v1/wallet')).json.reserved > 0, 'held, not taken');
    fake.state.owned['adaunclear.com'].expiresAt += 365 * 24 * 3600_000;
    await cron();
    const settled = await prisma.storeDomain.findUniqueOrThrow({ where: { id: second.json.id } });
    assert.equal(settled.renewalError, null);
    assert.equal((await unclear.browser.get('/v1/wallet')).json.reserved, 0);

    const poor = await seller();
    const third = await buy(poor, 'adapoorrenew.com');
    await prisma.storeDomain.update({ where: { id: third.json.id }, data: { expiresAt: soon } });
    const balance = (await poor.browser.get('/v1/wallet')).json.available;
    await wallets.adjust(null, { resellerId: poor.resellerId, mode: 'live', balance: 'funding', amount: -balance, reason: 'Spent' });
    await cron();
    assert.equal((await prisma.storeDomain.findUniqueOrThrow({ where: { id: third.json.id } })).renewalError, 'insufficient_funds');
    assert.ok(await prisma.notification.findFirst({ where: { resellerId: poor.resellerId, type: 'domain.renewal_failed' } }));
    assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
  });

  test('admins list domains, suspend one (the store stops being served on it) and reinstate it, audited', async () => {
    const s = await seller();
    const bought = await buy(s, 'adaabuse.com');
    const listed = await admin.get('/v1/admin/domains?q=adaabuse');
    assert.deepEqual([listed.json.data.length, listed.json.data[0].store.subdomain, listed.json.data[0].cost], [1, s.store.subdomain, { amount: 1125, currency: 'USD' }]);
    const support = await adminClient(server, ['support']);
    assert.equal((await support.post(`/v1/admin/domains/${bought.json.id}/suspend`, { reason: 'Phishing reported' })).status, 403);
    const suspended = await admin.post(`/v1/admin/domains/${bought.json.id}/suspend`, { reason: 'Phishing reported' });
    assert.equal(suspended.json.status, 'suspended');
    assert.equal(fake.state.projectDomains['adaabuse.com'], undefined);
    assert.equal((await client(server.base).get('/v1/storefronts/domains/adaabuse.com')).status, 404);
    const reinstated = await admin.post(`/v1/admin/domains/${bought.json.id}/reinstate`, { reason: 'Cleared after review' });
    assert.equal(reinstated.json.status, 'active');
    const audit = await prisma.auditLog.findMany({ where: { targetId: bought.json.id }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(audit.map(entry => entry.action), ['domain.suspended', 'domain.reinstated']);
  });

  test('Test connection reads the storefront project with the token and team', async () => {
    const tested = await admin.post('/v1/admin/integrations/domains/test');
    assert.deepEqual([tested.status, tested.json.ok, tested.json.message], [200, true, 'Connected to the bitocard-storefront project.']);
  });
});
