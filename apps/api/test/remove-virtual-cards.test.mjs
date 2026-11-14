// Virtual cards removed for good (migration 20270202100000_remove_virtual_cards): the category, its suppliers, settings, catalogue and home page
// mentions go, the category leaves the enum, and everything else is left as it was. A virtual card order, quote or fee
// stops the migration instead of deleting money records. Run on its own PGlite with every migration before it.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readdirSync, readFileSync } from 'node:fs';

const target = '20270202100000_remove_virtual_cards';
const dir = new URL('../prisma/migrations/', import.meta.url);
const names = readdirSync(dir).filter(entry => /^\d+_/.test(entry)).sort();
const sql = name => readFileSync(new URL(`${name}/migration.sql`, dir), 'utf8');

async function before() {
  const db = new PGlite({ extensions: { pg_trgm } });
  for (const name of names.slice(0, names.indexOf(target))) await db.exec(sql(name));
  return db;
}

async function product(db, category, key) {
  const id = randomUUID();
  await db.query(`INSERT INTO products (id, key, category, country, brand, name, face_currency, denomination_type, updated_at) VALUES ($1, $2, $3, 'NG', 'brand', $2, 'NGN', 'fixed', now())`, [id, key, category]);
  return id;
}

describe('removing virtual cards', () => {
  test('takes the category, its suppliers, settings and home page mentions out, and nothing else', async () => {
    const db = await before();
    await product(db, 'virtual_cards', 'virtual_cards:NG:brand:usd');
    const kept = await product(db, 'airtime', 'airtime:NG:mtn:topup');
    await db.query(`INSERT INTO integration_settings (platform, key, value, encrypted, updated_at) VALUES ('bitocard', 'MAPLERAD_SECRET_KEY', 'x', false, now()), ('bitocard', 'RELOADLY_CLIENT_ID', 'y', false, now())`);
    const sections = [
      { id: 'h', type: 'hero', title: 'Hello' },
      { id: 'p', type: 'promo', title: 'Cards', cta: { label: 'Get a card', href: '/catalogs/virtual-cards' } },
      { id: 'r', type: 'product_rail', title: 'Cards', source: 'category', category: 'virtual_cards' },
      { id: 'g', type: 'category_grid', title: 'Shop', categories: ['airtime', 'virtual_cards'] },
    ];
    await db.query(`INSERT INTO storefront_pages (key, draft, published, updated_at) VALUES ('home-test', $1, $1, now())`, [JSON.stringify(sections)]);

    await db.exec(sql(target));

    const one = async (q, p) => (await db.query(q, p)).rows;
    assert.deepEqual((await one(`SELECT key FROM products ORDER BY key`)).map(r => r.key), ['airtime:NG:mtn:topup']);
    assert.ok((await one(`SELECT 1 FROM products WHERE id = $1`, [kept])).length);
    assert.deepEqual(await one(`SELECT code FROM suppliers WHERE code IN ('flutterwave_cards', 'maplerad', 'onafriq')`), []);
    assert.deepEqual(await one(`SELECT 1 FROM country_categories WHERE category::text = 'virtual_cards'`), []);
    assert.deepEqual((await one(`SELECT key FROM integration_settings ORDER BY key`)).map(r => r.key), ['RELOADLY_CLIENT_ID']);
    const labels = (await one(`SELECT unnest(enum_range(NULL::"ProductCategory"))::text AS c`)).map(r => r.c);
    assert.ok(!labels.includes('virtual_cards') && labels.includes('mobile_money') && labels.includes('rdp'));
    assert.ok((await one(`SELECT 1 FROM country_categories WHERE category = 'airtime'`)).length, 'other categories keep their markets');
    const page = (await one(`SELECT published FROM storefront_pages WHERE key = 'home-test'`))[0].published;
    assert.deepEqual(page, [
      { id: 'h', type: 'hero', title: 'Hello' },
      { id: 'r', type: 'product_rail', title: 'Cards', source: 'new' },
      { id: 'g', type: 'category_grid', title: 'Shop', categories: ['airtime'] },
    ]);
    await db.close();
  });

  test('stops rather than delete a virtual card fee', async () => {
    const db = await before();
    const reseller = randomUUID();
    await db.query(`INSERT INTO resellers (id, name, updated_at) VALUES ($1, 'Ada Digital', now())`, [reseller]);
    await db.query(
      `INSERT INTO fee_charges (id, reseller_id, mode, currency, kind, source_type, source_id, reference, category, rate_ppb, base_minor, exact_nano, held_minor)
       VALUES ($1, $2, 'live', 'NGN', 'supplier_order', 'order', 'o1', 'fee:o1', 'virtual_cards', 0, 0, 0, 0)`,
      [randomUUID(), reseller],
    );
    await assert.rejects(db.exec(sql(target)), /Virtual card orders, quotes or fees exist/);
    assert.ok((await db.query(`SELECT 1 FROM fee_charges WHERE reference = 'fee:o1'`)).rows.length, 'nothing changed');
    await db.close();
  });
});
