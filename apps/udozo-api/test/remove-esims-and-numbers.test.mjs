// eSIMs and virtual numbers removed for good (migration 20270328000000_remove_esims_and_numbers): their orders, eSIMs,
// top-ups, suppliers and catalogue go, and so do the ledger entries they posted, taken out of every balance exactly
// so the books still balance and every balance is still the sum of its postings.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { seedProduct } from '../scripts/product-seed.mjs';

const removal = '20270328000000_remove_esims_and_numbers';
const dir = new URL('../prisma/migrations/', import.meta.url);
const migrations = readdirSync(dir).filter(entry => /^\d+_/.test(entry)).sort();
const sql = name => readFileSync(new URL(`${name}/migration.sql`, dir), 'utf8');

const debitNormal = "('reseller_owed', 'provider_balance', 'processing_fees', 'supplier_float', 'cost_of_sales', 'promotions', 'crypto_custody', 'crypto_promotions')";

let db;
const id = {
  reseller: randomUUID(),
  esimProduct: randomUUID(),
  giftProduct: randomUUID(),
  esimQuote: randomUUID(),
  giftQuote: randomUUID(),
  esimOrder: randomUUID(),
  giftOrder: randomUUID(),
  esimHold: randomUUID(),
  giftHold: randomUUID(),
  esim: randomUUID(),
  topUp: randomUUID(),
  topUpHold: randomUUID(),
};
const account = { funding: randomUUID(), reserved: randomUUID(), revenue: randomUUID(), provider: randomUUID(), esimCost: randomUUID(), esimFloat: randomUUID(), giftCost: randomUUID(), giftFloat: randomUUID() };

async function entry(reference, postings, metadata = null) {
  const entryId = randomUUID();
  await db.query(`INSERT INTO journal_entries (id, mode, type, reference, description, metadata) VALUES ($1, 'live', 'test', $2, $2, $3)`, [entryId, reference, metadata]);
  for (const [accountId, amount] of postings) await db.query(`INSERT INTO ledger_postings (id, entry_id, account_id, amount_minor) VALUES ($1, $2, $3, $4)`, [randomUUID(), entryId, accountId, amount]);
}

/** Each account's balance from its postings, by its normal side, as LedgerService keeps it. */
const fromPostings = `
  SELECT a.id, a.balance_minor::text AS balance,
         COALESCE(SUM(CASE WHEN a.kind::text IN ${debitNormal} THEN p.amount_minor ELSE -p.amount_minor END), 0)::text AS sum
  FROM ledger_accounts a LEFT JOIN ledger_postings p ON p.account_id = a.id GROUP BY a.id`;

const balanceOf = async accountId => (await db.query('SELECT balance_minor::text AS b FROM ledger_accounts WHERE id = $1', [accountId])).rows[0]?.b;

describe('removing eSIMs and virtual numbers', () => {
  before(async () => {
    db = new PGlite({ extensions: { pg_trgm } });
    for (const name of migrations.filter(name => name < removal)) await db.exec(sql(name));

    await db.query(`INSERT INTO resellers (id, name, updated_at) VALUES ($1, 'Ada Digital', now())`, [id.reseller]);
    for (const [productId, key, category] of [[id.esimProduct, 'esim:WW:global:1gb-7d', 'esim'], [id.giftProduct, 'gift_cards:US:amazon:usd', 'gift_cards']]) {
      await db.query(`INSERT INTO products (id, key, category, country, brand, name, face_currency, denomination_type, updated_at) VALUES ($1, $2, $3, 'US', 'brand', $2, 'USD', 'fixed', now())`, [productId, key, category]);
    }
    for (const [quoteId, productId, supplier] of [[id.esimQuote, id.esimProduct, 'esim_access'], [id.giftQuote, id.giftProduct, 'reloadly']]) {
      await db.query(
        `INSERT INTO quotes (id, reseller_id, mode, product_id, quantity, face_value_minor, face_currency, currency, wholesale_minor, price_minor, tax_minor, reseller_profit_minor, supplier_code, supplier_product_id, supplier_cost_minor, supplier_currency, expires_at)
         VALUES ($1, $2, 'live', $3, 1, 1000, 'USD', 'NGN', 1000, 1000, 0, 0, $4, $5, 600, 'USD', now())`,
        [quoteId, id.reseller, productId, supplier, randomUUID()],
      );
    }
    for (const [holdId, reference, amount] of [[id.esimHold, `order:${id.esimOrder}`, 1000], [id.giftHold, `order:${id.giftOrder}`, 2000], [id.topUpHold, `esim_top_up:${id.topUp}`, 300]]) {
      await db.query(`INSERT INTO holds (id, reseller_id, mode, currency, amount_minor, from_funding_minor, from_earnings_minor, reference, status) VALUES ($1, $2, 'live', 'NGN', $3, $3, 0, $4, 'captured')`, [holdId, id.reseller, amount, reference]);
    }
    for (const [orderId, quoteId, productId, supplier, holdId, amount] of [[id.esimOrder, id.esimQuote, id.esimProduct, 'esim_access', id.esimHold, 1000], [id.giftOrder, id.giftQuote, id.giftProduct, 'reloadly', id.giftHold, 2000]]) {
      await db.query(
        `INSERT INTO orders (id, reseller_id, mode, quote_id, product_id, quantity, face_value_minor, face_currency, currency, wholesale_minor, tax_minor, price_minor, reseller_profit_minor, supplier_code, supplier_product_id, supplier_cost_minor, supplier_currency, supplier_reference, hold_id, status, updated_at)
         VALUES ($1, $2, 'live', $3, $4, 1, 1000, 'USD', 'NGN', $6, 0, $6, 0, $5, $7, 600, 'USD', $8, $9, 'completed', now())`,
        [orderId, id.reseller, quoteId, productId, supplier, amount, randomUUID(), `ref-${orderId}`, holdId],
      );
    }
    await db.query(`INSERT INTO order_deliveries (id, order_id, kind, serial) VALUES ($1, $2, 'esim', '8999')`, [randomUUID(), id.esimOrder]);
    await db.query(`INSERT INTO esims (id, order_id, reseller_id, mode, product_id, supplier_code, supplier_esim_id, iccid, updated_at) VALUES ($1, $2, $3, 'live', $4, 'esim_access', 'tran-1', '8999', now())`, [id.esim, id.esimOrder, id.reseller, id.esimProduct]);
    await db.query(
      `INSERT INTO esim_top_ups (id, esim_id, reseller_id, mode, reference, supplier_package, name, cost_minor, cost_currency, wholesale_minor, price_minor, currency, hold_id, status) VALUES ($1, $2, $3, 'live', 'bc_tu_1', 'pkg', '1GB', 200, 'USD', 300, 300, 'NGN', $4, 'completed')`,
      [id.topUp, id.esim, id.reseller, id.topUpHold],
    );

    const reseller = `reseller:${id.reseller}`;
    for (const [accountId, kind, currency, owner, nonNegative] of [
      [account.funding, 'reseller_funding', 'NGN', reseller, true],
      [account.reserved, 'reseller_reserved', 'NGN', reseller, true],
      [account.revenue, 'platform_revenue', 'NGN', 'platform', false],
      [account.provider, 'provider_balance', 'NGN', 'provider:flutterwave', false],
      [account.esimCost, 'cost_of_sales', 'USD', 'provider:esim_access', false],
      [account.esimFloat, 'supplier_float', 'USD', 'provider:esim_access', false],
      [account.giftCost, 'cost_of_sales', 'USD', 'provider:reloadly', false],
      [account.giftFloat, 'supplier_float', 'USD', 'provider:reloadly', false],
    ]) {
      await db.query(`INSERT INTO ledger_accounts (id, kind, mode, currency, owner_key, reseller_id, non_negative) VALUES ($1, $2, 'live', $3, $4, $5, $6)`, [accountId, kind, currency, owner, owner === reseller ? id.reseller : null, nonNegative]);
    }
    // A top-up (stays), then each order's hold, capture and supplier cost, and the eSIM's top-up (all go but the gift card's).
    await entry(`payment:${randomUUID()}`, [[account.provider, 10_000], [account.funding, -10_000]]);
    for (const [holdId, orderId, amount, cost, float] of [[id.esimHold, id.esimOrder, 1000, account.esimCost, account.esimFloat], [id.giftHold, id.giftOrder, 2000, account.giftCost, account.giftFloat]]) {
      await entry(`hold:${holdId}`, [[account.funding, amount], [account.reserved, -amount]], { hold_id: holdId });
      await entry(`hold_capture:${holdId}`, [[account.reserved, amount], [account.revenue, -amount]], { hold_id: holdId });
      await entry(`order_cost:${orderId}`, [[cost, 600], [float, -600]], { order_id: orderId });
    }
    await entry(`hold:${id.topUpHold}`, [[account.funding, 300], [account.reserved, -300]], { hold_id: id.topUpHold });
    await entry(`hold_capture:${id.topUpHold}`, [[account.reserved, 300], [account.revenue, -300]], { hold_id: id.topUpHold });
    await entry(`esim_top_up_cost:${id.topUp}`, [[account.esimCost, 200], [account.esimFloat, -200]], { esim_top_up_id: id.topUp });
    await entry(`number_renewal_cost:${randomUUID()}:2026-10`, [[account.giftCost, 50], [account.giftFloat, -50]]);
    await db.query(`UPDATE ledger_accounts a SET balance_minor = s.sum::bigint FROM (${fromPostings}) s WHERE a.id = s.id`);
    await db.query(`INSERT INTO storefront_pages (key, draft, updated_at) VALUES ('removal-test', $1, now())`, [
      JSON.stringify({
        sections: [
          { id: 'a', type: 'promo', title: 'Travelling?', illustration: 'esim', cta: { label: 'Browse eSIMs', href: '/catalogs/esim' } },
          { id: 'b', type: 'product_rail', source: 'category', category: 'virtual_numbers', viewAllHref: '/catalogs/virtual_numbers?q=uk' },
          { id: 'c', type: 'category_grid', categories: ['gift_cards', 'esim', 'virtual_numbers'] },
          { id: 'd', type: 'product_rail', source: 'manual', products: ['esim:WW:global:1gb-7d', 'gift_cards:US:amazon:usd'] },
        ],
      }),
    ]);

    await db.exec(sql(removal));
  });

  after(() => db?.close());

  test('takes the entries out of every balance: each is still the sum of its postings, and the books balance', async () => {
    const { rows } = await db.query(fromPostings);
    for (const row of rows) assert.equal(row.balance, row.sum, `account ${row.id}`);
    const unbalanced = await db.query('SELECT entry_id FROM ledger_postings GROUP BY entry_id HAVING SUM(amount_minor) <> 0');
    assert.equal(unbalanced.rows.length, 0);
    assert.equal(await balanceOf(account.funding), String(10_000 - 2000));
    assert.equal(await balanceOf(account.reserved), '0');
    assert.equal(await balanceOf(account.revenue), '2000');
    assert.equal(await balanceOf(account.giftCost), '600');
    // eSIM Access's own accounts have nothing left on them and are gone.
    assert.equal(await balanceOf(account.esimCost), undefined);
    assert.equal(await balanceOf(account.esimFloat), undefined);
    const references = (await db.query('SELECT reference FROM journal_entries ORDER BY reference')).rows.map(row => row.reference);
    assert.deepEqual(references.filter(reference => !reference.startsWith('payment:')), [`hold:${id.giftHold}`, `hold_capture:${id.giftHold}`, `order_cost:${id.giftOrder}`].sort());
  });

  test('deletes the orders, holds, eSIMs and products, and keeps everything else', async () => {
    assert.deepEqual((await db.query('SELECT id FROM orders')).rows.map(row => row.id), [id.giftOrder]);
    assert.deepEqual((await db.query('SELECT id FROM quotes')).rows.map(row => row.id), [id.giftQuote]);
    assert.deepEqual((await db.query('SELECT id FROM holds')).rows.map(row => row.id), [id.giftHold]);
    assert.deepEqual((await db.query('SELECT id FROM products')).rows.map(row => row.id), [id.giftProduct]);
    assert.equal((await db.query('SELECT 1 FROM order_deliveries')).rows.length, 0);
    for (const table of ['esims', 'esim_top_ups', 'virtual_numbers', 'number_messages']) assert.equal((await db.query('SELECT to_regclass($1) AS t', [table])).rows[0].t, null, table);
  });

  test('leaves no home page pointing at eSIMs or numbers', async () => {
    const { draft } = (await db.query(`SELECT draft FROM storefront_pages WHERE key = 'removal-test'`)).rows[0];
    assert.deepEqual(draft.sections, [
      { id: 'a', type: 'promo', title: 'Travelling?', illustration: 'globe', cta: { label: 'Browse eSIMs', href: '/catalogs' } },
      { id: 'b', type: 'product_rail', source: 'category', category: 'software', viewAllHref: '/catalogs' },
      { id: 'c', type: 'category_grid', categories: ['gift_cards'] },
      { id: 'd', type: 'product_rail', source: 'manual', products: ['gift_cards:US:amazon:usd'] },
    ]);
  });

  test('removes the categories, suppliers and their columns from the schema', async () => {
    const values = (await db.query(`SELECT unnest(enum_range(NULL::"ProductCategory"))::text AS v`)).rows.map(row => row.v);
    assert.ok(!values.includes('esim') && !values.includes('virtual_numbers'), values.join());
    assert.ok(values.includes('gift_cards') && values.includes('vpn'));
    const suppliers = (await db.query('SELECT code, categories::text[] AS categories FROM suppliers')).rows;
    for (const code of ['didww', 'esim_access', 'esimerge', 'airalo', 'esim_go', 'telnyx', 'vonage', 'twilio', 'plivo']) assert.ok(!suppliers.some(row => row.code === code), code);
    assert.deepEqual(suppliers.find(row => row.code === 'africas_talking').categories, ['airtime', 'data']);
    const columns = (await db.query(`SELECT table_name || '.' || column_name AS c FROM information_schema.columns WHERE (table_name, column_name) IN (('products', 'features'), ('suppliers', 'feature_rules'))`)).rows;
    assert.deepEqual(columns, []);
  });

  test("Udozo's product seed drops the crypto rows migrations seed for Afrippa, and is safe to run again", async () => {
    const count = async table => Number((await db.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n);
    assert.ok((await count('crypto_assets')) > 0 && (await count('crypto_networks')) > 0, 'seeded by the migrations');
    await db.query(`INSERT INTO feature_switches (id, key, enabled, updated_at) VALUES ($1, 'crypto_wallets', true, now())`, [randomUUID()]);
    await db.query(`UPDATE plans SET features = array_append(features, 'onchain_crypto') WHERE code = 'premium'`);
    for (let run = 0; run < 2; run++) await seedProduct(text => db.query(text), 'udozo');
    for (const table of ['crypto_assets', 'crypto_networks', 'p2p_fee_rates', 'p2p_merchant_rules', 'afrippa_two_step_policies', 'chain_routes', 'crypto_market_limits']) assert.equal(await count(table), 0, table);
    assert.equal((await db.query(`SELECT 1 FROM feature_switches WHERE key = 'crypto_wallets'`)).rows.length, 0);
    assert.equal((await db.query(`SELECT 1 FROM plans WHERE 'onchain_crypto' = ANY(features)`)).rows.length, 0);
    assert.equal((await db.query(`SELECT name FROM resellers WHERE id = '00000000-0000-4000-8000-0000000000b1'`)).rows[0]?.name, 'Udozo', 'the rest of the seed still runs');
  });
});
