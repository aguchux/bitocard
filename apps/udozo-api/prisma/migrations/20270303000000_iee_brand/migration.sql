-- IEE (7 November 2026, the owner's request): Initial Entropy Energy (Zhuhai Initial Entropy Energy Co., Ltd., China,
-- with IEETek GmbH in Hamburg; ieetek.com), which sells as IEETek: LiFePO4 portable power stations, a portable
-- all-in-one energy storage system and foldable solar panels. Its mark is bundled with udozo.com
-- (apps/udozo/public/brand-logos/iee.svg, the IEE glyph from the brand's own logo; its navy #384254), and its models as
-- its site lists them, every product page read: the P, Singo, SE, SH and split-phase SP power stations, the SH4000
-- ESS, the SP solar panels, plus Singo600 and the P2000 expansion battery, which its pages name without a page of their
-- own. Its homepage also names hybrid, micro, off-grid and string inverters and home batteries, with no model pages
-- (left out). In Generators and solar, after its other brands.
INSERT INTO "classified_brands" ("id", "slug", "name", "name_key", "aliases", "match_keys", "logo_file", "color", "updated_at") VALUES
  (gen_random_uuid(), 'iee', 'IEE', 'iee', ARRAY['ieetek', 'iee tek', 'initial entropy energy', 'initial entropy', 'zhuhai initial entropy energy']::TEXT[], ARRAY['iee', 'ieetek', 'initialentropyenergy', 'initialentropy', 'zhuhaiinitialentropyenergy']::TEXT[], 'iee', '#384254', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "classified_brand_categories" ("brand_id", "category_id", "position")
SELECT b."id", c."id", COALESCE((SELECT MAX(bc."position") + 1 FROM "classified_brand_categories" bc WHERE bc."category_id" = c."id"), 0)
FROM "classified_brands" b
JOIN "classified_categories" c ON c."slug" = 'generators-solar'
WHERE b."name_key" = 'iee'
ON CONFLICT DO NOTHING;

INSERT INTO "classified_brand_models" ("id", "brand_id", "category_id", "name", "name_key", "aliases", "match_keys", "position", "updated_at")
SELECT gen_random_uuid(), b."id", c."id", v."name", v."name_key", v."aliases", v."match_keys", v."position", CURRENT_TIMESTAMP FROM (VALUES
  ('P800 power station', 'p800powerstation', ARRAY['p800']::TEXT[], ARRAY['p800powerstation', 'p800']::TEXT[], 0),
  ('P1800 power station', 'p1800powerstation', ARRAY['p1800']::TEXT[], ARRAY['p1800powerstation', 'p1800']::TEXT[], 1),
  ('P2400 power station', 'p2400powerstation', ARRAY['p2400']::TEXT[], ARRAY['p2400powerstation', 'p2400']::TEXT[], 2),
  ('P3200 power station', 'p3200powerstation', ARRAY['p3200']::TEXT[], ARRAY['p3200powerstation', 'p3200']::TEXT[], 3),
  ('Singo1000 power station', 'singo1000powerstation', ARRAY['singo1000', 'singo 1000']::TEXT[], ARRAY['singo1000powerstation', 'singo1000']::TEXT[], 4),
  ('Singo2000 Pro power station', 'singo2000propowerstation', ARRAY['singo2000 pro', 'singo 2000 pro']::TEXT[], ARRAY['singo2000propowerstation', 'singo2000pro']::TEXT[], 5),
  ('Singo2000 Plus power station', 'singo2000pluspowerstation', ARRAY['singo2000 plus', 'singo 2000 plus']::TEXT[], ARRAY['singo2000pluspowerstation', 'singo2000plus']::TEXT[], 6),
  ('Singo3000 power station', 'singo3000powerstation', ARRAY['singo3000', 'singo 3000']::TEXT[], ARRAY['singo3000powerstation', 'singo3000']::TEXT[], 7),
  ('SE5000 power station', 'se5000powerstation', ARRAY['se5000']::TEXT[], ARRAY['se5000powerstation', 'se5000']::TEXT[], 8),
  ('SE6000 power station', 'se6000powerstation', ARRAY['se6000', 'se6000d']::TEXT[], ARRAY['se6000powerstation', 'se6000', 'se6000d']::TEXT[], 9),
  ('SH4000 all-in-one ESS', 'sh4000allinoneess', ARRAY['sh4000', 'sh4000 power station']::TEXT[], ARRAY['sh4000allinoneess', 'sh4000', 'sh4000powerstation']::TEXT[], 10),
  ('SP3600 split-phase power station', 'sp3600splitphasepowerstation', ARRAY['sp3600']::TEXT[], ARRAY['sp3600splitphasepowerstation', 'sp3600']::TEXT[], 11),
  ('SP5000 split-phase power station', 'sp5000splitphasepowerstation', ARRAY['sp5000']::TEXT[], ARRAY['sp5000splitphasepowerstation', 'sp5000']::TEXT[], 12),
  ('SP6000 split-phase power station', 'sp6000splitphasepowerstation', ARRAY['sp6000', 'sp6000d']::TEXT[], ARRAY['sp6000splitphasepowerstation', 'sp6000', 'sp6000d']::TEXT[], 13),
  ('SP100 solar panel', 'sp100solarpanel', ARRAY['sp100']::TEXT[], ARRAY['sp100solarpanel', 'sp100']::TEXT[], 14),
  ('SP200 solar panel', 'sp200solarpanel', ARRAY['sp200']::TEXT[], ARRAY['sp200solarpanel', 'sp200']::TEXT[], 15),
  ('SP400 solar panel', 'sp400solarpanel', ARRAY['sp400']::TEXT[], ARRAY['sp400solarpanel', 'sp400']::TEXT[], 16),
  ('Singo600 power station', 'singo600powerstation', ARRAY['singo600', 'singo 600']::TEXT[], ARRAY['singo600powerstation', 'singo600']::TEXT[], 17),
  ('P2000 expansion battery', 'p2000expansionbattery', ARRAY['p2000']::TEXT[], ARRAY['p2000expansionbattery', 'p2000']::TEXT[], 18)
) AS v("name", "name_key", "aliases", "match_keys", "position")
JOIN "classified_brands" b ON b."name_key" = 'iee'
JOIN "classified_categories" c ON c."slug" = 'generators-solar'
ON CONFLICT DO NOTHING;
