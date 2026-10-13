# BitoCard crypto signer protocol

The signer is the only part of BitoCard that can spend customers' crypto. It runs **off Vercel**, in front of the key
vault (Turnkey, Dfns or an HSM holding the keys from the offline key ceremony), and enforces its own limits. The API
holds no private keys: it asks the signer to send each on-chain withdrawal, then checks the result on chain through the
chain providers before it settles anything.

The API side is `apps/api/src/crypto/custody/signer.ts` (`RemoteSigner`). It is set up in the admin app at Settings >
Integrations > Blockchain > Crypto signer: the address (`CRYPTO_SIGNER_URL`), the shared secret
(`CRYPTO_SIGNER_SECRET`, at least 32 characters) and the Sandbox switch (`CRYPTO_SIGNER_SANDBOX`). With Sandbox on, the
signer serves sandbox stores on test networks, and live withdrawals are not offered. With it off, it serves live
stores on main networks. Sandbox stores without a test signer get a simulated one.

## Requests

Every request carries a signature header:

```
BitoCard-Signer-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<signed text>", keyed with the shared secret>
```

- For a POST, the signed text is the raw JSON body.
- For a GET, it is the URL path the signer receives, including any base path (for example `/signer/v1/transfers/bc_cw_…`).

The signer must:

- refuse a missing or wrong signature with `401`, comparing in constant time;
- refuse a timestamp more than 5 minutes from its own clock;
- accept HTTPS only.

### `POST /v1/transfers`

Sends a transfer, or returns the one already made with this reference.

```json
{
  "reference": "bc_cw_3f0c…",
  "chain": "ETHEREUM",
  "network": "mainnet",
  "asset": "USDT",
  "contract": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  "to": "0x52908400098527886E0F7030069857D2E4169EE7",
  "amount": "50000000",
  "decimals": 6
}
```

- `chain` is `ETHEREUM`, `BSC`, `TRON` or `BITCOIN`; `network` is `mainnet` or `testnet`.
- `contract` is the token contract, or `null` for the chain's own coin.
- `amount` is a decimal string of **on-chain units**: 18-decimal tokens exceed 64 bits.
- **`reference` is the idempotency key.** The API sends the same reference every time it asks about one withdrawal,
  including after a timeout. The signer must never make a second transfer for a reference it has already received: it
  returns that transfer's current state instead.
- **Record the reference before any slow work.** The signer must store the reference atomically, before it signs or
  broadcasts anything, so a `GET` for a reference it has received never answers `404`, even while the `POST` that
  carried it is still being worked on (or its reply was lost). The API returns a frozen account's withdrawal to the
  customer on a `404`.
- **HTTPS only.** The API refuses a signer address that is not `https://`.

### `GET /v1/transfers/{reference}`

Returns the transfer's current state, or `404` if the signer never received this reference. A `404` tells the API it is
safe to send again, and that a withdrawal frozen before sending can be returned to the customer.

### Transfer object

Both endpoints answer `200` with:

```json
{ "reference": "bc_cw_3f0c…", "status": "broadcast", "tx_hash": "0x…", "reason": null }
```

| `status` | Meaning | What the API does |
|---|---|---|
| `pending` | Accepted, not broadcast yet | Asks again later |
| `broadcast` | Broadcast, with `tx_hash` | Re-reads the transaction from the chain and settles it after the network's confirmations |
| `confirmed` | Confirmed, with `tx_hash` | Same: the chain is still read before settling |
| `failed` | **Definitely not sent**, now or ever (`reason` says why) | Returns the amount and fee to the customer's wallet |

If the signer replaces a transaction (for example a fee bump), it reports the new `tx_hash`; the API follows it.
`failed` must only be reported when no transaction for the reference can still be mined.

### Errors

| Answer | Meaning for the API |
|---|---|
| `400`, `401`, `403`, `404` (POST), `422` | A definite refusal: nothing was sent. The withdrawal fails and its money is returned. Put a reason in `{ "error": { "message": "…" } }` (for example "above the hot wallet limit"). |
| `408`, `409`, `429`, `5xx`, timeouts | Unclear: the API asks again later with the same reference. Unclear is not failed. |

### `GET /v1/health`

Answers `200 { "network": "mainnet" | "testnet" }`. The admin app's Test connection uses it; it sends nothing.

### `GET /v1/balances/{network}`

`network` is `mainnet` or `testnet`. It is a path segment, not a query, so the signature covers it. The answer is
everything the signer's wallets hold on that network: deposit addresses, hot, warm and cold.

```json
{
  "network": "mainnet",
  "balances": [
    { "chain": "TRON", "asset": "USDT", "contract": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "amount": "125000000", "decimals": 6 },
    { "chain": "BITCOIN", "asset": "BTC", "contract": null, "amount": "1500000", "decimals": 8 }
  ]
}
```

Amounts are on-chain units as decimal strings. The API's daily custody check (`crypto-reconcile` job,
`src/crypto/custody/reconciliation.service.ts`) matches each balance to a network by chain and token contract (never by
symbol). It compares the total per asset with what the ledger expects: `crypto_custody`, less withdrawals broadcast but
not settled, plus deposits seen but not credited.

- **Shortfall:** urgent; finance and operations are told at once.
- **Surplus:** BitoCard's own money, such as a gas float or fees not swept.
- **Unknown tokens:** listed and never counted.

### `POST /v1/addresses` (Solana, planned)

Takes `{ "chain": "SOLANA", "network": "mainnet" | "testnet", "index": 12 }` and answers `{ "address": "…" }`. Solana
keys are hardened only, so only the signer can make customers' Solana deposit addresses.

## What the signer owns

- **Keys.** The keys come from the offline key ceremony, with a Shamir backup. They live only in the vault or HSM and
  are never exported.
- **Wallet tiers and limits.** A hot wallet holds 5 to 10% of custody, warm wallets are 2-of-3, and cold storage holds
  the rest. Per-transfer and daily limits are refused with `422`.
- **Fees.** It pays network fees from the hot wallet. BitoCard's withdrawal fee, charged to the customer, is booked
  separately by the API.
- **Sweeps.** It moves funds from customers' deposit addresses to the hot wallet. Address `m/…/0/i` belongs to
  customer index `i` (see `apps/api/src/crypto/derive.ts`).
- **Reconciliation.** Its balances back the daily check of `crypto_custody` against the chain.
