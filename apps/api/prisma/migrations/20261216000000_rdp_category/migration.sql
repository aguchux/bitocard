-- RDP (remote desktop servers) becomes a category, so the store's menu can link to it before any supplier is chosen.
-- Its own migration: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "ProductCategory" ADD VALUE IF NOT EXISTS 'rdp';
