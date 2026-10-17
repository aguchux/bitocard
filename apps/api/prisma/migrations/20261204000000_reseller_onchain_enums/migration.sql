-- A reseller's coins on their way out on chain (its own migration: a new enum value cannot be used in the same transaction).
ALTER TYPE "AccountKind" ADD VALUE 'reseller_crypto_withdrawing';
