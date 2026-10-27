-- Spin and win pays in US dollars (crypto has left BitoCard; docs/CRYPTO_SPINOFF_PLAN.md): wins build up in the
-- customer's spin rewards, a spend-only balance in US cents, moved into their store wallet. The coin accounts
-- (crypto_spin_rewards, crypto_promotions) are kept for the sandbox balances they hold.
ALTER TYPE "AccountKind" ADD VALUE 'spin_rewards';
