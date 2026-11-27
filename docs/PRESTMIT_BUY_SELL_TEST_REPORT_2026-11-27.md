# Prestmit gift-card buying and selling test report

**Test date:** 27 November 2026  
**Repository branch:** `main`  
**Scope:** BitoCard's Prestmit supplier integration, customer gift-card sales, storefront flows, and mobile flows.

## Executive result

| Area | Local integration result | Real Prestmit sandbox result |
| --- | --- | --- |
| Buy gift cards from Prestmit | **Pass** | **Blocked before network call** |
| Sell customer gift cards to Prestmit | **Pass** | **Blocked before network call** |
| Web customer experience | **Pass** | Not a provider call |
| Mobile customer experience | **Pass** | Not a provider call |

The implementation passed every executed automated contract and customer-flow test: **45 tests passed and 0 failed**. This proves BitoCard's behavior against its isolated fake Prestmit server and its web/mobile API contracts. It does **not** yet certify the real Prestmit sandbox because activated sandbox credentials and provider test fixtures are not configured locally.

## Build and test evidence

### API build

Command:

```text
npm run build -w @bitocard/api
```

Result: **Pass**. Prisma Client generation and the Nest API build completed successfully.

### API integration suites

Command:

```text
node --test --test-concurrency=1 test/gift-card-sales.test.mjs test/prestmit-supplier.test.mjs test/integrations.test.mjs
```

Result: **27 passed, 0 failed** across 6 suites in 48.84 seconds.

#### Buying cards — passed coverage

- Prestmit's buyable catalogue syncs into fixed-value and variable-value BitoCard products.
- Prices are calculated against the Prestmit NGN wallet.
- Completed purchases deliver card codes while keeping the upstream supplier private.
- Whole values, supported ranges, quantities, and multi-card purchases are enforced.
- Pending purchases remain pending and later complete from buy history and code retrieval.
- A lost create response is recovered by BitoCard's unique reference and is never purchased twice.
- A definite provider refusal fails the order and releases reserved customer funds.
- Signed buy webhooks are accepted and stored as supplier notifications.

#### Selling cards — passed coverage

- Sell offers sync, match brands, and remain unavailable until the feature and margin are configured.
- A sandbox sale credits the customer exactly once after approval and applies BitoCard's margin.
- Rejected cards credit no customer funds.
- Reseller-store buyback calculates the capped reseller share and posts it to reseller earnings.
- Live-mode behavior requires identity verification and submits BitoCard's unique reference.
- Settlement uses Prestmit's confirmed amount, not an untrusted webhook amount.
- Definite refusal fails immediately; an unclear submission is recovered by reference before any final decision.
- Switching the integration to sandbox prevents previously synced live offers from being sold.
- API hashing, country/form mapping, and both hexadecimal and base64 webhook signatures pass.

#### Integration configuration — passed coverage

- Integration secrets are write-only, encrypted at rest, and excluded from responses and audit values.
- Only super administrators can change integration settings, with step-up authentication.
- Configuration validation, environment fallback, and cross-instance refresh behavior pass.

### Storefront customer flows

Command:

```text
npm test -w @bitocard/storefront -- test/sell-form.test.ts test/gift-card-actions.test.ts test/gift-card-rate.test.ts
```

Result: **14 passed, 0 failed** across 3 files in 1.45 seconds.

Covered the Buy/Sell tabs, signed-in and signed-out sale behavior, country/store-specific offers, sell entry points, rate display, and product navigation.

### Mobile customer flows

Command:

```text
npx jest test/screens/gift-cards.test.tsx --runInBand --forceExit
```

Result: **4 passed, 0 failed** in 3.37 seconds.

Covered buying a gift card through confirmation, protected delivery-code reveal, selling an e-code using the exact quoted payout, and the identity-verification refusal path.

The Jest process required `--forceExit` because the mobile test harness retains an asynchronous handle after reporting completion. No test failed.

## Real Prestmit sandbox check

Command:

```text
npm run smoke:prestmit -w @bitocard/api
```

Result: **Blocked safely before a provider request** with:

```text
Set PRESTMIT_SANDBOX_API_KEY and PRESTMIT_SANDBOX_API_SECRET to your activated sandbox credentials.
```

No Prestmit request was sent and no test card was bought or sold.

### Activation-message endpoint verification

Prestmit's activation message supplied `https://dev.prestmit.io/api/partners/v1`, while its current documentation specifies `https://dev-api.prestmit.io/partners/v1`.

Read-only network checks found:

- `https://dev.prestmit.io/api/partners/v1/general/service-availability` redirects to an interactive Cloudflare Access login and is not suitable for BitoCard's server-to-server requests.
- `https://dev-api.prestmit.io/partners/v1/general/service-availability` reaches the API and returns `401 Unauthorized` without an API key, which is the expected unauthenticated response.
- BitoCard already uses the documented `dev-api.prestmit.io` sandbox address, so no endpoint change is required.

Prestmit's documentation says the activated sandbox key and secret are obtained from the sandbox dashboard's Developers area. It also notes that IP whitelisting may apply. If an IP allowlist is enabled, run the provider smoke transactions from the same fixed outbound IP that is whitelisted for BitoCard rather than from a developer workstation.

## Production read-only preflight

The deployed API was checked without a customer session and without creating a transaction.

| Endpoint | HTTP | Result |
| --- | --- | --- |
| `GET https://api.bitocard.com/health` | 200 | Production API and database healthy; deployed commit `2847042` |
| `GET https://api.bitocard.com/v1/store/gift-card-sales/offers?country=NG` | 200 | `available: false`, reason `not_configured`, zero offers |

This means customers in Nigeria cannot currently submit a gift card for sale through the production API. The response is controlled and safe, but production selling is not configured. The public response cannot prove whether Prestmit buying is enabled internally because BitoCard intentionally hides supplier routing from customers.

### Inputs required to complete provider certification

Keep these values outside Git and load them only into the test shell:

- `PRESTMIT_SANDBOX_API_KEY`
- `PRESTMIT_SANDBOX_API_SECRET`
- `PRESTMIT_SANDBOX_ACCOUNT_PIN` when the sandbox account requires it
- `PRESTMIT_SANDBOX_BUY_SKU`
- `PRESTMIT_SANDBOX_SELL_CARD_ID`
- `PRESTMIT_SANDBOX_AMOUNT` as a supported positive whole face value
- Exactly one of `PRESTMIT_SANDBOX_SELL_CODE` or `PRESTMIT_SANDBOX_SELL_PHOTO`, using a Prestmit sandbox fixture

Then run, in order:

```text
npm run smoke:prestmit -w @bitocard/api
npm run smoke:prestmit -w @bitocard/api -- buy
npm run smoke:prestmit -w @bitocard/api -- sell
```

Save the printed BitoCard unique identifiers. They are required for safe status recovery without repeating a transaction:

```text
npm run smoke:prestmit -w @bitocard/api -- buy-status <buy-identifier>
npm run smoke:prestmit -w @bitocard/api -- sell-status <sell-identifier>
```

## Release assessment

**Local implementation status: pass.**  
**Real provider sandbox certification: incomplete.**

Do not enable Prestmit for live buying or selling based only on this report. First complete the provider smoke check, one sandbox buy, one sandbox sale, status recovery for both, and a signed webhook delivery against an isolated HTTPS test deployment.
