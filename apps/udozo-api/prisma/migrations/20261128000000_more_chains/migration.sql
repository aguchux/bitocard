-- More coins and networks: the EVM networks Polygon, Arbitrum One, Base and OP Mainnet (one customer address for every
-- EVM network), TRX on TRON, Litecoin and Dogecoin (address families of their own). Every new network starts with
-- deposits and withdrawals off; admins switch them on in Crypto > Chains once a provider and the wallet key are set.
-- Token contracts are the issuers' published ones: check each against the issuer before switching a network on.
ALTER TABLE "crypto_networks" DROP CONSTRAINT "crypto_networks_chain_check";
ALTER TABLE "crypto_networks" ADD CONSTRAINT "crypto_networks_chain_check" CHECK ("chain" IN ('ETHEREUM', 'BSC', 'POLYGON', 'ARBITRUM', 'BASE', 'OPTIMISM', 'TRON', 'SOLANA', 'BITCOIN', 'LITECOIN', 'DOGECOIN'));

ALTER TABLE "crypto_withdrawal_addresses" DROP CONSTRAINT "crypto_withdrawal_addresses_check";
ALTER TABLE "crypto_withdrawal_addresses" ADD CONSTRAINT "crypto_withdrawal_addresses_check" CHECK ("chain" IN ('ETHEREUM', 'BSC', 'POLYGON', 'ARBITRUM', 'BASE', 'OPTIMISM', 'TRON', 'SOLANA', 'BITCOIN', 'LITECOIN', 'DOGECOIN') AND "screening" IN ('clear', 'flagged', 'unscreened'));

ALTER TABLE "crypto_addresses" DROP CONSTRAINT "crypto_addresses_family_check";
ALTER TABLE "crypto_addresses" ADD CONSTRAINT "crypto_addresses_family_check" CHECK ("family" IN ('bitcoin', 'evm', 'tron', 'solana', 'litecoin', 'dogecoin') AND "index" >= 0);

-- Ledger places: 8 at most (18-decimal coins are cut to 8, as ETH and BNB are); TRX has 6.
INSERT INTO "crypto_assets" ("code", "name", "decimals", "enabled", "sort_order", "withdrawal_daily_limit", "withdrawal_review_from") VALUES
    ('POL', 'Polygon', 8, true, 6, '20000', '2000'),
    ('TRX', 'TRON', 6, true, 7, '50000', '5000'),
    ('LTC', 'Litecoin', 8, true, 8, '100', '10'),
    ('DOGE', 'Dogecoin', 8, true, 9, '100000', '10000')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "crypto_networks" ("asset", "chain", "contract", "test_contract", "decimals", "confirmations") VALUES
    ('POL', 'POLYGON', NULL, NULL, 18, 256),
    ('USDT', 'POLYGON', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', NULL, 6, 256),
    ('USDC', 'POLYGON', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582', 6, 256),
    ('ETH', 'ARBITRUM', NULL, NULL, 18, 300),
    ('USDT', 'ARBITRUM', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', NULL, 6, 300),
    ('USDC', 'ARBITRUM', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', 6, 300),
    ('ETH', 'BASE', NULL, NULL, 18, 120),
    ('USDC', 'BASE', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', '0x036CbD53842c5426634e7929541eC2318f3dCF7e', 6, 120),
    ('ETH', 'OPTIMISM', NULL, NULL, 18, 120),
    ('USDT', 'OPTIMISM', '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', NULL, 6, 120),
    ('USDC', 'OPTIMISM', '0x0b2C639c533813f4Aa9D7837cAf62653d097Ff85', '0x5fd84259d66Cd46123540766Be93DFE6D43130D7', 6, 120),
    ('TRX', 'TRON', NULL, NULL, 6, 19),
    ('LTC', 'LITECOIN', NULL, NULL, 8, 6),
    ('DOGE', 'DOGECOIN', NULL, NULL, 8, 40)
ON CONFLICT DO NOTHING;
