# BitoCard — Feature Plan

The current, consolidated feature brief. It merges `docs/BitoCard-Product-Brief v2.md` (planning baseline 2 October 2026) with the decisions made since. Where the two differ, this file wins; the differences are listed in [Changes from Product Brief v2](#changes-from-product-brief-v2). Engineering rules and constraints live in `AGENTS.md`.

Status labels: **Decided** · **To confirm** (decided in principle, waiting on a supplier, partner or adviser) · **Open** (needs a decision).

Supplier names are internal. Never show them on public pages, in the API or to resellers.

## 1. Product

- BitoCard is a reseller-first digital products and utilities platform owned by Golojan Ltd. **Decided**
- **API-first.** Every capability ships as a public, versioned API before any screen uses it. A reseller can run entirely on their own website, app or back office without a BitoCard storefront. Hosted storefronts, the reseller dashboard, the docs and the admin app all use the same API. **Decided**
- Markets: UK, US and selected African countries, enabled country by country as supplier coverage, payments and operations are ready. No universal coverage is assumed. **Decided**
- **Pilot markets: Nigeria, Ghana and Kenya.** Only resellers based in these countries can sign up during the pilot; others wait until their country is enabled. **Decided**
- Positioning: launch a branded digital-products store in minutes, backed by BitoCard sourcing and fulfilment. Core promises: reliable delivery, transparent rates, a straightforward customer experience. **Decided**

## 2. Users and sign-in

| User | Signs in on BitoCard? | How | Identity check |
|---|---|---|---|
| Admins | Yes, `admin.bitocard.com` | Email + password only (no Google), `@bitocard.com` / `@golojan.co.uk`, 2-step verification required | Staff |
| Resellers and their staff | Yes, reseller dashboard | Google, email + password, or mobile + password (SMS-verified) | **Didit** before approval |
| Reseller systems | API | Scoped API keys: `bc_test_…` sandbox, `bc_live_…` live | Belongs to a verified reseller |
| Hosted storefront customers | No BitoCard account | Per-store account owned by the reseller (Google, email or mobile + password); no guest checkout | Only where required (see below): **BVN** + Flutterwave bank account validation in Nigeria; **Didit** elsewhere |
| Customers of resellers' own systems | No | The reseller's own sign-in; the API sees only the reseller's customer reference | Reseller's responsibility |

All **Decided**. Golojan's own reselling brand is the first tenant on a BitoCard subdomain.

**When customers must verify (Decided).** Whether verification is required is an admin setting per product category and country, which admins can set or unset at any time. Defaults:

- **Not required:** utility products such as airtime, data, pay-TV, electricity and internet/Wi-Fi.
- **Required:** gift cards (buying and selling), virtual numbers and virtual cards, plus wallets and any payout.
- Other categories (for example eSIMs and software): set by admins.

## 3. Catalogue

| Category | Notes | Status |
|---|---|---|
| Gift cards (buy) | Denominations and countries vary | Decided |
| Gift cards (sell and trade) | By storefront customers only, never resellers; quote, verification, settlement only after the source accepts; a trade is a linked accepted sale plus a new purchase | Decided |
| Airtime and data | | Decided |
| Electricity and utility bills | Validate meter/customer number; deliver receipts and electricity tokens | Decided; suppliers to confirm |
| Pay-TV | DStv, GOtv, StarTimes and others; smartcard/IUC validation; renewal vs package change | Decided |
| eSIM data packages | Country, regional and global; top-ups where supported | Decided |
| Software and licences | Consumer software, antivirus, Windows; retail/ESD, OEM and subscriptions kept separate | Decided |
| Virtual numbers, voice, SMS | Capabilities shown per number; Africa, Asia and Europe where supported | Decided |
| Virtual payment cards | Issued to verified storefront customers through a licensed issuer; card details shown only via the issuer's secure display | Decided; issuer approval **To confirm** |
| Domains | Buy through BitoCard (Vercel) or connect an existing domain | Decided |
| Physical goods, Jumia/Konga integrations | | Deferred |

Products, denominations, currencies, payment methods and exchange options vary by country.

## 4. Suppliers and routing

### Rules (Decided)

- Every supplier sits behind a BitoCard-owned adapter interface for its kind (supplier, payment, email, SMS, identity). Adding or removing one never changes the public API.
- **A base adapter for every supplier**, built against its docs and sandbox. Which suppliers are live is admin configuration per country and product, not code. Suppliers without confirmed API access get a stub.
- Normalise equivalent products into BitoCard product IDs, keeping country, denomination and service restrictions.
- Choose purchase sources by availability, net margin after all costs, and fulfilment reliability. Choose gift-card sale sources by best viable net return.
- Route only between sources offering the **same product definition**: country, brand/package, transaction type, and for eSIMs, licences and numbers their full specification.
- Lock customer quotes for their stated validity; a fallback source must honour the quote.
- **Unclear is not failed.** A timeout or ambiguous reply leaves the order pending; requery the same supplier and switch only once it confirms failure. Unresolved orders go to an admin exception queue.
- Phone numbers, eSIMs and software subscriptions stay with their original supplier unless a supported transfer, port or migration is completed.
- **Supplier funding profile** for every supplier: billing model, minimum first deposit, minimum top-up, fees, refunds, and written permission to serve downstream resellers. "Pay per item sold" is not "no minimum deposit".
- BitoCard keeps its own upstream supplier balances funded; reseller wallets alone do not guarantee supplier liquidity. Admins are alerted to low supplier balances.

### Supplier registry (all To confirm)

Every supplier and vendor below gets a base adapter behind the interface for its kind; admins switch each on per country and product. Status: **MVP live** · **MVP qualify** (qualify now; goes live in the pilot once confirmed) · **Pilot** (after a successful pilot) · **Later** · **Backup**.

**Product suppliers**

| # | Supplier | Category | Countries | Status |
|---|---|---|---|---|
| 1 | Reloadly | Gift cards, airtime, data; utility bills | Global; Kenya electricity (KPLC) and TV to confirm in live catalogue | **MVP live** |
| 2 | Prestmit | Gift cards: buy and sell | To confirm | Later (selling phase) |
| 3 | Cardtonic | Gift cards: buy and sell | To confirm | Later (selling phase) |
| 4 | VTpass | Pay-TV, bills | Nigeria | **MVP live** |
| 5 | Interswitch / Quickteller | Pay-TV, bills | Nigeria | MVP qualify (second Nigerian source) |
| 6 | Korba Xchange | Electricity (ECG), Ghana Water, DStv, GOtv, StarTimes | Ghana | **MVP qualify first** (API integration) |
| 7 | Hubtel | Electricity (ECG prepaid/postpaid), Ghana Water, TV | Ghana | **MVP qualify** in parallel (supplier onboarding) |
| 8 | Techlink GH | Electricity (ECG), Ghana Water, TV | Ghana | Backup |
| 9 | KiNG FLEXY GH | Electricity (ECG), Ghana Water, DStv, GOtv, StarTimes | Ghana | Backup |
| 10 | iPay Africa / eLipa | KPLC prepaid/postpaid, DStv, GOtv, Nairobi Water | Kenya | MVP qualify if Reloadly lacks KPLC or TV (docs dated; confirm live) |
| 11 | Tupay | DStv, GOtv, Zuku, StarTimes | Kenya | Backup TV provider (no KPLC published) |
| 12 | Cellulant / Tingg | Bills, pay-TV | Pan-African | Later (expansion) |
| 13 | eSIM Access | eSIM | Global | Pilot (first) |
| 14 | eSimerge | eSIM | Global | Pilot (second) |
| 15 | Airalo Partners | eSIM | Global | Backup |
| 16 | eSIM Go | eSIM | Global | Backup ($1,000 minimum top-up) |
| 17 | Nexway Connect | Software, antivirus | To confirm | Pilot (phase A) |
| 18 | Ingram Micro | Software, Microsoft | To confirm | Later (phase B) |
| 19 | TD SYNNEX | Software, Microsoft | To confirm | Later (phase B alternative) |
| 20 | Pax8 | Business subscriptions | To confirm | Later (phase C) |
| 21 | ALSO Cloud Marketplace | Business subscriptions | Mainly Europe | Later (phase C alternative) |
| 22 | DIDWW | Virtual numbers, SIP, SMS | 90+ countries | Later |
| 23 | Telnyx | Virtual numbers, SMS | Global | Later |
| 24 | Vonage | Virtual numbers, SMS | Global | Later |
| 25 | Twilio | Virtual numbers, SMS | Global | Later |
| 26 | Plivo | Virtual numbers, SMS | Global | Later |
| 27 | Africa's Talking | SMS, short codes, virtual voice | Africa | Later |
| 28 | Flutterwave (cards) | Virtual payment cards | Nigeria pilot | Later (phase 4) |
| 29 | Maplerad | Virtual payment cards | Nigeria | Later (alternative) |
| 30 | Onafriq | Virtual payment cards | Pan-African | Later (expansion) |

**Platform vendors** (also behind adapters)

| Kind | Vendors | Status |
|---|---|---|
| Payments and reserved accounts | Flutterwave (Nigeria, Ghana, Kenya incl. M-Pesa), Monnify (Nigeria), Stripe (UK, US, Europe), others later | MVP: Flutterwave; Monnify to qualify |
| Identity | Didit; BVN and bank validation via Flutterwave | MVP |
| Email | Resend, MailerSend | MVP |
| SMS (sign-in codes) | Termii | MVP |
| Domains | Vercel (registrar and connection); resell.biz (country endings) | MVP: Vercel |
| DNS (branded nameservers) | resell.biz | MVP |
| Exchange rates | Open Exchange Rates (reference rates), checked against Flutterwave's rates | MVP |

**Pilot sourcing paths**

- **Nigeria:** Reloadly (gift cards, airtime, data) and VTpass (pay-TV, bills), with Quickteller as the second source.
- **Ghana:** qualify Korba Xchange first for API integration and approach Hubtel in parallel; Techlink GH and KiNG FLEXY GH are backups. Confirm which ECG meter types (prepaid, postpaid) each enables.
- **Kenya:** query Reloadly's live catalogue for KPLC (prepaid and postpaid) and TV billers first. If either is missing, ask iPay/eLipa to confirm current KPLC and TV availability; add Tupay if a separate TV provider is needed.

### Category plans

- **Pay-TV and bills:** pilot in Nigeria, Ghana and Kenya using the sourcing paths above; other countries only once billers are confirmed per country. Electricity tokens (prepaid) and receipts (postpaid) follow the same validate-then-pay flow. Product = country + brand + package (DStv Nigeria and DStv Ghana are separate products). Validate the smartcard and show the account name and current package before payment.
- **eSIM:** compare identical packages (coverage, networks, data, validity, activation rule, top-ups) at delivered cost. Order on demand, never pre-bought. Show device compatibility first. Deliver QR, manual code and one-tap install links securely; show status, usage and expiry; refunds follow the supplier's unused-eSIM rules.
- **Software:** authorised distributors only. OEM is excluded from the MVP and allowed only with written rights. CSP does not imply standalone Windows keys. Prevent duplicate allocation of one-time keys. Collect committed subscription terms up front or make the reseller liable before selling them.
- **Virtual cards:** pilot in Nigeria with Flutterwave, Maplerad as the alternative, Onafriq for pan-African expansion, all subject to the issuer approving BitoCard's reseller model and terms. Cardholders are verified first; BitoCard never stores card numbers or CVVs; every fee and FX rate is shown before confirmation; cards stay with their issuer.
- **Virtual numbers:** a product is country + number type + capability set; never imply SMS on a voice-only number. Monthly renewals from the reseller wallet, with warnings before release. Collect regulatory documents where a country requires them. Usage is billed after it happens.

Questions to ask each supplier are listed per category in `AGENTS.md`.

## 5. Reseller storefronts and onboarding

- Hosted storefront per reseller: its own tenant with branding, products, customer-facing prices, customers, orders and reports. **Decided**
- Resellers choose products, set retail prices, and see their profit, never supplier costs. **Decided**
- **Markup Protection Scheme:** reseller prices may be at most **50% above BitoCard's wholesale price**, so customers are protected from excessive prices. Admins control the scheme and its cap. **Decided**
- **Fixed-price products** (airtime, data, pay-TV, electricity and other face-value items): resellers can add a markup on top of face value, within the cap. Where admins enable it, they can instead sell at face value and earn the discount BitoCard gives them. **Decided**
- **Gift-card sales by customers:** the reseller can take a spread on the payout rate, capped by admins. **Decided**
- Dashboard: store settings, balances, orders, sales, margins, API keys, webhook endpoints and delivery logs. **Decided**
- **Five-minute setup goal:** verify account, choose store name and subdomain, add branding, select products, accept suggested margins or set prices, preview, publish. Funding, verification and domain activation may take longer. **Decided**
- **Domains:** start on a BitoCard subdomain; buy a domain through BitoCard or connect an existing one; ownership verification, DNS guidance or automatic setup, HTTPS, connection status, renewal reminders, transparent prices, domain charges kept separate in the ledger. Domain setup never blocks subdomain onboarding. Registrar: **Vercel** (Domains Registrar API for buying, Vercel for Platforms for connecting). **Decided**
  - **MVP: only .com can be bought through BitoCard** (Vercel, $11.25 a year at today's price). Other endings and country endings through resell.biz come later. Resellers can still connect an existing domain of any ending. **Decided**
  - Vercel can register common endings (.com, .net, .co, .shop, .store and others) but not country endings such as .co.uk, .ng, .com.ng, .com.gh or .co.ke. Resellers can still **connect** those if they buy them elsewhere. BitoCard's existing **resell.biz** reseller account is the candidate second registrar for country endings, behind the same domain adapter interface (confirm its API and which endings it supports).
  - **BitoCard nameservers. Decided** Branded `ns1.bitocard.com` / `ns2.bitocard.com`, run on **resell.biz**, which supports branded nameservers (confirm its DNS can be managed by API). Any reseller domain, wherever it was bought, can point its nameservers to BitoCard, and BitoCard manages its DNS (behind a DNS adapter, so a second registrar or DNS provider can be added later). Existing records, especially email, are imported first; resellers can manage extra records in the dashboard. A records-only connection (A/CNAME) remains available for resellers who keep their own DNS.
  - Always show the renewal price as clearly as the first-year price: some endings cost $2–3 in year one and $38–44 a year after.

## 6. Money

### Wallets and funding (Decided)

- **Currencies.** BitoCard's base currency is **USD**: its main treasury wallets are in USD. BitoCard also keeps a **country base wallet** in each local currency (NGN, GHS, KES and others), synced with its local bank accounts in that country. Moving money between the USD wallets and a country wallet uses live market exchange rates, refreshed on a schedule.
- **Resellers trade in their own country's currency**; their wallet, prices and earnings are in that currency. Selling internationally (other countries or currencies) requires the Premium plan.
- Each quote locks the exchange rate it used, so the price cannot change between quote and payment.

- **Reseller wallets everywhere.** Topped up through checkout (card or another provider) in any country, plus a reserved bank account where enabled. Wholesale cost must be covered before an order is accepted.
- **Reserved bank accounts through Flutterwave**, starting with Nigeria and Ghana and extending to every country Flutterwave covers (confirm each country first; alternative reserved-account or microfinance bank providers where Flutterwave does not). Every wallet owner, reseller or customer, gets their own account; deposits are matched and synced to the BitoCard wallet once settled.
- **Customer wallets only in reserved-account countries.** Elsewhere customers pay each purchase at checkout. A payment is counted once, either as a wallet credit or as a checkout payment, never both.
- **Payout settings chain:** BitoCard enables options per country (for example gift-card sale proceeds to wallet, bank or both); each reseller chooses from what BitoCard enabled.
- **Reserved accounts:** Flutterwave first in all three pilot countries; Monnify added in Nigeria as a second source, with failover between them.
- **Refunds for failed orders** go to the customer's wallet if they have one, otherwise back to the original payment method.
- **Reseller profit belongs to the reseller** and can be withdrawn to their verified bank account. Each sale's profit becomes withdrawable **15 days** after the sale, and withdrawals need a minimum balance (for example $10 or its local equivalent). Admins set both.
- Payment providers: Flutterwave (Nigeria, Ghana, Kenya, including M-Pesa), Monnify (Nigeria), Stripe and others, chosen by the payer's country and currency. Reserved accounts through Flutterwave and Monnify.
- **Exchange rates** come from **Open Exchange Rates** (hourly reference rates, covering NGN, GHS and KES), checked against the rates Flutterwave actually offers. BitoCard uses the less favourable of the two plus a conversion margin set by admins per currency, so rate movements between quote and settlement never cause a loss; the margin is disclosed. If the two sources differ by more than an admin-set threshold, conversions pause and admins are alerted.

### Ledger (Decided)

- Double-entry ledger in integer minor units; balances come from posted entries, never edited totals.
- Separate accounts for customer balances, reseller cash, reseller earnings, startup allowance, outstanding allowance exposure and the welcome-bonus marketing budget.
- Reserve wholesale cost on order acceptance, settle on fulfilment, release on confirmed failure.
- Record customer price, reseller wholesale cost, supplier cost, FX, fees, tax and margins separately; each party sees only what they are entitled to.
- Currencies kept separate; exchange rates and fees disclosed before any conversion.
- Credit funds only on confirmed payment; all payment and supplier processing is idempotent.

### Promotions

- **$500 startup allowance.** **Decided**
  - One-time: it covers the wholesale cost of customer-paid orders and does not refill. Once used up, the reseller funds their wallet normally.
  - Cannot be spent directly, withdrawn, transferred or paid out.
  - Customers must pay through BitoCard's channels; on settlement BitoCard takes its wholesale cost, the reseller's profit goes to their wallet, and the customer gets the product.
  - Admins can stop or re-enable the programme and revoke a reseller's remaining allowance mid-use.
  - Granted only after Didit verification. The ledger tracks both the lifetime amount used and the outstanding exposure (allowance used on orders whose customer payment has not yet settled), so recovery is auditable.
  - Eligibility is set **per country** and gated by admins. **Decided** Expiry and accounting treatment: confirm with the accountant.
- **$1 customer welcome bonus.** **Decided**
  - In the MVP, off by default, enabled by an admin per reseller (never globally).
  - Once per customer, for eligible digital purchases during the promotional period, with expiry and anti-abuse limits.
  - Funded 100% by BitoCard as a marketing expense, recorded separately from the startup allowance.
- Launch incentives go live only after settlement, recovery and anti-abuse controls are tested. **Decided**

### Plans and fees

- **Standard plan:** free. Chargebacks are absorbed by the reseller (taken from their wallet). **Decided**
- **Premium plan:** a single paid plan, monthly, charged from the wallet, with its price set by admins. BitoCard handles chargebacks and provides priority support including chat, plus further benefits. **Decided** Exact protection terms go in the reseller terms.
- **No API fees.** API features can be restricted by plan, but every feature is enabled on every plan by default. **Decided**

### Commercial model (Decided)

- BitoCard earns the margin between supplier cost and its reseller wholesale price.
- Resellers earn the difference between their retail price and BitoCard's wholesale cost, after fees.
- Domains and additional services can carry disclosed margins. Gift-card exchanges use transparent buy and sell quotes with fees shown.

### Tax

- Calculate and record VAT, GST or sales tax on digital sales by the customer's location, kept separate in the ledger, with compliant receipts. **Decided**
- **BitoCard is the seller of record** for every customer sale, so BitoCard (through the Golojan entity for the region) registers for, collects and pays the tax, and issues the receipts under the reseller's store brand. The reseller's profit is their earnings from the sale. **Decided** Confirm registrations and the reseller's tax position with a tax adviser per country.

## 7. API, docs and webhooks (Decided)

- One unified REST API at `https://api.bitocard.com/v1`, described by OpenAPI. No GraphQL. Sandbox and live share the address; the key decides the mode.
- Admin-only endpoints live in the same API behind admin roles.
- Idempotency keys on every POST; versioned with a changelog.
- **Docs** at `https://docs.bitocard.com`, public and indexed. The reference is generated from the OpenAPI document. "Try it" requires reseller sign-in and runs against the reseller's own sandbox or live account using a short-lived token; live mode is clearly marked and asks for confirmation before anything that spends money.
- **Outbound webhooks:** transactional outbox plus Vercel Queues; signed (HMAC with timestamp); delivered at least once with unique event IDs; retries for up to 3 days; per-endpoint isolation; auto-disable with alerts; delivery log, resend and test events; `GET /v1/events` catch-up; HTTPS only with internal IPs blocked.
- **Every event fully documented** before it ships: event catalogue page, example payload, field reference, step-by-step guide, copy-paste code (Node.js, PHP/Laravel, Python), signature test vector, retry and troubleshooting guides.
- Secrets (eSIM activation codes, licence keys) never appear in webhooks or logs; webhooks announce readiness and the reseller fetches the secret.

## 8. Administration and operations (Decided)

- Supplier configuration and switching per country and product, product mapping, pricing rules and market controls.
- Reseller approval and verification, storefront and domain management, plan and promotion controls.
- Order history, receipts, status, support and the exception queue for uncertain orders.
- Payment, supplier and ledger reconciliation; refunds; margin reporting.
- Recurring items (number rentals, eSIM top-ups, software subscriptions, domain renewals, Premium plans) managed separately from one-time purchases.
- Supplier health, rate changes, low supplier balances and fulfilment exceptions monitored with alerts.
- Role-based administration, full audit history and controlled manual adjustments with a recorded reason.
- Metrics: time to activation, active resellers, paid orders, fulfilment success, delivery time, net margin, funding exceptions, allowance exposure and bonus spend.

## 9. Platform (Decided)

| Area | Choice |
|---|---|
| Frontends | Next.js + React; RTK Query with hooks generated from OpenAPI |
| API | NestJS on Vercel Functions (US region), portable to another host without a rewrite |
| Database | PostgreSQL + Prisma, United States |
| Background work | Vercel Queues, Workflow and Cron; transactional outbox |
| Caching and rate limits | Redis (Upstash, via the Vercel Marketplace): catalogue and price caching, rate limits per API key, short-lived locks. Postgres stays the durable record (ledger, orders, idempotency keys) |
| Email | Resend and MailerSend, either can send |
| SMS (sign-in codes) | Termii |
| Identity | Didit (resellers; customers outside Nigeria); BVN and Flutterwave account validation (Nigerian customers) |
| Payments and reserved accounts | Flutterwave, Monnify, Stripe and others |
| Domains | Vercel (registrar API and Vercel for Platforms) |
| Analytics | BigQuery later, outside the live transaction path |
| Addresses | `api.bitocard.com`, `admin.bitocard.com`, `docs.bitocard.com`, `legals.bitocard.com`, storefronts on `*.bitocard.com` |

Check whether each supplier requires calls from allowlisted IP addresses; if so, enable Vercel Static IPs for the API project.

## 10. Legal and compliance

Update the legals app before each of these goes live (full list in `AGENTS.md`):

- Reseller sign-in and API keys: privacy and cookie notices, Reseller terms, API terms.
- Identity checks: Didit (including face biometrics, which need explicit consent), BVN and bank validation.
- Wallets, reserved accounts and top-ups: take legal advice per country on holding customer balances (e-money or payments licensing, or a licensed partner) before enabling customer wallets.
- Hosted storefront customers: customer sale terms in BitoCard's name (BitoCard is the seller of record), and an agreement with resellers setting out who is controller of which customer data. As the seller, BitoCard is likely a controller of transaction data, not only a processor for the reseller.
- Premium plan, startup allowance and welcome bonus terms.
- eSIM terms; software terms (licence pass-through, refunds, activation); virtual number terms and regulatory documents.
- The Africa-wide waitlist privacy notice (on hold until Legals supplies the text).

## 11. Release plan

1. **Foundation and own-brand pilot.** The public `/v1` API with sandbox, sign-in, API keys, catalogue, wallets and ledger, Flutterwave checkout and reserved accounts, orders and webhooks, admin. Golojan's own storefront is the first client. Live suppliers: Reloadly and VTpass.
2. **Reseller launch.** Reseller onboarding with Didit, hosted storefronts on subdomains, pricing and reports, API keys and public docs, domains, Premium plan. Startup allowance and welcome bonus once their controls are tested. eSIM Access and Nexway after successful pilots.
3. **Selling and more categories.** Gift-card selling and trading by customers; more pay-TV countries; Microsoft licences; virtual numbers.
4. **Broader coverage.** More countries and suppliers, business subscriptions, virtual payment cards (Nigeria pilot with Flutterwave, then wider Africa).

Deferred: physical goods and Jumia/Konga-style integrations.

## Build roadmap

Phase 1, foundation and own-brand pilot:

| # | Milestone | Status |
|---|---|---|
| M1 | API groundwork: Postgres + Prisma, `/v1` with OpenAPI, error format, request IDs and logs, idempotency keys, rate limits, tests | **Done** (needs Neon and Upstash connected on Vercel) |
| M2 | Sign-in and access: accounts, roles, Google, email and mobile sign-in, admin 2-step, API keys | Next |
| M3 | Stores, countries, settings chain, admin switches, plans | |
| M4 | Money core: ledger, wallets, FX, Flutterwave checkout and reserved accounts, payouts, tax | |
| M5 | Supplier adapters and registry, catalogue, pricing rules, quotes; Reloadly and VTpass | |
| M6 | Orders and fulfilment, requery and exception queue, receipts, refunds | |
| M7 | Webhooks: outbox, delivery, retries, events API | |
| M8 | Identity checks: Didit, BVN, bank validation, gating | |
| M9 | Admin app | |
| M10 | Own-brand storefront (Golojan's store) | |
| M11 | Pilot launch: Nigeria, then Ghana and Kenya | |

Phase 2, reseller launch: M12 docs app, M13 reseller dashboard, M14 domains, M15 promotions, M16 reseller launch. Phase 3 onwards: gift-card selling, more bills countries, Microsoft licences, virtual numbers, virtual cards.

## 12. MVP acceptance criteria

- A reseller can create, configure and publish a subdomain store through a short guided flow.
- A reseller can build the same flow on their own system using only the public API and docs, tested in the sandbox.
- Confirmed deposits credit the correct wallet once; concurrent orders cannot overspend available funds.
- A funded order gets a valid quote, reserves funds, reaches a recorded fulfilment outcome and produces a receipt.
- Confirmed failures release or refund funds correctly; uncertain outcomes enter reconciliation.
- Every order event reaches the reseller's webhook endpoint or is visible in their delivery log for resend.
- Reseller and customer data stay isolated across storefronts.
- Admins can trace every order from customer payment through supplier fulfilment and ledger entries.
- Supplier identities and credentials stay internal.
- Startup allowance usage and exposure, and welcome-bonus spend, can be audited separately.

## Open decisions

None. Every product decision for the MVP is made.

Confirm with advisers: startup allowance expiry and accounting treatment (accountant); tax registrations per country as seller of record (tax adviser); data protection roles now that BitoCard is the seller (lawyers).

Waiting on others: resell.biz API and supported country endings (.com.ng, .com.gh, .co.ke); Flutterwave reserved accounts and payment methods in Ghana and Kenya (for example M-Pesa); supplier answers (funding profile, territories, resale rights, sandbox, IP allowlisting); Flutterwave country coverage for reserved accounts; legal advice on customer wallets; the waitlist notice text.

## Changes from Product Brief v2

| Brief v2 | This plan |
|---|---|
| NestJS + Apollo GraphQL; RTK Query over GraphQL | One REST `/v1` API with OpenAPI; RTK Query hooks generated from it; no GraphQL |
| RabbitMQ for background fulfilment | Vercel Queues and Workflow with a transactional outbox (RabbitMQ only if long-running workers are ever needed) |
| Reseller API is a later phase (Phase 4) | API-first: built first, used by every BitoCard app |
| Customers fund accounts and pay from wallets | Customer wallets only in reserved-account countries; checkout elsewhere |
| Flutterwave is an evaluation option | Flutterwave chosen for reserved accounts (Nigeria, Ghana and its other countries), with alternatives where it does not cover |
| Startup credit is recoverable working capital | One-time $500 allowance for customer-paid orders only, no refill, revocable by admins; exposure tracked |
| Welcome bonus proposed | In the MVP, gated per reseller by admins, funded by BitoCard as marketing |
| Storefront subscription fees not assumed | Free Standard plan and a paid Premium plan (chargeback handling, priority support) |
| Chargebacks undefined | Absorbed by the reseller unless on Premium |
| Phase 1: gift cards and top-ups only | Phase 1 live suppliers: Reloadly and VTpass (pay-TV and bills) |
| Verification unspecified | Didit for resellers and non-Nigerian customers; BVN and Flutterwave bank validation for Nigerian customers |
| Not covered | Sign-in rules, docs with live testing, webhook design, US data region, Vercel hosting, email/SMS providers, tax handling, supplier funding profiles |
