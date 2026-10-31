// Data one product's database needs that the other's does not (docs/UDOZO_SPINOFF_PLAN.md, step 1). Every migration
// runs on both databases (BitoCard's and Udozo's), and migrations seed BitoCard's own rows; this turns a database into
// the product's own after them. Run by `migrate-deploy.mjs` after `prisma migrate deploy`, with APP_PRODUCT. Every
// statement is safe to run again.

/** The statements that make a freshly migrated database the product's. BitoCard's needs none. */
export const productSeeds = {
  bitocard: [],
  udozo: [
    // The house accounts and bitocard.com's own store become Udozo's: its marketplace, whose customers are Udozo's
    // accounts (shared by every Udozo store, step 3).
    { name: 'house accounts named Udozo', sql: `UPDATE "resellers" SET "name" = 'Udozo' WHERE "house" = true AND "name" = 'BitoCard'` },
    { name: 'the marketplace store named Udozo', sql: `UPDATE "stores" SET "name" = 'Udozo' WHERE "id" = '00000000-0000-4000-8000-0000000000b2' AND "name" = 'BitoCard'` },
    // BitoCard's country stores (ng.bitocard.com…) have no place in Udozo.
    {
      name: 'country stores unpublished',
      sql: `UPDATE "stores" SET "status" = 'draft', "published_at" = NULL WHERE "status" = 'published' AND "id" <> '00000000-0000-4000-8000-0000000000b2' AND "reseller_id" IN (SELECT "id" FROM "resellers" WHERE "house" = true AND "country" IS NOT NULL)`,
    },
    // Udozo's plans are Startup and Premium.
    { name: 'Enterprise hidden', sql: `UPDATE "plans" SET "available" = false WHERE "code" = 'enterprise' AND "available" = true` },
    // Premium includes one free domain per store (paid for by the setup fee and its first month); admins change it.
    // Udozo's starting prices (the owner, 30 October 2026): the Seller HQ setup fee US$10 for every market, and Premium
    // US$5 a month. Set once, with the fee's first row, so admins' later changes are never put back.
    {
      name: 'starting prices',
      sql: `WITH fee AS (INSERT INTO "setup_fees" ("country", "enabled", "amount_minor", "updated_at") VALUES ('WW', true, 1000, CURRENT_TIMESTAMP) ON CONFLICT ("country") DO NOTHING RETURNING 1)
            UPDATE "plans" SET "price_cents" = 500 WHERE "code" = 'premium' AND EXISTS (SELECT 1 FROM fee)`,
    },
    { name: 'Premium with a free domain', sql: `UPDATE "plans" SET "limits" = "limits" || '{"free_domains": 1}'::jsonb WHERE "code" = 'premium' AND NOT ("limits" ? 'free_domains')` },
  ],
};

/** Runs the product's statements with `query(sql)` (a pg client's, or PGlite's in tests). Returns what each changed. */
export async function seedProduct(query, product) {
  const seeds = productSeeds[product];
  if (!seeds) throw new Error(`Unknown APP_PRODUCT "${product}"`);
  const done = [];
  for (const seed of seeds) {
    const result = await query(seed.sql);
    done.push({ name: seed.name, rows: result.rowCount ?? result.affectedRows ?? 0 });
  }
  return done;
}
