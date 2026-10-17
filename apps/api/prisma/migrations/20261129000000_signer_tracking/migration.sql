-- When the signer was told about the address a deposit arrived at (it sweeps it and counts it in its balances).
ALTER TABLE "crypto_deposits" ADD COLUMN "signer_tracked_at" TIMESTAMP(3);
