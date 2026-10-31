-- Withdrawals to mobile money through pawaPay (phase 7 of store plans): a payout account is a bank account or a
-- mobile money wallet (the owner's confirmed phone; bank_code is pawaPay's network code), and a payout records the
-- fee taken out of the amount withdrawn.
CREATE TYPE "PayoutAccountKind" AS ENUM ('bank', 'mobile_money');

ALTER TABLE "bank_accounts" ADD COLUMN "kind" "PayoutAccountKind" NOT NULL DEFAULT 'bank';

ALTER TABLE "payouts" ADD COLUMN "fee_minor" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_fee_check" CHECK ("fee_minor" >= 0 AND "fee_minor" < "amount_minor");
