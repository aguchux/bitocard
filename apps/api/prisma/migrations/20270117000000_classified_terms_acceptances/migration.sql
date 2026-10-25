-- BitoCard Shop: each customer's acceptance of the BitoCard Shop terms, by version (needed to post a listing or use Safe pay).
CREATE TABLE "classified_terms_acceptances" (
    "customer_id" UUID NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_terms_acceptances_pkey" PRIMARY KEY ("customer_id","version")
);

-- AddForeignKey
ALTER TABLE "classified_terms_acceptances" ADD CONSTRAINT "classified_terms_acceptances_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
