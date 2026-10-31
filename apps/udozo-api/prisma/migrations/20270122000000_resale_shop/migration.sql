-- B2B reselling, stage 3 (docs/BITOCARD_B2B_RESELLING_PLAN.md): the Resale shop template. Its store's own words may not
-- claim to own, make or stock the items it resells; admins keep these phrases, checked when the home page is saved.

CREATE TABLE "resale_claim_phrases" (
    "id" UUID NOT NULL,
    "phrase" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resale_claim_phrases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "resale_claim_phrases_phrase_key" ON "resale_claim_phrases"("phrase");

ALTER TABLE "resale_claim_phrases" ADD CONSTRAINT "resale_claim_phrases_phrase_check" CHECK ("phrase" = lower("phrase") AND char_length("phrase") BETWEEN 3 AND 80);

INSERT INTO "resale_claim_phrases" ("id", "phrase") VALUES
  (gen_random_uuid(), 'we manufacture'),
  (gen_random_uuid(), 'we make'),
  (gen_random_uuid(), 'we produce'),
  (gen_random_uuid(), 'our factory'),
  (gen_random_uuid(), 'made by us'),
  (gen_random_uuid(), 'manufactured by us'),
  (gen_random_uuid(), 'produced by us'),
  (gen_random_uuid(), 'our own stock'),
  (gen_random_uuid(), 'our warehouse'),
  (gen_random_uuid(), 'in our warehouse'),
  (gen_random_uuid(), 'owned by us'),
  (gen_random_uuid(), 'we own'),
  (gen_random_uuid(), 'we import'),
  (gen_random_uuid(), 'imported by us'),
  (gen_random_uuid(), 'direct from our factory'),
  (gen_random_uuid(), 'we are the manufacturer'),
  (gen_random_uuid(), 'official manufacturer'),
  (gen_random_uuid(), 'sole distributor');