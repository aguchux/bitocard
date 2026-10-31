-- What a product can do (virtual numbers' calls and SMS), shown as icons and filtered on in the stores.
ALTER TABLE "products" ADD COLUMN "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "products_features_idx" ON "products" USING GIN ("features");
