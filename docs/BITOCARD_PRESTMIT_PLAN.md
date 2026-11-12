# BitoCard gift card selling, trading and Prestmit: implementation plan

**Status:** planned on 12 November 2026. Nothing has been built. Today Prestmit is only:

- a disabled supplier row (`prestmit`, gift cards, "Later (selling phase)");
- a credentials group whose adapter is not built (`PRESTMIT_API_KEY`, `PRESTMIT_WEBHOOK_SECRET`, `PRESTMIT_API_URL`);
- a link to its site.

Two notification types are written but never sent: `customer.gift_card_sale.accepted` and `…declined`. One settings-chain option, `gift_card_payout` (`wallet` or `bank`), exists but is never read. No model, service, endpoint or screen exists for selling or trading.

This plan follows the rules already set in `AGENTS.md` and `PLANS.md`:

- Storefront customers sell and trade; resellers never sell cards to BitoCard themselves.
- A sale is quoted, verified, and settled only after the source accepts it.
- An unverified card is never cleared funds.
- A trade is an accepted sale linked to a new purchase. The incoming card is accepted before anything goes out.
- Sale sources are chosen by the best viable net return.
- Unclear is not failed.
- Providers are never shown to customers or resellers.

Where this plan differs from those files, they win until the owner updates them.

## What Prestmit offers (from its partner docs, read 12 November 2026)

Prestmit's Partners API (`documentation.prestmit.io`) has three parts.

**Selling cards to Prestmit (BitoCard buys back from customers)**

- `GET /lookup/sell-giftcard-categories`, `…/sell-giftcard-subcategories?categoryID&country` and `…/sell-giftcard-filters` give forms (Physical, Ecode) and card countries (USA, UK, EURO, CANADA, OTHERS).
- `GET /giftcard-trade/sell/rate-calculator-data` returns `sellableGiftcards[]` (`id`, `name`, `rate`, `minimum`, `form`, `country`, `terms`), with rates in naira.
- `POST /giftcard-trade/sell/create` is multipart. Its fields are `giftcard_id` (the subcategory), `amount`, `payoutMethod` (`NAIRA` or `CEDIS`), `attachments[]` (JPG or PNG, 5 MB each, up to 20), `comments` (where an e-code goes) and `uniqueIdentifier`.
- The sale is answered with a `reference` (`SGC…`), `rate`, `totalAmount` and `status`.
- Statuses are `PENDING`, `COMPLETED` (paid into our Prestmit wallet) and `REJECTED` (with `rejectionReason`).
- Review takes about 5 to 30 minutes for gaming cards and 1 to 2 hours for store cards.

**Buying cards from Prestmit (selling out)**

- `GET /giftcard-trade/buy/fetch-buyable-giftcards` lists cards by `sku`, with `minPrice`, `maxPrice`, currency and regions.
- `POST …/buy/calculate-payment` prices a card, and `POST …/buy/create` buys it with `currentAccountPIN` and `uniqueIdentifier`.
- `GET …/buy/fetch-codes/{reference}` returns `cardNumber`, `pinCode`, `claimUrl` and `expireDate`.
- Payment comes from our wallet, in naira or cedis only. A failed purchase is refunded to the wallet.

**Wallet and payouts**

- There are separate naira and cedis wallets. Completed sales are credited to them.
- Bank accounts are added to our own Prestmit profile.
- `POST /wallet/fiat/create-withdrawal` pays out, at least ₦1,000.
- Ghana accounts can include mobile money.

**Webhooks**

- One HTTPS address per key, signed in `x-prestmit-signature` (HMAC-SHA256, base64).
- Events: `giftcard-trade.sell.approved|rejected`, `giftcard-trade.buy.approved|rejected`, `withdrawal-request(.cedis).approved|rejected`.
- Requery is by `GET …/sell/history` and `…/buy/history`, filtered by `uniqueIdentifier` or `referenceOrID`.

**Authentication**

- Requests carry `API-KEY`, plus `API-Hash`: HMAC-SHA256 of `API_KEY + ":" + JSON body` keyed with the API secret, with attachments left out.
- An IP allowlist can be set per key.
- There is a sandbox (`dev-api.prestmit.io`, sign-up at sandbox.prestmit.io).

**Prestmit's OTC desk is crypto only.** It has no API: trades happen in a WhatsApp or Telegram group, from $3,000. It does not concern BitoCard (crypto is Afrippa's), and there is no OTC desk for gift cards.

### What the docs leave unclear (confirm in writing before building)

1. **Base URLs and the auth header.** The guides and the reference disagree (`api.prestmit.io/partners/v1` against `prestmit.com/api/partners/v1`; `API-KEY` and `API-Hash` against `Authorization: Bearer`). It is also unclear how a multipart body is turned into the JSON that gets hashed, and whether GET requests are hashed.
2. **Webhook signature.** Is it computed over the raw body, or over re-serialised JSON? What are the sale and purchase payloads? What is the retry schedule?
3. **Rates.** Is `rate` naira per one unit of the card's currency (₦ per US$1)? How long does a rate hold between submission and review? Can Prestmit complete a sale at a lower rate or a partial value, and how would that show?
4. **`uniqueIdentifier`.** Does Prestmit refuse a second sale with the same identifier (true idempotency)? Can a sale be found by it straight after a timeout?
5. **Commission.** Is `sellGiftCardTradeCommissionPercentage` paid *to* BitoCard or charged? Where does it appear in a sale?
6. **Reversals.** After `COMPLETED`, can Prestmit claw a sale back (for example when the card issuer reverses a card later)? For how long? This sets BitoCard's payout hold.
7. **E-code fields.** Codes go in `comments`. Is there a structured code and PIN field? Are receipts required for some brands?
8. **Downstream use.** We need written permission for BitoCard to submit cards for its customers and resellers' customers. What KYC does Prestmit need from us, and does it expect anything about the end seller?
9. **Countries.** Is payout limited to NGN and GHS? Are cards from Kenya, or for Kenyan sellers, accepted?
10. **Wallet PIN and 2FA.** Purchases need `currentAccountPIN`. Withdrawals need the PIN and a 2FA code. Can a partner key run without 2FA, or with a TOTP we hold?
11. **Limits and fees.** Rate limits, any daily volume limit, the withdrawal fee, and the live address to allowlist (the droplet's IPv4).

Phases 0 and 1 below need only answers 1 to 4 and 8. Answer 6 sets the payout hold before going live.

## Product decisions proposed (owner to confirm)

1. **Markets: Nigeria and Ghana first** (Prestmit pays NGN and GHS). Kenya stays off until a sale source pays KES.
2. **Who sells and through which channels.**
   - **Customers of bitocard.com and its country stores** sell through their account.
   - **Customers of resellers' hosted stores** also sell, under the store's brand (phase 4).
   - **Resellers' own systems** get the API later (phase 5). There BitoCard settles the reseller's wallet, and the reseller pays their customer.
   - A reseller never sells cards to BitoCard on their own behalf.
3. **What the customer is paid, through the settings chain `gift_card_payout`.**
   - **Wallet:** spend-only store credit in `customer_wallet`.
   - **Bank:** withdrawable money in `customer_withdrawable`, paid to a bank account in the customer's verified name by BitoCard's own transfer provider. Prestmit's withdrawals cannot be used for this, because Prestmit only pays accounts on our own profile.
   - The country enables either or both, and the reseller chooses within that. Bank is the default only where BitoCard enables it.
4. **The quote is an estimate held for 15 minutes; the payout follows what the source accepts.**
   - The customer sees a payout for the card's value, fixed while they submit within 15 minutes.
   - If the source accepts at or above the rate we quoted on, BitoCard pays the quoted payout.
   - If the source accepts less (a lower rate, or part of the value), the payout is recomputed from what the source paid, using the same spreads. The customer is told the reason, and the change sits in a review queue for admins.
   - BitoCard never pays more than the source credited, less its spreads. This needs answer 3; the terms must say so before any card is accepted.
5. **Identity checks are always required to sell, live.** This is the `gift_cards` default; selling is a payout, so no store owner or customer waiver applies to selling.
6. **A trade holds the outgoing price for 4 hours.**
   - The incoming card is submitted.
   - The outgoing product's price is held for 4 hours. That is longer than a normal quote, at BitoCard's risk, and admins can change it.
   - Once the card is accepted, the proceeds go into the customer's wallet and the outgoing purchase is paid from it in the same step. Any difference is shown before the customer confirms: extra to pay from the wallet, or change left in it.
   - If acceptance comes after the hold, the proceeds stay in the wallet and the customer buys at the price of the day.
7. **Prestmit is also a buy-side supplier.** Its catalogue is routed by net margin against Reloadly and Zendit. Its naira wallet is funded first by our own sale proceeds, which nets money flow.

## Security model

- **Codes and PINs are secrets.**
  - They are encrypted at rest with `Encryption`, like order deliveries.
  - They are fingerprinted with an HMAC of the normalised code (keyed from `ENCRYPTION_KEY`), so the same code can never be submitted twice by anyone, on any store. A repeat is refused with `card_already_submitted`, and admins are told.
  - They are sent to the source once, never logged, and never returned after submission. Customers see the last four characters; admins see the last four and the fingerprint matches.
- **Card photos and receipts** are checked from their bytes and stripped of metadata (`checkDocument`, JPEG or PNG, 5 MB, at most 20). They are sealed into the private bucket (`KycStorage.giftCardSaleKey(sale, file)`), sent to the source from memory, and read back by admins only (audited).
- **Card data is deleted after its last use.**
  - Photos and the encrypted code are deleted 90 days after a sale is final, whether accepted or rejected (the `gift-card-sales` job).
  - The fingerprint is kept for good, so the code can never be reused.
- **Prestmit requests**
  - Each is signed per the confirmed scheme, from the droplet only. The key's IP allowlist holds the droplet's IPv4.
  - The credentials are secret integration settings: `PRESTMIT_API_KEY`, `PRESTMIT_API_SECRET`, `PRESTMIT_WEBHOOK_SECRET`, `PRESTMIT_ACCOUNT_PIN`, plus `PRESTMIT_SANDBOX` and an optional `PRESTMIT_API_URL`. Today's group gains the secret, the PIN and the sandbox switch.
- **Webhooks** follow the existing supplier pattern.
  - `POST /v1/webhooks/prestmit` checks `x-prestmit-signature` in constant time.
  - It stores the body encrypted in `supplier_webhooks` before answering.
  - It only names a sale or purchase, which is **re-read from Prestmit's history** before anything changes.
  - Unknown, unsigned and wrongly signed requests all get the same 401.
- **No double submission (unclear is not failed).**
  - Each sale has one `uniqueIdentifier`, `bc_gs_<sale id>`. It is claimed on the row (`submitting`, with a 3-minute lease) before the call.
  - A timeout or a 5xx leaves the sale `submitting`. The job then looks it up by that identifier and **never sends it again** until Prestmit says it has no such sale. Even then it waits 10 minutes, and admins can confirm by hand.
  - A clear refusal (4xx or 422 before anything was made) fails it with the source's reason in plain words.
- **Money moves once, on acceptance.**
  - Nothing is posted when a card is submitted.
  - Acceptance claims the sale (`pending` to `accepted`, conditional) and posts one entry, `gift_card_sale:<id>`, in the same transaction.
  - A rejected sale posts nothing.
- **Fraud limits** (per market, set by admins, checked under a lock on the customer row):
  - card value per sale, per day and per 30 days;
  - tighter limits for accounts younger than 30 days or with no completed purchase;
  - at most 5 sales waiting review at once;
  - 3 rejections in 7 days pauses selling for 7 days, and admins can lift it;
  - the same person on both sides of a trade, or sharing a payout account, is caught by the existing name and account checks.
  - The new-device check reuses Afrippa's device approach later if needed; not in phase 1.
- **Payout hold.** Bank proceeds wait the country's payout hold, or a sale-specific hold once answer 6 is known. They are counted in `CustomerPayoutsService.held()`, generalised beyond Safe pay entries.
- **Never shown:** Prestmit's name, its rates, references, reasons in its own words, or our margin. Customers and resellers see BitoCard's brand, card names, BitoCard's payout and its own rejection reasons (`card_used`, `card_invalid`, `wrong_card_type`, `unreadable_photo`, `value_mismatch`, `other`, mapped from the source's text where known, else `other` with a neutral sentence).

## Data model (migration `…_gift_card_sales`)

**`sale_sources`** (the sell-side registry, in the shape `PLANS.md`'s planned `supplier_capabilities` suggests)

- A row per supplier able to buy cards: `supplier_code`, `enabled`, and the payout currencies it pays.
- Switched per country, like `supplier_markets` with direction `sell`.

**`sellable_cards`** (synced from each source)

- `supplier_code`, `source_card_id` (Prestmit's subcategory id).
- `brand`, a BitoCard brand slug mapped by name through the brand registry, held back until mapped.
- `card_country` (US, GB, EU, CA, other), `form` (`physical`, `ecode`), `card_currency`.
- `rate_minor` per card unit in the payout currency, `payout_currency`, `minimum`.
- `terms`, kept internal and summarised in BitoCard's words by admins.
- `available` and `seen_at`.
- Admins switch each one on and off, and set its display order.

**`sale_pricing_rules`**

- BitoCard's spread in basis points, per market, brand, card country or form; the most specific rule wins.
- The reseller's spread is capped per market (`PLANS.md`: "the reseller may take a spread on the payout rate, capped by admins"). Resellers set theirs per brand or in general.

**`gift_card_sales`** (`GS-000123`)

- Who and where: `mode`, `customer_id`, `store_id`, `reseller_id` (the seller of record's account: the house account for bitocard.com), `country`.
- The chosen source and card: `sellable_card_id`, `supplier_code`.
- The card: `brand`, `card_country`, `form`, `card_value_minor` with `card_currency`.
- The code: `code_encrypted`, `pin_encrypted`, `code_hint`, `code_fingerprint` (unique across live sales; sandbox codes apart).
- The quote: `quoted_rate`, `quoted_source_amount`, `bitocard_spread_bps`, `reseller_spread_bps`, `quoted_payout_minor`, `payout_currency`, `quote_expires_at`.
- `payout_to` (`wallet` or `bank`), `status`, and `source_reference`.
- Submission: `unique_identifier`, `submitted_at`, `lease_until`, `next_check_at`, `checks`.
- What the source accepted, and the payout: `accepted_source_amount_minor`, `accepted_payout_minor`, `adjusted` with `adjust_reason`.
- Rejection: `reject_reason` (BitoCard's code), `source_reason_encrypted` (admins only).
- `trade_id`.
- Status, cut off by database checks, is one of: `quoted`, `submitting`, `pending`, `accepted`, `rejected`, `failed`, `cancelled`, `expired`.

**`gift_card_sale_files`:** sale, sealed key, type, size, kind (`front`, `back`, `receipt`), and `deleted_at`.

**`gift_card_trades`** (`GT-000123`): sale, the outgoing quote (held to `hold_until`), checkout and order once placed, status (`waiting_card`, `completed`, `card_rejected`, `price_expired`, `failed`), and the difference shown and agreed.

**Ledger**

- **On acceptance**, one entry:
  - Debit `supplier_float` for `prestmit` in NGN or GHS: the money now sitting in our Prestmit wallet, by what it credited.
  - Credit the customer's `customer_wallet` or `customer_withdrawable` by the payout.
  - Credit the reseller's `reseller_earnings_held` by their spread, with an earnings lot.
  - Credit the rest to a new revenue account kind, `gift_card_sale_revenue` (BitoCard's spread), which feeds the P&L.
  - On resellers' own-API sales (phase 5), the credit goes to the reseller's `reseller_earnings_held` in place of a customer account.
- **A withdrawal from our Prestmit wallet to BitoCard's bank** (finance) is a `supplier_funding`-style entry in reverse: credit `supplier_float`, debit `provider_balance` (`manual`). It is recorded with the authenticator or the emailed code, like supplier funding today.
- **Buy-side purchases from Prestmit** post `cost_of_sales` against the same `supplier_float`, so the float nets both directions.

## API

All of this sits in `apps/api` only. It is `@ProductOnly('bitocard')`, because Udozo carries none of BitoCard's digital products.

**Store customers** (`/v1/store/gift-card-sales`, customer sessions, left out of the public OpenAPI document)

- `GET /cards?brand&country&form`: what the store buys, with BitoCard's payout per unit and the minimum.
- `POST /quotes { card_id, value, payout_to }`: the payout, fees in words and the expiry. It needs a confirmed email, and live it also needs the identity check; it fails with `customer_verification_required`.
- `POST /` (multipart): `quote_id`, then either `code` and optional `pin` for an e-code, or photos for a physical card; also an optional receipt and the terms accepted (version). It creates the sale and submits it after the reply. Errors: `quote_expired`, `card_already_submitted`, `sale_limit`, `too_many_pending`, `selling_paused`, `market_unavailable`.
- `GET /`, `GET /:id` (status, payout, reason; never the code), and `POST /:id/cancel` (only while still `quoted`).

**Store customers' trades** (`/v1/store/gift-card-trades`)

- `POST /quotes { card_id, value, product_key, face_value, quantity }` gives both sides and the difference.
- `POST /` takes the sale fields plus `trade_quote_id` and `accept_difference`.
- `GET /:id`.

**Customer cash-out on BitoCard**

- Reopen `/v1/store/cash` for `bitocard` as well as `udozo`: `CustomerCashService` is already shared code.
- The gate (`requireCashOut`) is the confirmed email, a live identity check and the account in the verified name.
- `held()` counts gift card sale credits inside the hold, and the transfer narration names BitoCard rather than "P2P payout".
- The storefront's **Payouts** page comes back under Wallet for markets where bank payouts of sales are on.

**Admins** (`/v1/admin/gift-card-sales`, left out of the OpenAPI document)

- List and filter.
- Each sale with its source reference, the source's reason, photos (audited) and fingerprint matches.
- `recheck`; `resolve` with step-up, for a sale left `submitting` (confirmed not received: fail it; or found: attach the reference).
- The adjusted-payout queue.
- Fraud limits per market; lifting a pause.
- Spreads and the reseller cap, finance with step-up.
- Sellable cards: switches, brand mapping and order.
- The source wallet, `GET /prestmit/wallet`, with balances against the ledger float (a reconciliation flag).
- Withdrawals to BitoCard's bank: finance, step-up, and the `PRESTMIT_ACCOUNT_PIN`. Admins pick a payout bank on our Prestmit profile.

**Resellers**

- **Phase 4 (hosted stores):** SHQ sets their spread (`PUT /v1/pricing/sale-spreads`, capped) and sees their stores' sales: amounts and status, never codes or photos.
- **Phase 5 (own systems):** the API `/v1/gift-card-sales`, scopes `gift_card_sales:read|write`. It takes the reseller's own customer reference, settles to the reseller's wallet, and emits the webhook event `gift_card_sale.updated` (a summary only, never the code).
  - The reference, examples and docs ship in the same change, per the docs rules.
  - Live use needs the reseller to attest to KYC of their own customers.

**Notifications**

- `customer.gift_card_sale.accepted|declined` (exists); `customer.gift_card_sale.adjusted` and `customer.gift_card_trade.completed` (new).
- `admin.gift_card_sale.unclear`, `admin.gift_card_sale.repeat_code` and `admin.prestmit.float_mismatch`.
- Sellers on resellers' stores are told under the store's brand.

## Prestmit adapter (`src/suppliers/prestmit.adapter.ts`)

- **Client:** signing per the confirmed scheme and error shapes normalised into `ProviderError`. Only the source's 4xx before creation counts as `definite`. Its rate-limit headers are respected.
- **New `SaleSource` interface** in `adapter.ts`, beside `SupplierAdapter`. Cardtonic can then join behind the same interface:
  - `saleCatalogue()` gives `sellable_cards` rows;
  - `submitSale({ reference, cardId, value, payoutCurrency, code?, pin?, files })` gives `{ status, sourceReference, rate, amount }`;
  - `saleStatus(reference, sourceReference?)`;
  - `saleRates()`.
- **Buy side:** the usual `catalogue`, `placeOrder` and `orderStatus` (`fetch-codes`), keyed `gift_cards:<country>:<brand>:<currency>` so equivalent cards share products. The cost comes from `calculate-payment` in the payout wallet's currency.
- **The `SupplierAdapters` map** builds it from `integrations.supplier('prestmit')`, like VPNresellers. In the sandbox it gets no credentials. BitoCard's sandbox simulates sales (`SANDBOX-` references, `simulate: accepted|rejected|adjusted`) and never calls Prestmit, as for other suppliers.
- **Test connection** calls `GET /general/service-availability` and reads the wallet balances.

## Screens

**bitocard.com and its country stores:** a **Sell or trade gift cards** entry. On Home and in the Catalog menu it shows only where the market has a sale source on.

- **Sell:** brand, then card country and form, then value. The payout and its 15-minute hold come next, then the payout destination (wallet or bank, as the chain allows).
- **Submitting the card:** the e-code and PIN fields, or photos (camera or file, scaled in the browser with `compressImage`).
- **Before submitting:** the terms.
- **The sale page:** status, the expected review time in plain words, the result, and the change and why when a payout was adjusted.
- **Trade:** the same steps, plus the product to receive, with the difference before confirming.
- **Account:** a **Gift card sales** list under Orders.

**SHQ (phase 4):** Catalogue > **Buying gift cards**, with the spread and the stores' sales.

**Admin:** Orders > **Gift card sales** (queues: waiting, unclear, adjusted, repeat codes), Catalog > **Sellable cards**, Settings > Markets > **Gift card selling** (limits, hold), and Reports with gift card sale revenue in the P&L.

## Phases

0. **Qualification** (no code): the written answers above, the agreement and downstream permission, the sandbox account, the live key with the droplet allowlisted, and lawyers' review (below).
1. **Adapter, catalogue and sandbox sales, admin only.**
   - Build: the client, signing, `SaleSource`, the `sellable_cards` sync (the `catalogue` job), brand mapping, `gift_card_sales` with the submit, requery and webhook paths, and the admin screens.
   - Run sales end to end against Prestmit's sandbox from an admin tool, with no customers yet.
   - Tests: the adapter against a fake Prestmit (sign, submit, timeout then requery, never resubmit), webhook signatures, and the fingerprint refusal.
2. **Customer selling on bitocard.com, Nigeria.**
   - Build: quotes, submission, payout to the wallet, the reopened bank cash-out with the hold, fraud limits, notifications and the storefront screens.
   - Behind the switch `gift_card_selling` (global, country, reseller; **off by default**) and the market's sale source.
   - Pilot with BitoCard staff accounts first.
3. **Trades and Prestmit as a buy-side supplier:** the 4-hour price hold, linked purchase from the proceeds, routing Prestmit's buyable cards by net margin, and Ghana (cedis).
4. **Resellers' hosted stores:** the reseller spread with its cap, SHQ screens, and sales under the store's brand.
5. **Reseller API:** `/v1/gift-card-sales`, docs, events and the SDK samples.
6. **Second sale source:** Cardtonic behind `SaleSource`, routed by best net payout after verification and settlement costs, never routed while a sale is unclear.

Every phase ships its tests: the API on PGlite and Docker, and Vitest for the apps.

## Legal and compliance owed before live sales

- **Customer terms for selling and trading cards**:
  - the customer owns the card lawfully and it is unused;
  - the quote is an estimate until verified;
  - adjusted and rejected outcomes, and that a rejected card is not returned if the issuer has voided it (confirm with Prestmit);
  - forfeiture and reporting for stolen or fraudulent cards;
  - where the money goes, and wallet credit not being withdrawable;
  - the payout hold;
  - for trades, the price hold and the difference.
- **Privacy notice:**
  - card codes, photos and receipts, kept encrypted and deleted after 90 days;
  - the code fingerprint kept for good;
  - the verification partner as a processor;
  - identity checks for sellers;
  - bank details for payouts.
- **Advice per country:** buying gift cards for cash is a recognised fraud and money-laundering channel. Ask:
  - whether selling for withdrawable money needs a licence or registration (CBN rules for Nigeria; Ghana's Bank of Ghana);
  - what AML and KYC monitoring and suspicious-activity reporting BitoCard owes;
  - how VAT applies to BitoCard's spread.
- **Reseller terms (phase 4):** the reseller's spread, their customers' honesty, and losses from fraud on their store.

## Open decisions for the owner

1. Do decisions 1 to 7 above stand, especially paying the source-accepted amount when it is lower, the 4-hour trade hold, and Nigeria first?
2. Should bank payouts of sale proceeds be on at launch, or wallet credit only? Wallet-only is lower risk and closer to store credit.
3. Prestmit as buy-side supplier now, or only once selling works?
4. Starting fraud limits per market (suggested: ₦500,000 per sale, ₦1,000,000 per day, ₦3,000,000 per 30 days; half for new accounts).
