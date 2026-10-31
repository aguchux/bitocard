-- VPN access becomes its own category (it was filed under software). Its own migration: a new enum value cannot be used
-- in the transaction that adds it.
ALTER TYPE "ProductCategory" ADD VALUE IF NOT EXISTS 'vpn';
