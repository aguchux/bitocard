-- BitoCard Crypto: each customer's declaration, by version, that they are not a citizen or resident of the United
-- States or the United Kingdom (needed to trade on the P2P markets).
CREATE TABLE "crypto_declarations" (
    "customer_id" UUID NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "declared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crypto_declarations_pkey" PRIMARY KEY ("customer_id","version")
);

-- AddForeignKey
ALTER TABLE "crypto_declarations" ADD CONSTRAINT "crypto_declarations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
