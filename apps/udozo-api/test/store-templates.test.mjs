// Reseller store templates, each with design variants and colour themes; several stores per reseller;
// what each template sells (its categories, one product, or BitoCard Shop listings); each store's own home
// page (draft, publish, versions, restore, preview) limited to its template's sections; and the storefront showing it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { adminClient, lastEmailCode, resellerClient, startApp, listForTest } from './helpers.mjs';
import { responseChecker } from './openapi-docs.mjs';

let server;
let admin;
let prisma;
let check;
let templates;
let giftCard;
let software;

before(async () => {
  server = await startApp();
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  templates = await import('../dist/stores/templates.js');
  check = await responseChecker(server.app);
  for (const category of ['gift_cards', 'software']) {
    await prisma.countryCategory.upsert({ where: { countryCode_category: { countryCode: 'NG', category } }, create: { countryCode: 'NG', category, enabled: true }, update: { enabled: true } });
  }
  const stock = async body => {
    const created = await admin.post('/v1/admin/stock', { ...body, currency: 'USD', face_value: 2500, cost: 2000, codes: [{ code: `CODE-${Math.random().toString(36).slice(2, 10)}` }] });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    return created.json.product;
  };
  giftCard = await stock({ category: 'gift_cards', country: 'NG', brand: 'amazon', title: 'Amazon Template Card', description: 'A card.', redeem_instructions: 'Redeem online.' });
  software = await stock({ category: 'software', brand: 'Microsoft', duration_months: 12, title: 'Office Template Edition', description: 'One PC.', redeem_instructions: 'Enter the key.' });
});

after(async () => {
  await server?.close();
});

let counter = 0;
const sub = name => `${name}${(counter += 1)}${Date.now().toString(36)}`.slice(0, 30);

/** A reseller who lists both products. */
async function seller() {
  const reseller = await resellerClient(server);
  await reseller.browser.post('/v1/auth/email/verify', { code: await lastEmailCode(server.app, reseller.email) });
  await listForTest(server, { resellerId: reseller.resellerId, productIds: [giftCard.id, software.id] });
  return reseller;
}

async function published(reseller, body) {
  const created = await reseller.browser.post('/v1/stores', { name: 'Ada Digital', subdomain: sub('tpl'), ...body });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal((await reseller.browser.post(`/v1/stores/${created.json.id}/publish`)).status, 200);
  return created.json;
}

const storeKeys = async subdomain => (await fetch(`${server.base}/v1/store/products?store=${subdomain}`).then(res => res.json())).data.map(product => product.key);

describe('the templates', () => {
  test('seven templates, each unique, with at least three variants of at least three colour themes, whose pages use only their sections', () => {
    const { storeTemplates, starterHome } = templates;
    assert.deepEqual(storeTemplates.map(template => template.key), ['all_in_one', 'topups', 'gift_cards', 'single_product', 'vpn_shop', 'rdp_shop', 'resale_shop']);
    const heroes = new Set();
    for (const template of storeTemplates) {
      assert.ok(template.variants.length >= 3, `${template.key}: three variants`);
      assert.equal(new Set(template.variants.map(variant => variant.key)).size, template.variants.length);
      for (const variant of template.variants) {
        assert.ok(variant.themes.length >= 3, `${template.key}/${variant.key}: three themes`);
        assert.ok(!heroes.has(variant.style.hero), `${variant.style.hero} is used by one variant only`);
        heroes.add(variant.style.hero);
        for (const theme of variant.themes) for (const [name, value] of Object.entries(theme.colors)) assert.match(value, /^#[0-9a-f]{6}$/, `${theme.key}.${name}`);
        const page = starterHome(template.key, variant.key);
        assert.ok(page.length >= 2);
        for (const item of page) assert.ok(template.sections.includes(item.type), `${template.key}/${variant.key}: ${item.type}`);
        assert.equal(new Set(page.map(item => item.id)).size, page.length, 'section ids unique on the page');
      }
    }
  });

  test('what each template sells', () => {
    const { templateSells } = templates;
    const card = { key: 'gift_cards:NG:amazon:x', category: 'gift_cards' };
    assert.equal(templateSells({ template: 'gift_cards', focus: null }, card), true);
    assert.equal(templateSells({ template: 'topups', focus: null }, card), false);
    assert.equal(templateSells({ template: 'all_in_one', focus: null }, card), true);
    assert.equal(templateSells({ template: 'single_product', focus: card.key }, card), true);
    assert.equal(templateSells({ template: 'single_product', focus: 'other' }, card), false);
    assert.equal(templateSells({ template: 'vpn_shop', focus: null }, card), false);
    assert.equal(templateSells({ template: 'vpn_shop', focus: null }, { key: 'vpn:WW:bitocard:vpn-access-30d', category: 'vpn' }), true);
    assert.equal(templateSells({ template: 'rdp_shop', focus: null }, { key: 'rdp:WW:x:y', category: 'rdp' }), true);
    assert.equal(templateSells({ template: 'rdp_shop', focus: null }, { key: 'vpn:WW:bitocard:vpn-access-30d', category: 'vpn' }), false);
  });

  test("the list without the crypto desk (removed with crypto) or the Resale shop (Udozo's)", async () => {
    const reseller = await seller();
    const listed = await reseller.browser.get('/v1/store-templates');
    assert.equal(listed.status, 200, JSON.stringify(listed.json));
    check('GET /v1/store-templates', 200, listed.json);
    assert.equal(listed.json.data.some(item => item.key === 'crypto_desk'), false);
    // B2B reselling left BitoCard for Udozo (docs/UDOZO_SPINOFF_PLAN.md): its template is neither listed nor chosen.
    assert.equal(listed.json.data.some(item => item.key === 'resale_shop'), false);
    assert.ok(listed.json.data.every(item => item.available));
    const resale = await reseller.browser.post('/v1/stores', { name: 'Resale', subdomain: sub('resale'), template: 'resale_shop' });
    assert.deepEqual([resale.status, resale.json.error.code, resale.json.error.param], [400, 'template_unknown', 'template']);
    // It no longer exists, whatever crypto's switches say.
    await prisma.featureSwitch.create({ data: { key: 'p2p_trading', resellerId: reseller.resellerId, enabled: true } });
    const refused = await reseller.browser.post('/v1/stores', { name: 'Desk', subdomain: sub('desk'), template: 'crypto_desk' });
    assert.deepEqual([refused.status, refused.json.error.param], [400, 'template']);
    assert.ok(listed.json.data.every(item => item.crypto === false), 'kept in the response, always false');
  });
});

describe('admins’ switch per template', () => {
  test('a template switched off is closed to new choices, while stores already using it keep it', async () => {
    const reseller = await seller();
    const store = await published(reseller, { template: 'gift_cards' });
    assert.equal((await admin.put('/v1/admin/switches/store_template_gift_cards', { reseller_id: reseller.resellerId, enabled: false })).status, 200);
    const listed = (await reseller.browser.get('/v1/store-templates')).json.data.find(item => item.key === 'gift_cards');
    assert.deepEqual([listed.available, listed.reason], [false, 'BitoCard does not offer this template for your stores at the moment.']);
    const refused = await reseller.browser.post('/v1/stores', { name: 'More gifts', subdomain: sub('gifts'), template: 'gift_cards' });
    assert.deepEqual([refused.status, refused.json.error.code], [403, 'template_unavailable']);
    // The existing store still changes its design and colours, and still sells.
    const kept = await reseller.browser.patch(`/v1/stores/${store.id}`, { variant: 'boutique', theme: 'noir' });
    assert.equal(kept.status, 200, JSON.stringify(kept.json));
    assert.deepEqual(await storeKeys(store.subdomain), [giftCard.key]);
  });
});

describe('choosing a design', () => {
  test('template, variant and theme are checked; the theme brings its colours unless the reseller chose their own', async () => {
    const reseller = await seller();
    const created = await reseller.browser.post('/v1/stores', { name: 'Gifts', subdomain: sub('gifts'), template: 'gift_cards', variant: 'boutique', theme: 'blush' });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.deepEqual([created.json.template, created.json.variant, created.json.theme, created.json.branding.primary_color, created.json.branding.accent_color], ['gift_cards', 'boutique', 'blush', '#9f1239', '#e11d48']);
    const base = `/v1/stores/${created.json.id}`;
    assert.equal((await reseller.browser.patch(base, { variant: 'nope' })).json.error.code, 'variant_unknown');
    assert.equal((await reseller.browser.patch(base, { theme: 'candy' })).json.error.code, 'theme_unknown', 'candy is Card wall’s, not Boutique’s');
    assert.equal((await reseller.browser.post('/v1/stores', { name: 'Xy', subdomain: sub('x'), template: 'nope' })).json.error.param, 'template');
    // A new variant takes its first theme; own colours win over a new theme's.
    const variant = await reseller.browser.patch(base, { variant: 'gamer' });
    assert.deepEqual([variant.json.variant, variant.json.theme, variant.json.branding.primary_color], ['gamer', 'neon_green', '#22c55e']);
    const own = await reseller.browser.patch(base, { theme: 'cyber_pink', primary_color: '#123456' });
    assert.deepEqual([own.json.theme, own.json.branding.primary_color, own.json.branding.accent_color], ['cyber_pink', '#123456', '#22d3ee']);
  });

  test('a single product store needs a product the reseller lists', async () => {
    const reseller = await seller();
    const missing = await reseller.browser.post('/v1/stores', { name: 'One', subdomain: sub('one'), template: 'single_product' });
    assert.equal(missing.json.error.code, 'focus_required');
    const unlisted = await reseller.browser.post('/v1/stores', { name: 'One', subdomain: sub('one'), template: 'single_product', focus: 'software:WW:nobody:nothing' });
    assert.equal(unlisted.json.error.code, 'focus_not_listed');
    const created = await reseller.browser.post('/v1/stores', { name: 'One', subdomain: sub('one'), template: 'single_product', focus: software.key });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(created.json.focus, software.key);
  });
});

describe('what a store sells', () => {
  test('each template shows only its products, on its own store; checkout refuses the rest', async () => {
    const reseller = await seller();
    const everything = await published(reseller, {});
    const gifts = await published(reseller, { template: 'gift_cards' });
    const single = await published(reseller, { template: 'single_product', focus: software.key });
    const all = await storeKeys(everything.subdomain);
    assert.ok(all.includes(giftCard.key) && all.includes(software.key));
    assert.deepEqual(await storeKeys(gifts.subdomain), [giftCard.key]);
    assert.deepEqual(await storeKeys(single.subdomain), [software.key]);
    assert.equal((await fetch(`${server.base}/v1/store/products/${encodeURIComponent(software.key)}?store=${gifts.subdomain}`)).status, 404);
    // Checkout on the gift card store refuses the listed software, which its template does not sell.
    const shopper = async (method, path, body, token) => {
      const res = await fetch(`${server.base}${path}`, { method, headers: { 'bitocard-store': gifts.subdomain, 'content-type': 'application/json', 'idempotency-key': `k-${Math.random()}`, ...(token ? { 'bitocard-customer-session': token } : {}) }, body: body && JSON.stringify(body) });
      return { status: res.status, json: await res.json() };
    };
    const email = `tpl${Date.now()}@example.com`;
    const signup = await shopper('POST', '/v1/store/account/signup', { name: 'Chi Okafor', email, password: 'correct horse battery', country: 'NG' });
    assert.equal(signup.status, 201, JSON.stringify(signup.json));
    const token = signup.json.session.token;
    assert.equal((await shopper('POST', '/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) }, token)).status, 200);
    const refused = await shopper('POST', '/v1/store/checkouts', { product_id: software.id, face_value: 2500, preview: true, return_url: 'https://shop.example/r' }, token);
    assert.deepEqual([refused.status, refused.json.error.code, refused.json.error.param], [400, 'resource_missing', 'product_id']);
    const nav = await fetch(`${server.base}/v1/store/navigation?store=${gifts.subdomain}`).then(res => res.json());
    assert.deepEqual(nav.groups.map(group => group.key), ['gift-cards']);
    const storefront = await fetch(`${server.base}/v1/storefronts/${gifts.subdomain}`).then(res => res.json());
    check('GET /v1/storefronts/{subdomain}', 200, storefront);
    assert.deepEqual([storefront.design.template, storefront.design.variant, storefront.design.style.hero], ['gift_cards', 'card_wall', 'card_wall']);
  });
});

describe('the VPN and RDP shops', () => {
  test('a VPN shop sells only VPN, its spotlight finding the plan by itself; an RDP shop with nothing on sale is empty', async () => {
    const plan = await prisma.product.create({ data: { ...(await prisma.product.findUniqueOrThrow({ where: { id: software.id }, select: { name: true, brand: true, country: true, fixedValues: true, faceCurrency: true, denominationType: true } })), key: `vpn:WW:bitocard:template-${Date.now()}`, category: 'vpn', active: true } });
    const offer = await prisma.supplierProduct.findFirstOrThrow({ where: { productId: software.id } });
    await prisma.supplierProduct.create({ data: { supplierCode: offer.supplierCode, sku: `${offer.sku}-vpn`, costCurrency: offer.costCurrency, costRatio: offer.costRatio, meta: offer.meta ?? undefined, syncedAt: new Date(), productId: plan.id } });
    await prisma.countryCategory.upsert({ where: { countryCode_category: { countryCode: 'NG', category: 'vpn' } }, create: { countryCode: 'NG', category: 'vpn', enabled: true }, update: { enabled: true } });
    const reseller = await seller();
    await listForTest(server, { resellerId: reseller.resellerId, productIds: [plan.id] });

    const vpn = await published(reseller, { template: 'vpn_shop', variant: 'tunnel', theme: 'aurora_green' });
    assert.deepEqual([vpn.template, vpn.variant, vpn.theme, vpn.branding.primary_color], ['vpn_shop', 'tunnel', 'aurora_green', '#4ade80']);
    assert.deepEqual(await storeKeys(vpn.subdomain), [plan.key]);
    const home = await fetch(`${server.base}/v1/store/home?store=${vpn.subdomain}`).then(res => res.json());
    assert.equal(home.sections.find(item => item.type === 'product_spotlight')?.data.product?.key, plan.key, 'the plan, with no product chosen');
    const storefront = await fetch(`${server.base}/v1/storefronts/${vpn.subdomain}`).then(res => res.json());
    check('GET /v1/storefronts/{subdomain}', 200, storefront);
    assert.equal(storefront.design.style.hero, 'tunnel');

    const rdp = await published(reseller, { template: 'rdp_shop' });
    assert.deepEqual([rdp.variant, rdp.theme], ['desktop', 'azure']);
    assert.deepEqual(await storeKeys(rdp.subdomain), []);

    // Switched off by an admin, the template cannot be chosen.
    assert.equal((await admin.put('/v1/admin/switches/store_template_vpn_shop', { reseller_id: reseller.resellerId, enabled: false })).status, 200);
    assert.equal((await reseller.browser.post('/v1/stores', { name: 'Again', subdomain: sub('vpn'), template: 'vpn_shop' })).json.error.code, 'template_unavailable');
  });
});

describe('a store’s home page', () => {
  test('starts from the design’s page; the draft is checked against the template; publishing, versions, restore and preview', async () => {
    const reseller = await seller();
    const store = await published(reseller, { template: 'topups', variant: 'networks' });
    const base = `/v1/stores/${store.id}/home`;
    const editor = await reseller.browser.get(base);
    assert.equal(editor.status, 200, JSON.stringify(editor.json));
    check('GET /v1/stores/{id}/home', 200, editor.json);
    assert.deepEqual([editor.json.published, editor.json.version, editor.json.draft[0].type], [false, null, 'hero']);
    assert.ok(editor.json.sections_allowed.includes('quick_buy') && !editor.json.sections_allowed.includes('crypto_quote'));

    // The shopper sees the design's page until something is published.
    const before = await fetch(`${server.base}/v1/store/home?store=${store.subdomain}`).then(res => res.json());
    assert.deepEqual([before.published, before.sections.map(item => item.type)], [false, ['hero', 'brand_grid', 'brand_grid', 'quick_buy', 'trust_bar']]);

    const refused = await reseller.browser.put(`${base}/draft`, { sections: [{ id: 'x1', type: 'crypto_quote', span: { lg: 12, md: 6 }, title: 'Coins' }] });
    assert.deepEqual([refused.status, refused.json.error.code, refused.json.error.param], [400, 'layout_invalid', 'sections[0].type']);
    const draft = await reseller.browser.put(`${base}/draft`, { sections: [{ id: 'q1', type: 'quick_buy', span: { lg: 12, md: 6 }, title: 'Top up', categories: ['airtime'] }, { id: 'f1', type: 'faq', span: { lg: 12, md: 6 }, title: 'Help', items: [{ question: 'How?', answer: 'Like this.' }] }] });
    assert.equal(draft.status, 200, JSON.stringify(draft.json));
    check('PUT /v1/stores/{id}/home/draft', 200, draft.json);
    const stillOld = await fetch(`${server.base}/v1/store/home?store=${store.subdomain}`).then(res => res.json());
    assert.equal(stillOld.sections[0].type, 'hero', 'the draft is not shown');

    const preview = await reseller.browser.post(`${base}/preview`);
    check('POST /v1/stores/{id}/home/preview', 200, preview.json);
    assert.match(preview.json.url, new RegExp(`^https?://${store.subdomain}\\.`));
    const previewed = await fetch(`${server.base}/v1/store/home?store=${store.subdomain}&preview=${encodeURIComponent(preview.json.token)}`).then(res => res.json());
    assert.deepEqual([previewed.preview, previewed.sections.map(item => item.type)], [true, ['quick_buy', 'faq']]);
    assert.equal((await fetch(`${server.base}/v1/store/home?store=${store.subdomain}&preview=1.bad`)).status, 401);

    const publish = await reseller.browser.post(`${base}/publish`);
    check('POST /v1/stores/{id}/home/publish', 200, publish.json);
    assert.deepEqual([publish.json.published, publish.json.version], [true, 1]);
    const live = await fetch(`${server.base}/v1/store/home?store=${store.subdomain}`).then(res => res.json());
    assert.deepEqual([live.published, live.version, live.sections.map(item => item.type)], [true, 1, ['quick_buy', 'faq']]);

    const reset = await reseller.browser.post(`${base}/reset`);
    check('POST /v1/stores/{id}/home/reset', 200, reset.json);
    assert.equal(reset.json.draft[0].type, 'hero');
    assert.equal((await reseller.browser.post(`${base}/publish`)).json.version, 2);
    const versions = await reseller.browser.get(`${base}/versions`);
    check('GET /v1/stores/{id}/home/versions', 200, versions.json);
    assert.deepEqual(versions.json.data.map(item => [item.version, item.restorable]), [[2, true], [1, true]]);
    const restored = await reseller.browser.post(`${base}/restore`, { version: 1 });
    check('POST /v1/stores/{id}/home/restore', 200, restored.json);
    assert.deepEqual(restored.json.draft.map(item => item.type), ['quick_buy', 'faq']);

    // A new template starts the page again from its design; earlier versions can no longer be restored.
    const changed = await reseller.browser.patch(`/v1/stores/${store.id}`, { template: 'gift_cards' });
    assert.deepEqual([changed.json.template, changed.json.variant, changed.json.theme], ['gift_cards', 'card_wall', 'candy']);
    const shown = await fetch(`${server.base}/v1/store/home?store=${store.subdomain}`).then(res => res.json());
    assert.deepEqual([shown.published, shown.sections[0].type], [false, 'hero']);
    assert.equal((await reseller.browser.post(`${base}/restore`, { version: 1 })).json.error.code, 'version_other_template');

    const other = await resellerClient(server);
    assert.equal((await other.browser.get(base)).status, 404);
  });

  test('sections a template adds are filled in for the shopper', async () => {
    const reseller = await seller();
    const store = await published(reseller, { template: 'single_product', focus: software.key });
    const home = await fetch(`${server.base}/v1/store/home?store=${store.subdomain}`).then(res => res.json());
    check('GET /v1/store/home', 200, home);
    const spotlight = home.sections.find(item => item.type === 'product_spotlight');
    assert.equal(spotlight.data.product.key, software.key);
  });
});

describe('the crypto desk, removed with crypto', () => {
  test('its migration moves a store still on it to All-in-one on its starting page, and drops its pages, versions and switch', async () => {
    const reseller = await seller();
    const store = await published(reseller, { template: 'topups', variant: 'networks' });
    const other = await published(reseller, { template: 'gift_cards' });
    const desk = [{ id: 'c1', type: 'crypto_quote', span: { lg: 12, md: 6 }, title: 'Coins' }];
    const kept = [{ id: 'h1', type: 'hero', span: { lg: 12, md: 6 }, title: 'Hello' }];
    // As a store on the retired template would be.
    await prisma.store.update({ where: { id: store.id }, data: { template: 'crypto_desk', variant: 'terminal', theme: 'matrix', homeDraft: desk, homePublished: desk, homePublishedAt: new Date() } });
    await prisma.store.update({ where: { id: other.id }, data: { homeDraft: kept } });
    await prisma.storeHomeVersion.create({ data: { storeId: store.id, version: 1, template: 'crypto_desk', variant: 'terminal', sections: desk } });
    await prisma.storeHomeVersion.create({ data: { storeId: other.id, version: 1, template: 'gift_cards', variant: 'boutique', sections: kept } });
    await prisma.featureSwitch.create({ data: { key: 'store_template_crypto_desk', enabled: false } });

    const sql = readFileSync(new URL('../prisma/migrations/20270131000000_retire_crypto_desk/migration.sql', import.meta.url), 'utf8');
    for (const statement of sql.replace(/^--.*$/gm, '').split(';').map(item => item.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);

    const moved = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    assert.deepEqual([moved.template, moved.variant, moved.theme, moved.homeDraft, moved.homePublished], ['all_in_one', 'classic', 'navy_pink', null, null]);
    assert.deepEqual((await prisma.store.findUniqueOrThrow({ where: { id: other.id } })).homeDraft, kept, 'other pages untouched');
    assert.deepEqual((await prisma.storeHomeVersion.findMany({ where: { storeId: { in: [store.id, other.id] } } })).map(row => row.storeId), [other.id]);
    assert.equal(await prisma.featureSwitch.count({ where: { key: 'store_template_crypto_desk' } }), 0);

    // The moved store shows its starting page.
    const home = await fetch(`${server.base}/v1/store/home?store=${store.subdomain}`).then(res => res.json());
    assert.equal(home.published, false);
    assert.ok(home.sections.length > 0 && home.sections.every(item => item.type !== 'crypto_quote'));
  });
});
