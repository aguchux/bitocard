CREATE TYPE "GiftCardCategory" AS ENUM (
  'online_marketplaces', 'travel', 'food_groceries', 'restaurants_delivery', 'gaming',
  'gasoline_automotive', 'transportation', 'electronics', 'fashion', 'privacy_tools', 'ai',
  'department_stores', 'multi_brand', 'entertainment', 'music_streaming', 'home_diy',
  'health_beauty', 'sports_outdoors', 'gifts_experiences', 'kids', 'crypto_payments',
  'app_stores_mobile', 'books_learning'
);

CREATE TYPE "GiftCardRedemptionChannel" AS ENUM ('online', 'in_store', 'app', 'phone');
CREATE TYPE "GiftCardRedemptionScope" AS ENUM ('single_country', 'multiple_countries', 'global', 'unknown');
CREATE TYPE "GiftCardClassificationStatus" AS ENUM ('needs_review', 'inferred', 'reviewed');

ALTER TABLE "products"
  ADD COLUMN "gift_card_primary_category" "GiftCardCategory",
  ADD COLUMN "gift_card_categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "gift_card_redemption_channels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "gift_card_countries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "gift_card_redemption_scope" "GiftCardRedemptionScope",
  ADD COLUMN "gift_card_classification_status" "GiftCardClassificationStatus",
  ADD COLUMN "gift_card_classification_locked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "gift_card_classified_at" TIMESTAMP(3),
  ADD COLUMN "gift_card_classified_by_id" UUID,
  ADD COLUMN "gift_card_rating_average" DECIMAL(3,2),
  ADD COLUMN "gift_card_rating_count" INTEGER NOT NULL DEFAULT 0;

UPDATE "products"
SET "gift_card_countries" = CASE WHEN "country" = 'WW' THEN ARRAY[]::TEXT[] ELSE ARRAY["country"] END,
    "gift_card_redemption_scope" = CASE WHEN "country" = 'WW' THEN 'global'::"GiftCardRedemptionScope" ELSE 'single_country'::"GiftCardRedemptionScope" END,
    "gift_card_classification_status" = 'needs_review'::"GiftCardClassificationStatus"
WHERE "category" = 'gift_cards';

WITH classified AS (
  SELECT "id", CASE
    WHEN lower("name" || ' ' || "brand") ~ '(ai|chatgpt|openai|claude|anthropic|perplexity|midjourney)' THEN 'ai'
    WHEN lower("name" || ' ' || "brand") ~ '(gaming|playstation|psn|xbox|nintendo|steam|roblox|riot|valorant|fortnite|razer|pubg)' THEN 'gaming'
    WHEN lower("name" || ' ' || "brand") ~ '(app store|google play|itunes|appgallery)' THEN 'app_stores_mobile'
    WHEN lower("name" || ' ' || "brand") ~ '(spotify|music|deezer|pandora|tidal)' THEN 'music_streaming'
    WHEN lower("name" || ' ' || "brand") ~ '(netflix|cinema|movie|disney|youtube|streaming|ticketmaster|crunchyroll)' THEN 'entertainment'
    WHEN lower("name" || ' ' || "brand") ~ '(restaurant|starbucks|mcdonald|deliveroo|uber eats|just eat|talabat|doordash)' THEN 'restaurants_delivery'
    WHEN lower("name" || ' ' || "brand") ~ '(grocery|supermarket|carrefour|tesco|asda|aldi|lidl)' THEN 'food_groceries'
    WHEN lower("name" || ' ' || "brand") ~ '(travel|airbnb|booking.com|hotel|airline|flight|expedia)' THEN 'travel'
    WHEN lower("name" || ' ' || "brand") ~ '(gasoline|petrol|fuel|shell|chevron|exxon|totalenergies)' THEN 'gasoline_automotive'
    WHEN lower("name" || ' ' || "brand") ~ '(transport|uber|lyft|bolt|trainline|taxi)' THEN 'transportation'
    WHEN lower("name" || ' ' || "brand") ~ '(health|beauty|sephora|boots|ulta|spa|cosmetic)' THEN 'health_beauty'
    WHEN lower("name" || ' ' || "brand") ~ '(sport|outdoor|nike|adidas|decathlon|puma)' THEN 'sports_outdoors'
    WHEN lower("name" || ' ' || "brand") ~ '(fashion|clothing|apparel|zalando|asos|h&m|zara|nordstrom)' THEN 'fashion'
    WHEN lower("name" || ' ' || "brand") ~ '(home|diy|ikea|wayfair|furniture|hardware|home depot)' THEN 'home_diy'
    WHEN lower("name" || ' ' || "brand") ~ '(electronic|apple|samsung|best buy|currys|huawei)' THEN 'electronics'
    WHEN lower("name" || ' ' || "brand") ~ '(privacy|vpn|antivirus|nordvpn|expressvpn|mcafee|software)' THEN 'privacy_tools'
    WHEN lower("name" || ' ' || "brand") ~ '(crypto|bitcoin|binance|coinbase|paypal|paysafe|visa|mastercard)' THEN 'crypto_payments'
    WHEN lower("name" || ' ' || "brand") ~ '(book|audible|kindle|learning|education)' THEN 'books_learning'
    WHEN lower("name" || ' ' || "brand") ~ '(kids|children|toy|lego|baby)' THEN 'kids'
    WHEN lower("name" || ' ' || "brand") ~ '(department store|walmart|target|macy|john lewis)' THEN 'department_stores'
    WHEN lower("name" || ' ' || "brand") ~ '(multi.brand|one4all|love2shop)' THEN 'multi_brand'
    WHEN lower("name" || ' ' || "brand") ~ '(amazon|ebay|etsy|marketplace|shopee|aliexpress)' THEN 'online_marketplaces'
    WHEN lower("name" || ' ' || "brand") ~ '(gift|experience|groupon)' THEN 'gifts_experiences'
  END AS category
  FROM "products" WHERE "category" = 'gift_cards'
)
UPDATE "products" p
SET "gift_card_primary_category" = c.category::"GiftCardCategory",
    "gift_card_categories" = ARRAY[c.category]
FROM classified c WHERE p."id" = c."id" AND c.category IS NOT NULL;

UPDATE "products"
SET "gift_card_redemption_channels" = ARRAY_REMOVE(ARRAY[
      CASE WHEN coalesce("redeem_instructions", '') ~* '(online|website|web site|webpage)' THEN 'online' END,
      CASE WHEN coalesce("redeem_instructions", '') ~* '(app|application)' THEN 'app' END,
      CASE WHEN coalesce("redeem_instructions", '') ~* '(in.store|store|shop|retail location)' THEN 'in_store' END,
      CASE WHEN coalesce("redeem_instructions", '') ~* '(phone|telephone|call)' THEN 'phone' END
    ], NULL),
    "gift_card_classification_status" = CASE
      WHEN "gift_card_primary_category" IS NOT NULL AND coalesce("redeem_instructions", '') ~* '(online|website|web site|webpage|app|application|in.store|store|shop|retail location|phone|telephone|call)'
      THEN 'inferred'::"GiftCardClassificationStatus" ELSE 'needs_review'::"GiftCardClassificationStatus" END
WHERE "category" = 'gift_cards';

CREATE INDEX "products_gift_card_primary_category_idx" ON "products"("gift_card_primary_category");

CREATE TABLE "gift_card_reviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "checkout_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "rating" INTEGER NOT NULL,
  "review" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "gift_card_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gift_card_reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "gift_card_reviews_checkout_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "checkouts"("id") ON DELETE CASCADE,
  CONSTRAINT "gift_card_reviews_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE,
  CONSTRAINT "gift_card_reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "gift_card_reviews_checkout_id_key" ON "gift_card_reviews"("checkout_id");
CREATE INDEX "gift_card_reviews_product_id_created_at_idx" ON "gift_card_reviews"("product_id", "created_at");
CREATE INDEX "gift_card_reviews_customer_id_created_at_idx" ON "gift_card_reviews"("customer_id", "created_at");
