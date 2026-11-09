-- Safe pay is UdozoPay (9 November 2026, the owner's request; docs/UDOZO_CONNECT_PLAN.md, phase 1). Only the name people
-- read changes: codes, routes and data keep `safe_pay`. Text already stored is renamed here: the categories' Safe Trade
-- Guide checks, and the home pages' saved drafts and published layouts (their trust bar and banners).
UPDATE "classified_categories"
SET "safety_checklist" = ARRAY(SELECT replace(item, 'Safe pay', 'UdozoPay') FROM unnest("safety_checklist") WITH ORDINALITY AS t(item, n) ORDER BY n),
    "updated_at" = CURRENT_TIMESTAMP
WHERE array_to_string("safety_checklist", '|') LIKE '%Safe pay%';

UPDATE "storefront_pages"
SET "draft" = replace("draft"::text, 'Safe pay', 'UdozoPay')::jsonb,
    "published" = CASE WHEN "published" IS NULL THEN NULL ELSE replace("published"::text, 'Safe pay', 'UdozoPay')::jsonb END
WHERE "draft"::text LIKE '%Safe pay%' OR "published"::text LIKE '%Safe pay%';
