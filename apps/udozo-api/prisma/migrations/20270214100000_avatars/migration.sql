-- Udozo: a profile photo (a face, logo or icon) for every person: customers on udozo.com, and Seller HQ's and the
-- admin's people. The public address of a checked upload (`AvatarsService`); null shows their initials.
ALTER TABLE "customers" ADD COLUMN "avatar_url" TEXT;
ALTER TABLE "users" ADD COLUMN "avatar_url" TEXT;
