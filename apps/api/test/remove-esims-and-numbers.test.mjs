// eSIMs and virtual numbers removed for good (migration 20270202000000_remove_esims_and_numbers): their orders, holds,
// ledger entries (balances reversed, so the books still balance), tables, catalogue, suppliers and settings go, the
// two categories leave the enum, home pages lose their sections, and everything else is left as it was. Run on its own
// PGlite with every migration before it, seeded by hand, then the migration itself.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readdirSync, readFileSync } from 'node:fs';

const target = '20270202000000_remove_esims_and_numbers';
const dir = new URL('../prisma/migrations/', import.meta.url);
const names = readdirSync(dir).filter(entry => /^\d+_/.test(entry)).sort();
const debitNormal = new Set(['reseller_owed', 'provider_balance', 'processing_fees', 'supplier_float', 'cost_of_sales', 'promotions', 'crypto_custody', 'crypto_promotions']);
const afrippaOperator = '00000000-0000-4000-8000-0000000000a1';

let db;
const ids = {};
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

async function account(kind, owner, nonNegative) {
  const id = randomUUID();
  await db.query(`INSERT INTO ledger_accounts (id, kind, mode, currency, owner_key, reseller_id, non_negative) VALUES ($1, $2, 'live', 'NGN', $3, $4, $5)`, [id, kind, owner, owner.startsWith('reseller:') ? ids.reseller : null, nonNegative]);
  return { id, kind };
}

/** A balanced entry, applied to the accounts as LedgerService does. */
async function post(reference, lines) {
  const entry = randomUUID();
  await db.query(`INSERT INTO journal_entries (id, mode, type, reference, reseller_id, description) VALUES ($1, 'live', 'test', $2, $3, 'test')`, [entry, reference, ids.reseller]);
  for (const [acct, amount] of lines) {
    await db.query('INSERT INTO ledger_postings (id, entry_id, account_id, amount_minor) VALUES ($1, $2, $3, $4)', [randomUUID(), entry, acct.id, amount]);
    await db.query('UPDATE ledger_accounts SET balance_minor = balance_minor + $2 WHERE id = $1', [acct.id, debitNormal.has(acct.kind) ? amount : -amount]);
  }
}

async function order(category, supplier, key) {
  const product = randomUUID();
  const offer = randomUUID();
  const quote = randomUUID();
  const id = randomUUID();
  const hold = randomUUID();
  await db.query(`INSERT INTO products (id, key, category, country, brand, name, face_currency, denomination_type, updated_at) VALUES ($1, $2, $3, 'NG', $4, $2, 'NGN', 'fixed', now())`, [product, key, category, key.split(':')[2]]);
  await db.query(`INSERT INTO supplier_products (id, supplier_code, product_id, sku, cost_currency, cost_ratio, synced_at) VALUES ($1, $2, $3, $4, 'NGN', 1, now())`, [offer, supplier, product, key]);
  const common = [ids.reseller, product, offer, supplier];
  await db.query(
    `INSERT INTO quotes (id, reseller_id, mode, product_id, quantity, face_value_minor, face_currency, currency, wholesale_minor, price_minor, tax_minor, reseller_profit_minor, supplier_code, supplier_product_id, supplier_cost_minor, supplier_currency, expires_at)
     VALUES ($1, $2, 'live', $3, 1, 1000, 'NGN', 'NGN', 1000, 1000, 0, 0, $5, $4, 600, 'NGN', now())`,
    [quote, ...common],
  );
  await db.query(
    `INSERT INTO orders (id, reseller_id, mode, quote_id, product_id, quantity, face_value_minor, face_currency, currency, wholesale_minor, tax_minor, price_minor, reseller_profit_minor, supplier_code, supplier_product_id, supplier_cost_minor, supplier_currency, supplier_reference, status, hold_id, updated_at)
     VALUES ($1, $2, 'live', $6, $3, 1, 1000, 'NGN', 'NGN', 1000, 0, 1000, 0, $5, $4, 600, 'NGN', $7, 'completed', $8, now())`,
    [id, ...common, quote, `ref-${id}`, hold],
  );
  await db.query(`INSERT INTO holds (id, reseller_id, mode, currency, amount_minor, from_funding_minor, from_earnings_minor, reference, status) VALUES ($1, $2, 'live', 'NGN', 1000, 1000, 0, $3, 'captured')`, [hold, ids.reseller, `order:${id}`]);
  await post(`hold:${hold}`, [[ids.funding, 1000n], [ids.reserved, -1000n]]);
  await post(`hold_capture:${hold}`, [[ids.reserved, 1000n], [ids.revenue, -1000n]]);
  await post(`order_cost:${id}`, [[ids.cost, 600n], [ids.float, -600n]]);
  return { id, product, key, hold };
}

before(async () => {
  db = new PGlite({ extensions: { pg_trgm } });
  for (const name of names.slice(0, names.indexOf(target))) await db.exec(readFileSync(new URL(`${name}/migration.sql`, dir), 'utf8'));

  ids.reseller = randomUUID();
  await db.query(`INSERT INTO resellers (id, name, updated_at) VALUES ($1, 'Ada Digital', now())`, [ids.reseller]);
  ids.funding = await account('reseller_funding', `reseller:${ids.reseller}`, true);
  ids.reserved = await account('reseller_reserved', `reseller:${ids.reseller}`, true);
  ids.revenue = await account('platform_revenue', 'platform', false);
  ids.cost = await account('cost_of_sales', 'platform', false);
  ids.float = await account('supplier_float', 'provider:any', false);
  ids.provider = await account('provider_balance', 'provider:flutterwave', false);
  await post('payment:top-up', [[ids.provider, 10_000n], [ids.funding, -10_000n]]);

  ids.number = await order('virtual_numbers', 'didww', 'virtual_numbers:GB:local:london');
  ids.esim = await order('esim', 'esim_access', 'esim:WW:global:10gb-30d');
  ids.airtime = await order('airtime', 'reloadly', 'airtime:NG:mtn:topup');
  await db.query(
    `INSERT INTO virtual_numbers (id, order_id, reseller_id, mode, product_id, supplier_code, supplier_number_id, number, monthly_cost_minor, cost_currency, expires_at, updated_at)
     VALUES ($1, $2, $3, 'live', $4, 'didww', 'did-1', '+442071234567', 500, 'USD', now(), now())`,
    [randomUUID(), ids.number.id, ids.reseller, ids.number.product],
  );
  await db.query(
    `INSERT INTO esims (id, order_id, reseller_id, mode, product_id, supplier_code, supplier_esim_id, iccid, updated_at) VALUES ($1, $2, $3, 'live', $4, 'esim_access', 'tran-1', '8943', now())`,
    [randomUUID(), ids.esim.id, ids.reseller, ids.esim.product],
  );
  // A number renewal: its hold, taken.
  const renewal = randomUUID();
  await db.query(`INSERT INTO holds (id, reseller_id, mode, currency, amount_minor, from_funding_minor, from_earnings_minor, reference, status) VALUES ($1, $2, 'live', 'NGN', 400, 400, 0, 'number_renewal:n1:2026-11', 'captured')`, [renewal, ids.reseller]);
  await post(`hold:${renewal}`, [[ids.funding, 400n], [ids.reserved, -400n]]);
  await post(`hold_capture:${renewal}`, [[ids.reserved, 400n], [ids.revenue, -400n]]);
  await post('number_renewal_cost:n1:2026-11', [[ids.cost, 300n], [ids.float, -300n]]);

  await db.query(
    `INSERT INTO events (id, reseller_id, mode, type, payload) VALUES ($1, $2, 'live', 'order.completed', $3), ($4, $2, 'live', 'order.completed', $5), ($6, $2, 'live', 'esim.updated', '{}')`,
    [randomUUID(), ids.reseller, JSON.stringify({ data: { object: { id: ids.number.id } } }), randomUUID(), JSON.stringify({ data: { object: { id: ids.airtime.id } } }), randomUUID()],
  );
  await db.query(`INSERT INTO integration_settings (platform, key, value, encrypted, updated_at) VALUES ('bitocard', 'DIDWW_API_KEY', 'x', false, now()), ('bitocard', 'RELOADLY_CLIENT_ID', 'y', false, now())`);
  await db.query(`INSERT INTO feature_switches (id, key, reseller_id, enabled, updated_at) VALUES ($1, 'crypto_global', $2, true, now()), ($3, 'crypto_global', $4, true, now())`, [randomUUID(), ids.reseller, randomUUID(), afrippaOperator]);

  const sections = [
    { id: 'h', type: 'hero', title: 'Hello' },
    { id: 'p', type: 'promo', title: 'Travel', illustration: 'esim', cta: { label: 'Browse eSIMs', href: '/catalogs/esim' } },
    { id: 'r', type: 'product_rail', title: 'Numbers', source: 'category', category: 'virtual_numbers' },
    { id: 'g', type: 'category_grid', title: 'Shop', categories: ['airtime', 'esim', 'virtual_numbers'] },
    { id: 'k', type: 'product_rail', title: 'Picked', source: 'manual', productKeys: ['esim:WW:global:10gb-30d', 'airtime:NG:mtn:topup'] },
  ];
  await db.query(`INSERT INTO storefront_pages (key, draft, published, updated_at) VALUES ('home-test', $1, $1, now())`, [JSON.stringify(sections)]);
  ids.store = randomUUID();
  await db.query(`INSERT INTO stores (id, reseller_id, name, subdomain, template, focus, home_draft, updated_at) VALUES ($1, $2, 'Ada', 'ada-test', 'single_product', 'esim:WW:global:10gb-30d', $3, now())`, [ids.store, ids.reseller, JSON.stringify(sections)]);

  await db.exec(readFileSync(new URL(`${target}/migration.sql`, dir), 'utf8'));
});

after(async () => {
  await db?.close();
});

describe('removing eSIMs and virtual numbers', () => {
  test('their orders, holds and entries go; the airtime order and the top-up stay', async () => {
    const orders = (await db.query('SELECT id FROM orders')).rows.map(row => row.id);
    assert.deepEqual(orders, [ids.airtime.id]);
    assert.equal((await db.query('SELECT 1 FROM products WHERE key LIKE $1 OR key LIKE $2', ['esim:%', 'virtual_numbers:%'])).rows.length, 0);
    assert.deepEqual((await db.query('SELECT id FROM holds')).rows.map(row => row.id), [ids.airtime.hold]);
    const references = (await db.query('SELECT reference FROM journal_entries ORDER BY reference')).rows.map(row => row.reference);
    assert.deepEqual(references, [`hold:${ids.airtime.hold}`, `hold_capture:${ids.airtime.hold}`, `order_cost:${ids.airtime.id}`, 'payment:top-up'].sort());
  });

  test('the ledger still balances: every balance equals its remaining postings, and money moved back', async () => {
    const rows = (await db.query(`SELECT a.id, a.kind, a.balance_minor, COALESCE(SUM(p.amount_minor), 0) AS posted FROM ledger_accounts a LEFT JOIN ledger_postings p ON p.account_id = a.id GROUP BY a.id`)).rows;
    for (const row of rows) assert.equal(BigInt(row.balance_minor), debitNormal.has(row.kind) ? BigInt(row.posted) : -BigInt(row.posted), `${row.kind} matches its postings`);
    const total = await one('SELECT COALESCE(SUM(amount_minor), 0) AS sum FROM ledger_postings');
    assert.equal(BigInt(total.sum), 0n);
    const balance = async acct => BigInt((await one('SELECT balance_minor FROM ledger_accounts WHERE id = $1', [acct.id])).balance_minor);
    assert.equal(await balance(ids.funding), 9_000n, 'only the airtime order is still paid from the wallet');
    assert.equal(await balance(ids.revenue), 1_000n);
    assert.equal(await balance(ids.cost), 600n);
    assert.equal(await balance(ids.float), -600n);
  });

  test('their tables, suppliers, settings, events and the enum values are gone; Afrippa’s switch stays', async () => {
    const tables = (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('esims', 'esim_top_ups', 'virtual_numbers', 'number_messages') OR table_name LIKE '\\_rm\\_%'`)).rows;
    assert.deepEqual(tables, []);
    const enumValues = (await db.query(`SELECT unnest(enum_range(NULL::"ProductCategory"))::text AS value`)).rows.map(row => row.value);
    assert.ok(!enumValues.includes('esim') && !enumValues.includes('virtual_numbers') && enumValues.includes('airtime') && enumValues.includes('vpn'));
    assert.deepEqual((await db.query(`SELECT code FROM suppliers WHERE code IN ('didww', 'esim_access', 'telnyx', 'airalo')`)).rows, []);
    const talking = await one(`SELECT categories::text[] AS categories FROM suppliers WHERE code = 'africas_talking'`);
    assert.ok(!talking.categories.includes('virtual_numbers') && talking.categories.includes('airtime'));
    assert.deepEqual((await db.query('SELECT key FROM integration_settings ORDER BY key')).rows.map(row => row.key), ['RELOADLY_CLIENT_ID']);
    assert.equal((await db.query(`SELECT 1 FROM country_categories WHERE category::text IN ('esim', 'virtual_numbers')`)).rows.length, 0);
    const events = (await db.query('SELECT payload FROM events')).rows.map(row => JSON.parse(row.payload).data.object.id);
    assert.deepEqual(events, [ids.airtime.id]);
    assert.equal((await db.query(`SELECT column_name FROM information_schema.columns WHERE (table_name = 'products' AND column_name = 'features') OR (table_name = 'suppliers' AND column_name = 'feature_rules')`)).rows.length, 0);
    const switches = (await db.query(`SELECT reseller_id FROM feature_switches WHERE key = 'crypto_global'`)).rows.map(row => row.reseller_id);
    assert.deepEqual(switches, [afrippaOperator]);
  });

  test('home pages lose the eSIM promo, the number rail and their categories and products; the store selling one becomes All-in-one', async () => {
    const page = await one(`SELECT published FROM storefront_pages WHERE key = 'home-test'`);
    assert.deepEqual(page.published.map(item => item.id), ['h', 'r', 'g', 'k']);
    const rail = page.published.find(item => item.id === 'r');
    assert.equal(rail.source, 'new');
    assert.equal(rail.category, undefined);
    assert.deepEqual(page.published.find(item => item.id === 'g').categories, ['airtime']);
    assert.deepEqual(page.published.find(item => item.id === 'k').productKeys, ['airtime:NG:mtn:topup']);
    const store = await one('SELECT template, focus, home_draft FROM stores WHERE id = $1', [ids.store]);
    assert.deepEqual([store.template, store.focus, store.home_draft], ['all_in_one', null, null]);
  });
});
