-- Udozo's own category tree: its own order and words (plain names only where nothing else fits: Electronics, Fashion,
-- Property), and categories that are not Udozo's dropped: jobs and CVs, regulated or risky trade (software licences,
-- supplements, reptiles, medical and safety equipment, legal and travel services) and thin ones. Slugs never change.

-- Top categories.
UPDATE "classified_categories" AS c SET "name" = v."name", "icon" = v."icon", "position" = v."position", "updated_at" = CURRENT_TIMESTAMP FROM (VALUES
  ('phones-tablets', 'Phones and tablets', 'smartphone', 0),
  ('electronics', 'Electronics', 'monitor-smartphone', 1),
  ('vehicles', 'Vehicles', 'car', 2),
  ('property', 'Property', 'house', 3),
  ('home-garden', 'Home and living', 'sofa', 4),
  ('fashion', 'Fashion', 'shirt', 5),
  ('health-beauty', 'Beauty and personal care', 'sparkles', 6),
  ('babies-kids', 'Kids and baby', 'baby', 7),
  ('sports-leisure', 'Sports and hobbies', 'volleyball', 8),
  ('animals-pets', 'Pets', 'paw-print', 9),
  ('agriculture-food', 'Farm and food', 'wheat', 10),
  ('repair-construction', 'Building and tools', 'hammer', 11),
  ('business-industrial', 'Wholesale and business', 'package', 12),
  ('services', 'Services', 'hand-helping', 13)
) AS v("slug", "name", "icon", "position") WHERE c."slug" = v."slug" AND c."parent_id" IS NULL;

-- Livestock moves to Farm and food, keeping the animal checks it had from Pets.
UPDATE "classified_categories" AS c SET "safety_checklist" = p."safety_checklist" FROM "classified_categories" p
WHERE c."slug" = 'livestock-poultry' AND p."slug" = 'animals-pets' AND cardinality(c."safety_checklist") = 0;

-- Subcategories: names, icons, order and parent.
UPDATE "classified_categories" AS c SET "parent_id" = p."id", "name" = v."name", "icon" = v."icon", "position" = v."position", "updated_at" = CURRENT_TIMESTAMP FROM (VALUES
  ('mobile-phones', 'Mobile phones', 'smartphone', 0, 'phones-tablets'),
  ('tablets', 'Tablets', 'tablet', 1, 'phones-tablets'),
  ('smart-watches', 'Smartwatches and fitness bands', 'watch', 2, 'phones-tablets'),
  ('phone-accessories', 'Chargers, cases and accessories', 'cable', 3, 'phones-tablets'),
  ('laptops', 'Laptops', 'laptop', 0, 'electronics'),
  ('desktops', 'Desktops and monitors', 'monitor', 1, 'electronics'),
  ('computer-accessories', 'Computer parts and accessories', 'mouse', 2, 'electronics'),
  ('printers', 'Printers and scanners', 'printer', 3, 'electronics'),
  ('tvs', 'TVs and home cinema', 'tv', 4, 'electronics'),
  ('audio', 'Speakers and sound systems', 'speaker', 5, 'electronics'),
  ('headphones', 'Headphones and earbuds', 'headphones', 6, 'electronics'),
  ('cameras', 'Cameras and drones', 'camera', 7, 'electronics'),
  ('video-games', 'Gaming', 'gamepad-2', 8, 'electronics'),
  ('security-surveillance', 'CCTV and smart home', 'cctv', 9, 'electronics'),
  ('networking', 'Routers and networking', 'router', 10, 'electronics'),
  ('cars', 'Cars', 'car', 0, 'vehicles'),
  ('motorcycles', 'Motorbikes, scooters and kekes', 'motorbike', 1, 'vehicles'),
  ('buses', 'Buses and vans', 'bus', 2, 'vehicles'),
  ('trucks-buses', 'Trucks and trailers', 'truck', 3, 'vehicles'),
  ('heavy-equipment', 'Plant and heavy machinery', 'forklift', 4, 'vehicles'),
  ('vehicle-parts', 'Parts and accessories', 'cog', 5, 'vehicles'),
  ('houses-for-rent', 'Homes to rent', 'key-round', 0, 'property'),
  ('houses-for-sale', 'Homes for sale', 'house', 1, 'property'),
  ('short-let', 'Short lets', 'bed-double', 2, 'property'),
  ('land', 'Land for sale', 'land-plot', 3, 'property'),
  ('commercial-property', 'Shops and offices', 'building-2', 4, 'property'),
  ('event-venues', 'Halls and venues', 'party-popper', 5, 'property'),
  ('furniture', 'Furniture', 'armchair', 0, 'home-garden'),
  ('home-appliances', 'Fridges, freezers and washing machines', 'refrigerator', 1, 'home-garden'),
  ('kitchen-appliances', 'Small kitchen appliances', 'microwave', 2, 'home-garden'),
  ('kitchen', 'Cookware and tableware', 'utensils-crossed', 3, 'home-garden'),
  ('home-accessories', 'Decor and lighting', 'lamp', 4, 'home-garden'),
  ('household-supplies', 'Cleaning and household', 'spray-can', 5, 'home-garden'),
  ('generators-solar', 'Generators, inverters and solar', 'sun', 6, 'home-garden'),
  ('garden', 'Garden and outdoor', 'shovel', 7, 'home-garden'),
  ('clothing', 'Clothing', 'shirt', 0, 'fashion'),
  ('wedding-wear', 'Traditional and occasion wear', 'heart', 1, 'fashion'),
  ('shoes', 'Shoes', 'footprints', 2, 'fashion'),
  ('bags', 'Bags', 'shopping-bag', 3, 'fashion'),
  ('jewellery-watches', 'Jewellery and watches', 'gem', 4, 'fashion'),
  ('clothing-accessories', 'Belts, hats and sunglasses', 'glasses', 5, 'fashion'),
  ('skin-care', 'Skin and body care', 'droplets', 0, 'health-beauty'),
  ('hair-beauty', 'Hair, wigs and extensions', 'scissors', 1, 'health-beauty'),
  ('makeup', 'Make-up', 'brush', 2, 'health-beauty'),
  ('fragrances', 'Perfume', 'flower', 3, 'health-beauty'),
  ('health-equipment', 'Health and mobility aids', 'stethoscope', 4, 'health-beauty'),
  ('baby-gear', 'Prams, car seats and baby gear', 'baby', 0, 'babies-kids'),
  ('baby-care', 'Feeding and nappies', 'milk', 1, 'babies-kids'),
  ('kids-clothing', 'Children''s clothes and shoes', 'shirt', 2, 'babies-kids'),
  ('kids-furniture', 'Cots and nursery furniture', 'bed-single', 3, 'babies-kids'),
  ('toys', 'Toys and games', 'blocks', 4, 'babies-kids'),
  ('fitness', 'Gym and fitness', 'dumbbell', 0, 'sports-leisure'),
  ('sports-equipment', 'Football and sports gear', 'volleyball', 1, 'sports-leisure'),
  ('bicycles', 'Bicycles', 'bike', 2, 'sports-leisure'),
  ('musical-instruments', 'Musical instruments', 'guitar', 3, 'sports-leisure'),
  ('books', 'Books', 'book-open', 4, 'sports-leisure'),
  ('arts-crafts', 'Art and craft supplies', 'palette', 5, 'sports-leisure'),
  ('dogs', 'Dogs', 'dog', 0, 'animals-pets'),
  ('cats', 'Cats', 'cat', 1, 'animals-pets'),
  ('birds', 'Birds', 'bird', 2, 'animals-pets'),
  ('fish', 'Fish and aquariums', 'fish', 3, 'animals-pets'),
  ('pet-accessories', 'Pet food and supplies', 'bone', 4, 'animals-pets'),
  ('farm-produce', 'Fresh produce', 'apple', 0, 'agriculture-food'),
  ('food-drinks', 'Food and drinks', 'utensils', 1, 'agriculture-food'),
  ('livestock-poultry', 'Livestock and poultry', 'egg', 2, 'agriculture-food'),
  ('feeds-seeds', 'Seeds, feed and fertiliser', 'sprout', 3, 'agriculture-food'),
  ('farm-machinery', 'Farm machinery and tools', 'tractor', 4, 'agriculture-food'),
  ('building-materials', 'Building materials', 'brick-wall', 0, 'repair-construction'),
  ('tools', 'Power and hand tools', 'drill', 1, 'repair-construction'),
  ('plumbing-electrical', 'Plumbing and electrical', 'plug-zap', 2, 'repair-construction'),
  ('doors-windows', 'Doors, windows and fittings', 'door-open', 3, 'repair-construction'),
  ('wholesale', 'Wholesale stock', 'package', 0, 'business-industrial'),
  ('industrial-machinery', 'Industrial machinery', 'factory', 1, 'business-industrial'),
  ('office-equipment', 'Office furniture and equipment', 'paperclip', 2, 'business-industrial'),
  ('restaurant-equipment', 'Catering and restaurant equipment', 'chef-hat', 3, 'business-industrial'),
  ('retail-equipment', 'Shop fittings and tills', 'scan-barcode', 4, 'business-industrial'),
  ('salon-equipment', 'Salon and barbing equipment', 'scissors', 5, 'business-industrial'),
  ('repair-services', 'Repairs and maintenance', 'wrench', 0, 'services'),
  ('cleaning', 'Cleaning', 'brush-cleaning', 1, 'services'),
  ('events', 'Events, catering and DJs', 'party-popper', 2, 'services'),
  ('beauty-services', 'Hair, beauty and make-up artists', 'sparkles', 3, 'services'),
  ('lessons', 'Lessons and tutoring', 'graduation-cap', 4, 'services'),
  ('it-services', 'Tech and web services', 'monitor-cog', 5, 'services'),
  ('photography-video', 'Photography and video', 'camera', 6, 'services'),
  ('logistics', 'Delivery and moving', 'truck', 7, 'services'),
  ('car-services', 'Car hire and drivers', 'car-front', 8, 'services')
) AS v("slug", "name", "icon", "position", "parent") JOIN "classified_categories" p ON p."slug" = v."parent" WHERE c."slug" = v."slug";

-- A moved category opens wherever its new parent is.
INSERT INTO "classified_category_countries" ("category_id", "country", "enabled")
SELECT c."id", pc."country", pc."enabled" FROM "classified_categories" c JOIN "classified_category_countries" pc ON pc."category_id" = c."parent_id"
ON CONFLICT DO NOTHING;

-- Merged: their listings, resale rules and feature suggestions go to their new home.
UPDATE "classified_listings" SET "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'jewellery-watches') WHERE "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'watches');
UPDATE "resale_rules" SET "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'jewellery-watches') WHERE "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'watches');
UPDATE "classified_feature_suggestions" SET "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'jewellery-watches') WHERE "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'watches');
UPDATE "classified_listings" SET "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'skin-care') WHERE "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'bath-body');
UPDATE "resale_rules" SET "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'skin-care') WHERE "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'bath-body');
UPDATE "classified_feature_suggestions" SET "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'skin-care') WHERE "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'bath-body');
UPDATE "classified_listings" SET "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'houses-for-sale') WHERE "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'new-builds');
UPDATE "resale_rules" SET "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'houses-for-sale') WHERE "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'new-builds');
UPDATE "classified_feature_suggestions" SET "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'houses-for-sale') WHERE "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'new-builds');
UPDATE "classified_listings" SET "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'doors-windows') WHERE "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'hardware-fasteners');
UPDATE "resale_rules" SET "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'doors-windows') WHERE "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'hardware-fasteners');
UPDATE "classified_feature_suggestions" SET "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'doors-windows') WHERE "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'hardware-fasteners');
UPDATE "classified_listings" SET "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'baby-gear') WHERE "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'maternity');
UPDATE "resale_rules" SET "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'baby-gear') WHERE "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'maternity');
UPDATE "classified_feature_suggestions" SET "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'baby-gear') WHERE "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'maternity');
UPDATE "classified_listings" SET "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'sports-equipment') WHERE "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'camping-outdoor');
UPDATE "resale_rules" SET "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'sports-equipment') WHERE "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'camping-outdoor');
UPDATE "classified_feature_suggestions" SET "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'sports-equipment') WHERE "category_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'camping-outdoor');

-- Dropped: deleted when nothing is listed in them (subcategories first), else switched off so live listings run out.
DELETE FROM "classified_categories" c WHERE c."slug" IN ('jobs', 'job-vacancies', 'seeking-work', 'cv-office', 'cv-sales', 'cv-it', 'cv-trades', 'cv-drivers', 'cv-hospitality', 'cv-health', 'cv-teaching', 'cv-other', 'software', 'boats', 'vitamins-supplements', 'reptiles', 'medical-equipment', 'stage-equipment', 'safety-equipment', 'legal-financial', 'travel', 'watches', 'bath-body', 'new-builds', 'hardware-fasteners', 'maternity', 'camping-outdoor') AND c."parent_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "classified_listings" l WHERE l."category_id" = c."id");
DELETE FROM "classified_categories" c WHERE c."slug" IN ('jobs', 'job-vacancies', 'seeking-work', 'cv-office', 'cv-sales', 'cv-it', 'cv-trades', 'cv-drivers', 'cv-hospitality', 'cv-health', 'cv-teaching', 'cv-other', 'software', 'boats', 'vitamins-supplements', 'reptiles', 'medical-equipment', 'stage-equipment', 'safety-equipment', 'legal-financial', 'travel', 'watches', 'bath-body', 'new-builds', 'hardware-fasteners', 'maternity', 'camping-outdoor') AND c."parent_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "classified_listings" l WHERE l."category_id" = c."id") AND NOT EXISTS (SELECT 1 FROM "classified_categories" s WHERE s."parent_id" = c."id");
UPDATE "classified_categories" SET "enabled" = false, "updated_at" = CURRENT_TIMESTAMP WHERE "slug" IN ('jobs', 'job-vacancies', 'seeking-work', 'cv-office', 'cv-sales', 'cv-it', 'cv-trades', 'cv-drivers', 'cv-hospitality', 'cv-health', 'cv-teaching', 'cv-other', 'software', 'boats', 'vitamins-supplements', 'reptiles', 'medical-equipment', 'stage-equipment', 'safety-equipment', 'legal-financial', 'travel', 'watches', 'bath-body', 'new-builds', 'hardware-fasteners', 'maternity', 'camping-outdoor');
