-- Afrippa's own books (docs/CRYPTO_SPINOFF_PLAN.md, step 2 item 7): every ledger account and journal entry says which
-- product's books it is in, so BitoCard's reports, overview and integrity check never include Afrippa's, and Afrippa's
-- can be produced alone. Afrippa's: every account in a coin (BitoCard keeps no crypto), P2P fiat locks, and every
-- account of an Afrippa store's customers (its traders) or of an Afrippa reseller (its operator account). An entry is
-- Afrippa's when any of its accounts is.
ALTER TABLE "ledger_accounts" ADD COLUMN "platform" "Platform" NOT NULL DEFAULT 'bitocard';
ALTER TABLE "journal_entries" ADD COLUMN "platform" "Platform" NOT NULL DEFAULT 'bitocard';

UPDATE "ledger_accounts" a SET "platform" = 'afrippa'
WHERE a."currency" IN (SELECT "code" FROM "crypto_assets")
   OR a."kind" IN ('crypto_wallet', 'crypto_locked', 'crypto_frozen', 'crypto_custody', 'crypto_fees', 'crypto_withdrawing',
                   'crypto_spin_rewards', 'crypto_promotions', 'reserve_crypto', 'reseller_crypto', 'reseller_crypto_withdrawing',
                   'p2p_fiat_locked')
   OR a."customer_id" IN (SELECT c."id" FROM "customers" c JOIN "stores" s ON s."id" = c."store_id" WHERE s."platform" = 'afrippa')
   OR a."reseller_id" IN (SELECT r."id" FROM "resellers" r WHERE r."platform" = 'afrippa');

UPDATE "journal_entries" e SET "platform" = 'afrippa'
WHERE EXISTS (
  SELECT 1 FROM "ledger_postings" p JOIN "ledger_accounts" a ON a."id" = p."account_id"
  WHERE p."entry_id" = e."id" AND a."platform" = 'afrippa'
);

CREATE INDEX "ledger_accounts_platform_mode_kind_idx" ON "ledger_accounts"("platform", "mode", "kind");
CREATE INDEX "journal_entries_platform_created_at_idx" ON "journal_entries"("platform", "created_at");
