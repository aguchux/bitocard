-- Checkout: customers' payments held for their orders, and checkout payments. Their own migration: a new enum value
-- cannot be used in the transaction that adds it.
ALTER TYPE "AccountKind" ADD VALUE IF NOT EXISTS 'customer_payments';
ALTER TYPE "PaymentPurpose" ADD VALUE IF NOT EXISTS 'checkout';
