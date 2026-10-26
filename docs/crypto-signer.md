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

## Replies

Every reply, errors and `404`s included, carries a signature header too:

```
BitoCard-Signer-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "reply.<t>.<the request's v1>.<HTTP status>.<raw reply body>", keyed with the shared secret>
```

- `<the request's v1>` is the hex `v1` value from the request's own signature header, so a reply belongs to exactly one
  request: an old genuine reply (a `404` from before a transfer was received, a `failed` for another request) cannot
  be replayed onto a new one.
- `<raw reply body>` is the exact bytes sent (empty for an empty body).

The API treats a reply with a missing, wrong or stale (over 5 minutes) signature as unclear, whatever its status: it
never returns a withdrawal's money, or takes a refusal as final, on an unsigned answer, and asks again later. A proxy's
error page in front of the signer is therefore harmless. Example (Node.js):

```js
const v1 = /v1=([0-9a-f]{64})/.exec(req.headers['bitocard-signer-signature'])[1];
const t = Math.floor(Date.now() / 1000);
const body = JSON.stringify(reply);
res.setHeader('BitoCard-Signer-Signature', `t=${t},v1=${createHmac('sha256', secret).update(`reply.${t}.${v1}.${status}.${body}`).digest('hex')}`);
res.status(status).end(body);
```

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

- `chain` is `ETHEREUM`, `BSC`, `POLYGON`, `ARBITRUM`, `BASE`, `OPTIMISM`, `TRON`, `BITCOIN`, `LITECOIN` or `DOGECOIN`; `network` is `mainnet` or `testnet`. Every EVM network uses the same keys (m/44'/60'/0'); Litecoin's are at m/84'/2'/0' (native SegWit) and Dogecoin's at m/44'/3'/0' (legacy). Gas on Polygon is POL, on Arbitrum, Base and OP Mainnet ETH.
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

Answers `200 { "network": "mainnet" | "testnet", "vault": "turnkey", "hot_wallets": { "TRON": "T…", … } }`. The admin
app's Test connection uses it; it sends nothing. Fund the hot wallets shown here.

### `POST /v1/deposit-addresses`

Takes `{ "chain": "TRON", "network": "mainnet", "index": 12, "address": "T…" }` and answers `{ chain, index, address }`.
The API's `crypto` job sends it once for each address a deposit arrived at (`crypto_deposits.signer_tracked_at`), so
the signer sweeps it and counts it in its balances. The signer works the address out from its own keys and refuses
(`422`) one that differs: the API's xpub and the signer's keys are then not the same keys, and nothing is kept.

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

## BitoCard's signer (`apps/signer`)

A plain Node service (no framework) with its own Postgres database. Run **one per network**: a `mainnet` signer for
live stores and a `testnet` one for sandbox stores. Settings are environment variables, listed in
`apps/signer/.env.example`, all checked at start. It runs two ways, from the same code:

- **On Vercel (now, decided by the owner on 17 October 2026)**, as its own project with Root Directory `apps/signer`
  (`vercel.json`): `api/index.mjs` answers the API (every path is rewritten to it; the signature covers the original
  path) and `api/worker.mjs` is the worker, run by Vercel Cron every minute (`CRON_SECRET`, at least 16 characters),
  each run stopping after 50 seconds. A new transfer is signed straight after the reply (`waitUntil`). Several
  instances may run at once, so recording a transfer with its limit check, and signing on each chain, happen one at
  a time across instances under Postgres transaction-scoped advisory locks (they hold through Neon's pooler too). Its database is
  its own Neon Postgres (never the API's). **Put the project in its own Vercel team**, which only the owner can open:
  anyone who can read a project's environment variables in the API's team must never be able to read
  `TURNKEY_API_PRIVATE_KEY` or change `SIGNER_LIMITS`.
- **As a server (when traffic grows)** with `apps/signer/Dockerfile` (`npm start`: the HTTP interface plus the worker
  every `SIGNER_WORKER_INTERVAL_MS`, default 15 seconds) on a host off Vercel such as DigitalOcean App Platform, behind
  HTTPS, one instance. Moving is a deployment change: point the admin app's signer address at the new host.

- **Keys (`src/vault`).** `turnkey`: the recovery phrase is imported into one Turnkey wallet and never leaves it. Turnkey
  exports no xpubs, so the signer is given the same account xpubs as the admin app (`SIGNER_XPUB_<FAMILY>`) and works
  out public keys itself. Each path is added to the wallet as an account (compressed public key format) the first time
  it signs, and every signature Turnkey returns is checked against the xpub's key: a Turnkey wallet that is not the
  one behind the xpubs can never sign. Requests carry Turnkey's `X-Stamp` (P-256 over the exact body).
  `local` (`SIGNER_MNEMONIC`) is for test networks only; it is refused for mainnet.
- **What is signed.** The signer computes every digest itself and asks the vault only to sign it
  (`HASH_FUNCTION_NO_OP`). Transactions are built locally, never taken from a node:
  - **EVM** (every EVM network): legacy EIP-155 transactions at 20% over the node's gas price; `eth_chainId` is checked
    against the network first. Nonces follow the signer's own unconfirmed transactions, so two never share one.
  - **TRON**: the protobuf is built field by field (a dishonest node could change the destination in its own
    `createtransaction`); TRC-20 transfers may burn up to 100 TRX. One that expires unmined is `failed`.
  - **Bitcoin and Litecoin** (native SegWit) and **Dogecoin** (legacy, each input proved by its whole previous
    transaction, so a lying indexer cannot inflate the fee): confirmed outputs first, change back to the hot wallet,
    fee rates clamped. Outputs spent by the signer's own unconfirmed transactions are never spent again.
- **The hot wallet** is the internal chain's first key, `<account>/1/0`, on every family (no customer ever gets it).
  Withdrawals are paid from it.
- **Transfers.** Recorded under the reference before anything else; the signed bytes are kept before broadcasting, so
  a retry, a restart or a dropped transaction always sends exactly those bytes. `failed` only for a clear refusal before
  signing (a bad address, too little in the hot wallet, a limit) or a transaction the chain shows can never send
  (reverted, expired).
- **Limits (`SIGNER_LIMITS`).** A JSON list, one entry per coin or token, in on-chain units:
  `{ "chain": "TRON", "asset": "USDT", "contract": "TR7N…", "decimals": 6, "per_transfer": "5000000000",
  "daily": "20000000000", "sweep_min": "20000000" }`. Anything without an entry is refused, so the list is also what
  the signer may send. The daily limit counts withdrawals of the last 24 hours, never sweeps.
- **Sweeps.** Every worker pass looks at up to 100 tracked deposit addresses
  and moves one step on each: a token at or above its `sweep_min` gets the chain's coin for gas from the hot wallet
  first (EVM: the estimate with a margin; TRON: 30 TRX), then is swept once that has arrived; then the coin itself
  (everything less the fee). Nothing starts while the address has a transfer on its way. Assets without `sweep_min`
  are not swept.
- **Balances** add the hot wallet and every tracked deposit address, per coin and token in `SIGNER_LIMITS`.
- **Tests**: `apps/signer/test` (published address vectors, the EIP-155 example transaction byte for byte, Bitcoin
  transactions identical to btc-signer's own signing, the transfer lifecycle on PGlite, request and reply signatures,
  the Turnkey client against a fake).

### Setting it up

1. **Turnkey.** Create an organisation. Import the recovery phrase into one wallet: in Turnkey's dashboard, or with
   their `@turnkey/sdk-server` import flow on an offline machine. Note the organisation ID and wallet ID.
2. **An API key for the signer.** In Turnkey, create an API-only user with a P-256 key pair. Give it a policy that
   allows only signing (`ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2`) and creating wallet accounts on that one wallet. Set its
   public and private keys as `TURNKEY_API_PUBLIC_KEY` and `TURNKEY_API_PRIVATE_KEY`.
3. **The xpubs.** Set `SIGNER_XPUB_EVM`, `_TRON`, `_BITCOIN`, `_LITECOIN` and `_DOGECOIN` to exactly the values in the
   admin app.
4. **Nodes.** One HTTPS endpoint per chain the signer sends on (they can be the same providers as the API's), and
   `SIGNER_BLOCKCYPHER_TOKEN` for Dogecoin's main network.
5. **Limits** for every coin and token, then deploy: a Vercel project (Root Directory `apps/signer`) in its own team
   with a Neon database and the settings as encrypted environment variables, plus `CRON_SECRET` (at least 16
   characters; Vercel Cron sends it). The team needs a plan whose cron jobs may run every minute (Pro): Hobby allows
   one a day. The signer has no static files, and Vercel refuses a missing or empty output folder, so `public` holds only a
   `robots.txt` refusing crawlers (`vercel.json`). Give the
   project its own address on a custom domain, for example `signer.bitocard.com` (Cloudflare: a DNS-only CNAME to
   `cname.vercel-dns.com`, plus the TXT record Vercel asks for to verify `bitocard.com` in this team): Vercel
   Authentication covers its `*.vercel.app` addresses, so the API reaches only the custom domain. Every request and
   reply is signed, so the address being public is safe.
6. **The admin app.** Settings > Integrations > Blockchain > Crypto signer: the address and the same secret, the
   Sandbox switch on for the `testnet` signer. Test connection shows its hot wallets: fund them, starting small.
7. **Test networks first.** Run a `testnet` signer (`SIGNER_VAULT=local` is fine there) against Sepolia, Nile and the
   Bitcoin and Litecoin testnets, with a sandbox store, before any live withdrawal.

Each signature is one Turnkey signature (priced per signature beyond the plan's allowance): a Bitcoin-style
transaction takes one per input, and a token sweep needs a gas transfer too.

## What the signer owns

- **Keys.** The keys come from the offline key ceremony, with a Shamir backup. They live only in the vault or HSM and
  are never exported.
- **Wallet tiers and limits.** A hot wallet holds 5 to 10% of custody, warm wallets are 2-of-3, and cold storage holds
  the rest (warm and cold are moved by hand, outside the signer, for now). Per-transfer and daily limits are reported
  as `failed` with the reason.
- **Fees.** It pays network fees from the hot wallet. BitoCard's withdrawal fee, charged to the customer, is booked
  separately by the API.
- **Sweeps.** It moves funds from customers' deposit addresses to the hot wallet. Address `m/…/0/i` belongs to
  customer index `i` (see `apps/api/src/crypto/derive.ts`).
- **Reconciliation.** Its balances back the daily check of `crypto_custody` against the chain.
