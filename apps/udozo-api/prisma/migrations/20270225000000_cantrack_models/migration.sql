-- The rest of Cantrack's models (6 November 2026, the owner's request), from every product page of its site
-- (cantrackgps.com, all its categories and their pages): the asset and OBD trackers the first list lacked. Left out:
-- variants already listed (G900LM's iButton and anti-jammer versions, G900LS's 8-line and J16), bare circuit boards
-- (PCBA) sold to makers, a 4G OBD2 tracker with no model name, and the tracking software. After its 30 models.
INSERT INTO "classified_brand_models" ("id", "brand_id", "category_id", "name", "name_key", "aliases", "match_keys", "position", "updated_at")
SELECT gen_random_uuid(), b."id", c."id", v."name", v."name_key", v."aliases", v."match_keys", v."position", CURRENT_TIMESTAMP FROM (VALUES
  ('G200L magnetic tracker', 'g200lmagnetictracker', ARRAY['g200l', 'g200']::TEXT[], ARRAY['g200lmagnetictracker', 'g200l', 'g200']::TEXT[], 30),
  ('GF20 mini magnetic tracker', 'gf20minimagnetictracker', ARRAY['gf20']::TEXT[], ARRAY['gf20minimagnetictracker', 'gf20']::TEXT[], 31),
  ('GF30 magnetic tracker', 'gf30magnetictracker', ARRAY['gf30']::TEXT[], ARRAY['gf30magnetictracker', 'gf30']::TEXT[], 32),
  ('TK200AM disposable tracker', 'tk200amdisposabletracker', ARRAY['tk200am']::TEXT[], ARRAY['tk200amdisposabletracker', 'tk200am']::TEXT[], 33),
  ('G03', 'g03', ARRAY[]::TEXT[], ARRAY['g03']::TEXT[], 34),
  ('G500L OBD tracker', 'g500lobdtracker', ARRAY['g500l']::TEXT[], ARRAY['g500lobdtracker', 'g500l']::TEXT[], 35),
  ('G500M mini tracker', 'g500mminitracker', ARRAY['g500m']::TEXT[], ARRAY['g500mminitracker', 'g500m']::TEXT[], 36),
  ('G183 OBD tracker', 'g183obdtracker', ARRAY['g183', 'jobd']::TEXT[], ARRAY['g183obdtracker', 'g183', 'jobd']::TEXT[], 37)
) AS v("name", "name_key", "aliases", "match_keys", "position")
JOIN "classified_brands" b ON b."name_key" = 'cantrack'
JOIN "classified_categories" c ON c."slug" = 'gps-trackers'
ON CONFLICT DO NOTHING;
