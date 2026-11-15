-- Country stores are retired (docs/BITOCARD_MULTI_WALLETS_PLAN.md): bitocard.com is the one store. Each market's house
-- account stays (it is still the seller of record there); its `<cc>.bitocard.com` store is unpublished, kept for the
-- orders, quotes and chats that point at it, and its address is taken down by the `domains` job (`retiring`).
UPDATE "stores" s
SET "status" = 'draft',
    "host_status" = CASE WHEN s."host_name" IS NOT NULL OR s."host_record_id" IS NOT NULL THEN 'retiring' ELSE 'retired' END,
    "updated_at" = CURRENT_TIMESTAMP
FROM "resellers" r
WHERE s."reseller_id" = r."id"
  AND r."house" = true
  AND s."platform" = 'bitocard'
  AND s."id" <> '00000000-0000-4000-8000-0000000000b2';

DELETE FROM "feature_switches" WHERE "key" = 'country_stores';
