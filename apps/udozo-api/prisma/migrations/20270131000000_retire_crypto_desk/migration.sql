-- Crypto has left BitoCard (docs/CRYPTO_SPINOFF_PLAN.md): the retired crypto desk store template, its home page
-- sections (`crypto_quote`, `p2p_market`) and its switch go now that Afrippa's escrow market has replaced them.

-- A store still on the crypto desk becomes an All-in-one store, on its starting page.
UPDATE "stores"
SET "template" = 'all_in_one', "variant" = 'classic', "theme" = 'navy_pink', "home_draft" = NULL, "home_published" = NULL, "home_published_at" = NULL
WHERE "template" = 'crypto_desk';

-- Any other page holding those sections goes back to its starting page (none should: only the desk offered them).
UPDATE "stores" SET "home_draft" = NULL
WHERE "home_draft" IS NOT NULL AND jsonb_path_exists("home_draft"::jsonb, '$[*] ? (@.type == "crypto_quote" || @.type == "p2p_market")');
UPDATE "stores" SET "home_published" = NULL, "home_published_at" = NULL
WHERE "home_published" IS NOT NULL AND jsonb_path_exists("home_published"::jsonb, '$[*] ? (@.type == "crypto_quote" || @.type == "p2p_market")');

-- Published versions that can no longer be restored.
DELETE FROM "store_home_versions"
WHERE "template" = 'crypto_desk' OR jsonb_path_exists("sections"::jsonb, '$[*] ? (@.type == "crypto_quote" || @.type == "p2p_market")');

DELETE FROM "feature_switches" WHERE "key" = 'store_template_crypto_desk';
