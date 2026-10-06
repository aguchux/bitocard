-- Mobile money: money sent to a customer's mobile money wallet. Its own migration: a new enum value cannot be used in
-- the transaction that adds it.
ALTER TYPE "ProductCategory" ADD VALUE IF NOT EXISTS 'mobile_money';
