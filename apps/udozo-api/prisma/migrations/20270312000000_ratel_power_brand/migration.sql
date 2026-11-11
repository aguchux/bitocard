-- Ratel Power (11 November 2026, the owner's request): Ratel Power Station of Abuja, Nigeria (ratelpower.com.ng; its
-- flagship store at Plot 750, Mohammadu Buhari Way, Central Area), which sells LiFePO4 portable power stations, a solar
-- panel, car inverter sockets, rechargeable lights, creator gear, rechargeable fans, a cooler and charging accessories.
-- Its mark is bundled with udozo.com (apps/udozo/public/brand-logos/ratel-power.svg: the brand's own logo, white with its
-- green, on a dark tile so it shows on white), its green #38C810. Its models are every product its shop lists (18), each
-- in the category it is sold in, with the brand linked to each of those categories (last in each).
INSERT INTO "classified_brands" ("id", "slug", "name", "name_key", "aliases", "match_keys", "logo_file", "color", "updated_at") VALUES
  (gen_random_uuid(), 'ratel-power', 'Ratel Power', 'ratelpower', ARRAY['ratel', 'ratel power station', 'ratelpower']::TEXT[], ARRAY['ratelpower', 'ratel', 'ratelpowerstation']::TEXT[], 'ratel-power', '#38C810', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "classified_brand_categories" ("brand_id", "category_id", "position")
SELECT b."id", c."id", COALESCE((SELECT MAX(bc."position") + 1 FROM "classified_brand_categories" bc WHERE bc."category_id" = c."id"), 0)
FROM "classified_brands" b
JOIN "classified_categories" c ON c."slug" IN ('generators-solar', 'vehicle-parts', 'home-accessories', 'cameras', 'home-appliances', 'phone-accessories')
WHERE b."name_key" = 'ratelpower'
ON CONFLICT DO NOTHING;

INSERT INTO "classified_brand_models" ("id", "brand_id", "category_id", "name", "name_key", "aliases", "match_keys", "position", "updated_at")
SELECT gen_random_uuid(), b."id", c."id", v."name", v."name_key", v."aliases", v."match_keys", v."position", CURRENT_TIMESTAMP FROM (VALUES
  ('RP300 power station', 'rp300powerstation', ARRAY['rp300', 'rp 300']::TEXT[], ARRAY['rp300powerstation', 'rp300']::TEXT[], 0),
  ('RP600 power station', 'rp600powerstation', ARRAY['rp600', 'rp 600']::TEXT[], ARRAY['rp600powerstation', 'rp600']::TEXT[], 1),
  ('RP1200 power station', 'rp1200powerstation', ARRAY['rp1200', 'rp 1200']::TEXT[], ARRAY['rp1200powerstation', 'rp1200']::TEXT[], 2),
  ('RP2400 power station', 'rp2400powerstation', ARRAY['rp2400', 'rp 2400']::TEXT[], ARRAY['rp2400powerstation', 'rp2400']::TEXT[], 3),
  ('RP3600 power station', 'rp3600powerstation', ARRAY['rp3600', 'rp 3600']::TEXT[], ARRAY['rp3600powerstation', 'rp3600']::TEXT[], 4),
  ('RP5000 power station', 'rp5000powerstation', ARRAY['rp5000', 'rp 5000']::TEXT[], ARRAY['rp5000powerstation', 'rp5000']::TEXT[], 5),
  ('Base external solar panel', 'baseexternalsolarpanel', ARRAY['base solar panel', 'external solar panel']::TEXT[], ARRAY['baseexternalsolarpanel', 'basesolarpanel', 'externalsolarpanel']::TEXT[], 6)
) AS v("name", "name_key", "aliases", "match_keys", "position")
JOIN "classified_brands" b ON b."name_key" = 'ratelpower'
JOIN "classified_categories" c ON c."slug" = 'generators-solar'
ON CONFLICT DO NOTHING;

INSERT INTO "classified_brand_models" ("id", "brand_id", "category_id", "name", "name_key", "aliases", "match_keys", "position", "updated_at")
SELECT gen_random_uuid(), b."id", c."id", v."name", v."name_key", v."aliases", v."match_keys", v."position", CURRENT_TIMESTAMP FROM (VALUES
  ('Power inverter socket RPi 250', 'powerinvertersocketrpi250', ARRAY['rpi 250', 'rpi250', 'inverter socket 250']::TEXT[], ARRAY['powerinvertersocketrpi250', 'rpi250', 'invertersocket250']::TEXT[], 0),
  ('Power inverter socket RPi 500', 'powerinvertersocketrpi500', ARRAY['rpi 500', 'rpi500', 'inverter socket 500']::TEXT[], ARRAY['powerinvertersocketrpi500', 'rpi500', 'invertersocket500']::TEXT[], 1)
) AS v("name", "name_key", "aliases", "match_keys", "position")
JOIN "classified_brands" b ON b."name_key" = 'ratelpower'
JOIN "classified_categories" c ON c."slug" = 'vehicle-parts'
ON CONFLICT DO NOTHING;

INSERT INTO "classified_brand_models" ("id", "brand_id", "category_id", "name", "name_key", "aliases", "match_keys", "position", "updated_at")
SELECT gen_random_uuid(), b."id", c."id", v."name", v."name_key", v."aliases", v."match_keys", v."position", CURRENT_TIMESTAMP FROM (VALUES
  ('Smart sensor lights (5-pack)', 'smartsensorlights5pack', ARRAY['smart sensor light', 'sensor lights']::TEXT[], ARRAY['smartsensorlights5pack', 'smartsensorlight', 'sensorlights']::TEXT[], 0),
  ('Movable hanging light', 'movablehanginglight', ARRAY['hanging light']::TEXT[], ARRAY['movablehanginglight', 'hanginglight']::TEXT[], 1),
  ('Movable hanging light 4W', 'movablehanginglight4w', ARRAY['hanging light 4w']::TEXT[], ARRAY['movablehanginglight4w', 'hanginglight4w']::TEXT[], 2)
) AS v("name", "name_key", "aliases", "match_keys", "position")
JOIN "classified_brands" b ON b."name_key" = 'ratelpower'
JOIN "classified_categories" c ON c."slug" = 'home-accessories'
ON CONFLICT DO NOTHING;

INSERT INTO "classified_brand_models" ("id", "brand_id", "category_id", "name", "name_key", "aliases", "match_keys", "position", "updated_at")
SELECT gen_random_uuid(), b."id", c."id", v."name", v."name_key", v."aliases", v."match_keys", v."position", CURRENT_TIMESTAMP FROM (VALUES
  ('Tripod stand', 'tripodstand', ARRAY['ratel tripod']::TEXT[], ARRAY['tripodstand', 'rateltripod']::TEXT[], 0),
  ('Streaming fan light', 'streamingfanlight', ARRAY['fan light']::TEXT[], ARRAY['streamingfanlight', 'fanlight']::TEXT[], 1)
) AS v("name", "name_key", "aliases", "match_keys", "position")
JOIN "classified_brands" b ON b."name_key" = 'ratelpower'
JOIN "classified_categories" c ON c."slug" = 'cameras'
ON CONFLICT DO NOTHING;

INSERT INTO "classified_brand_models" ("id", "brand_id", "category_id", "name", "name_key", "aliases", "match_keys", "position", "updated_at")
SELECT gen_random_uuid(), b."id", c."id", v."name", v."name_key", v."aliases", v."match_keys", v."position", CURRENT_TIMESTAMP FROM (VALUES
  ('Long-life rechargeable student fan', 'longliferechargeablestudentfan', ARRAY['student fan', 'rechargeable student fan']::TEXT[], ARRAY['longliferechargeablestudentfan', 'studentfan', 'rechargeablestudentfan']::TEXT[], 0),
  ('Premium Bluetooth smart fan', 'premiumbluetoothsmartfan', ARRAY['bluetooth smart fan', 'bluetooth fan']::TEXT[], ARRAY['premiumbluetoothsmartfan', 'bluetoothsmartfan', 'bluetoothfan']::TEXT[], 1),
  ('Portable Ficari smart cooler', 'portableficarismartcooler', ARRAY['ficari', 'ficari cooler', 'ficari smart cooler']::TEXT[], ARRAY['portableficarismartcooler', 'ficari', 'ficaricooler', 'ficarismartcooler']::TEXT[], 2)
) AS v("name", "name_key", "aliases", "match_keys", "position")
JOIN "classified_brands" b ON b."name_key" = 'ratelpower'
JOIN "classified_categories" c ON c."slug" = 'home-appliances'
ON CONFLICT DO NOTHING;

INSERT INTO "classified_brand_models" ("id", "brand_id", "category_id", "name", "name_key", "aliases", "match_keys", "position", "updated_at")
SELECT gen_random_uuid(), b."id", c."id", v."name", v."name_key", v."aliases", v."match_keys", v."position", CURRENT_TIMESTAMP FROM (VALUES
  ('High-speed charging accessories', 'highspeedchargingaccessories', ARRAY['charging accessories']::TEXT[], ARRAY['highspeedchargingaccessories', 'chargingaccessories']::TEXT[], 0)
) AS v("name", "name_key", "aliases", "match_keys", "position")
JOIN "classified_brands" b ON b."name_key" = 'ratelpower'
JOIN "classified_categories" c ON c."slug" = 'phone-accessories'
ON CONFLICT DO NOTHING;
