-- Each order's page link: permanent until the reseller replaces it. Only the token's hash is looked up; the token is
-- kept encrypted (ENCRYPTION_KEY) so the API can show the link again. The page opens only for the customer who proves
-- the order is theirs: signed in at its store, or with a code emailed to the order's address.
CREATE TABLE "order_access" (
    "order_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_encrypted" TEXT NOT NULL,
    "revealed_at" TIMESTAMP(3),
    "reveals" INTEGER NOT NULL DEFAULT 0,
    "alerted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replaced_at" TIMESTAMP(3),

    CONSTRAINT "order_access_pkey" PRIMARY KEY ("order_id")
);

CREATE UNIQUE INDEX "order_access_token_hash_key" ON "order_access"("token_hash");

ALTER TABLE "order_access" ADD CONSTRAINT "order_access_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Codes emailed to open an order's page: hashed, single use, 10 minutes, 5 tries.
CREATE TABLE "order_access_codes" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_access_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_access_codes_order_id_created_at_idx" ON "order_access_codes"("order_id", "created_at");

ALTER TABLE "order_access_codes" ADD CONSTRAINT "order_access_codes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order_access"("order_id") ON DELETE CASCADE ON UPDATE CASCADE;
