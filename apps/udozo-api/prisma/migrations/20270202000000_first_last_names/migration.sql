-- People's first and last names apart (customers, sellers and admins), so they can be matched to an identity document.
-- `name` stays the two joined. Existing names are split here, the first word then the rest; nobody's is confirmed yet,
-- so each person is asked to check theirs (a one-word name gets its last name then).

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "first_name" TEXT,
ADD COLUMN "last_name" TEXT,
ADD COLUMN "name_confirmed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN "first_name" TEXT,
ADD COLUMN "last_name" TEXT,
ADD COLUMN "name_confirmed_at" TIMESTAMP(3);

UPDATE "customers" SET
  "first_name" = split_part(regexp_replace(btrim("name"), '\s+', ' ', 'g'), ' ', 1),
  "last_name" = NULLIF(btrim(substr(regexp_replace(btrim("name"), '\s+', ' ', 'g'), length(split_part(regexp_replace(btrim("name"), '\s+', ' ', 'g'), ' ', 1)) + 1)), '');

UPDATE "users" SET
  "first_name" = split_part(regexp_replace(btrim("name"), '\s+', ' ', 'g'), ' ', 1),
  "last_name" = NULLIF(btrim(substr(regexp_replace(btrim("name"), '\s+', ' ', 'g'), length(split_part(regexp_replace(btrim("name"), '\s+', ' ', 'g'), ' ', 1)) + 1)), '');
