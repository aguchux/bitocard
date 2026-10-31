-- Sign-in handoff between BitoCard's own sites (docs/BITOCARD_CLASSIFIEDS_PLAN.md, phase 1 step 6): one-time codes, 60
-- seconds, bound to the site they sign in on; only their hashes are kept.
-- CreateTable
CREATE TABLE "customer_handoffs" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "to_origin" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_handoffs_code_hash_key" ON "customer_handoffs"("code_hash");

-- CreateIndex
CREATE INDEX "customer_handoffs_expires_at_idx" ON "customer_handoffs"("expires_at");

-- AddForeignKey
ALTER TABLE "customer_handoffs" ADD CONSTRAINT "customer_handoffs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "customer_handoffs" ADD CONSTRAINT "customer_handoffs_origin_check" CHECK ("to_origin" ~ '^https?://[a-z0-9.-]+(:[0-9]+)?$');
ALTER TABLE "customer_handoffs" ADD CONSTRAINT "customer_handoffs_expiry_check" CHECK ("expires_at" > "created_at");
