-- VTpass also sells Nigerian airtime and data (synced once the commissions agreed with VTpass are set). Its markets
-- for them stay switched off until an admin switches them on.
UPDATE "suppliers"
SET "categories" = ARRAY(SELECT DISTINCT unnest("categories" || ARRAY['airtime', 'data']::"ProductCategory"[]))
WHERE "code" = 'vtpass';
