# BitoCard Coming Soon Site

## Project purpose

BitoCard is a reseller-first platform owned by Golojan Ltd. It will let approved resellers launch branded storefronts for digital gift cards, mobile airtime, data, and other supported utilities. BitoCard supplies a unified catalogue and fulfilment layer. Resellers serve their own customers, set customer-facing prices, and pre-fund their reseller wallets before taking paid orders.

The intended markets are the UK, US, and selected African countries, enabled country by country as provider coverage, payments, verification, and operations are ready. BitoCard's consumer-facing offering is buying, selling, and trading eligible digital gift cards and buying supported utility products through reseller storefronts.

The planned upstream sources are Reloadly, Prestmit and Cardtonic (gift cards, airtime and data); DIDWW, Telnyx, Vonage, Twilio, Plivo and Africa's Talking (virtual phone numbers, voice and SMS); eSIM Access, eSimerge, Airalo Partners and eSIM Go (eSIM data packages); Nexway, Ingram Micro, TD SYNNEX, ALSO and Pax8 (software and digital licences); Flutterwave, Maplerad and Onafriq (virtual payment cards); and for pay-TV and bills VTpass and Interswitch/Quickteller (Nigeria), Korba Xchange, Hubtel, Techlink GH and KiNG FLEXY GH (Ghana), Reloadly utilities, iPay/eLipa and Tupay (Kenya), and Cellulant/Tingg (wider Africa). The full registry is in `PLANS.md`. BitoCard selects a suitable source internally using availability and net profitability. Do not expose upstream provider identities, costs, credentials, or routing rules to storefront visitors or resellers. BitoCard is API-first: the reseller API is the core product, not a later add-on. Provider coverage, terms, and live access must be confirmed before implementation.

## Product model and planned features

`PLANS.md` is the current, consolidated feature brief. The briefs in `docs/` are historical references; where they conflict with `PLANS.md` or this file, `PLANS.md` and this file win. Keep `PLANS.md` up to date whenever a product decision changes.

### Who uses BitoCard

- **Platform operators (Golojan Ltd):** manage providers, supported markets, product mapping, pricing rules, reseller approvals, transactions, fulfilment exceptions, and support.
- **BitoCard's own store (the parent store):** BitoCard's retail store on the main site, `https://bitocard.com`, with its catalogue at `/catalogs` (by category). It is the reference storefront and the first client of the API; reseller storefronts are clones of it.
- **Independent resellers:** create and manage branded storefronts for their own customers. They interact with BitoCard as their supplier, without selecting or seeing the underlying source.
- **Storefront customers:** browse products, buy digital goods, and, where enabled, submit eligible gift cards for sale or trade.

### Reseller storefronts

- Target a short, self-service store setup: account verification, store name and BitoCard subdomain, branding, product selection, suggested margins or reseller pricing, preview, and launch. **Five minutes is a setup goal**, not a promise that funding, verification, domain propagation, or the first order completes within five minutes.
- Provide a hosted storefront on a BitoCard subdomain first. Allow an optional verified custom domain with HTTPS later. A reseller using BitoCard's storefront gets a **clone of BitoCard's parent store** (same catalogue pages and checkout) under their own brand, prices and domain.
- **Where resellers work:** everything reseller-facing, sign-up included, is in **SHQ (Seller Head Quarters)** at `https://shq.bitocard.com`: sign-up, sign-in and password reset, then store, orders, catalogue and pricing, wallet and withdrawals, API keys and webhooks, team and settings. The main site, `bitocard.com`, is kept for BitoCard's retail customers; it only links resellers to SHQ.
- **Reseller's own integrations (planned):** a verified reseller connects their own supplier accounts and their own country's payment gateways (only integrations BitoCard has built), where three gates allow it: the `own_integrations` switch (off by default; global, country or reseller), the integration marked available to resellers globally or in their country by an admin in the integrations editor, and the connection approved (automatically or after review, set per integration). **The reseller is the seller of record** for sales fulfilled by their own supplier (the seller follows the product's source, not the payment route; BitoCard-sourced products stay BitoCard's), owns that data, and funds their own supplier and gateway accounts; BitoCard never holds those funds. Their supplier is one more source behind the existing pricing (supplier cost from its API + BitoCard's fee = wholesale, + reseller markup), and their offers serve only them. **BitoCard is paid by fees and the subscription, from the reseller wallet:** fee rates in parts per billion (from 0.0000001% to 10%, or zero) per fee kind, category, country and plan, calculated exactly with the sub-unit remainder carried to the next transaction instead of rounded up, held before the order or checkout, taken on success, released on failure, and posted as their own journal entries to a `platform_fees` revenue account. Credentials are stored like BitoCard's and used only for that reseller. Full design in `PLANS.md`.
- Give each reseller control of their customer-facing brand, eligible catalogue, prices or margins, store settings, orders, and reports, subject to platform and market rules.
- Use a **pre-funded reseller wallet**. Require sufficient available balance to cover the BitoCard wholesale cost before accepting an order. A published store may exist before funding, but paid checkout cannot operate until funding and any required verification are complete.
- Keep the reseller's customer relationship and customer-facing support context distinct from BitoCard's upstream supplier relationships.

### Catalogue and transactions

- Present one BitoCard catalogue across supported countries, currencies, denominations, and product types. Initial categories are digital gift cards, mobile airtime, and data; other utilities or virtual cards are future or market-dependent additions.
- **Pay-TV subscriptions** (for example DStv, GOtv and StarTimes) are a planned utility category; see **Pay-TV rollout** below.
- **Virtual phone numbers, voice and SMS** are a planned telecom category; see **Telecom rollout** below.
- **eSIM data packages** are a planned category; see **eSIM rollout** below.
- **Software and digital licences** are a planned category; see **Software and licences rollout** below.
- **Virtual payment cards** are a planned category; see **Virtual cards rollout** below.
- **Buy:** show a final quote, reserve the required balance, submit one fulfilment order, deliver the result, and record the transaction. Release the reservation if an order fails without delivery.
- **Who sells and trades:** gift-card sales and trades are made by **storefront customers** through a reseller's store (or a reseller's own system via the API). Resellers do not sell gift cards to BitoCard themselves.
- **Sell:** where supported, accept an eligible unused gift card for a time-limited quote and verification. Keep the submission pending until the source confirms acceptance; only then settle the customer or reseller balance. Never treat an unverified card as cleared funds.
- **Trade:** treat an exchange as a linked verified sale and new purchase. The incoming card must be accepted before an outgoing product is delivered. Show any value difference and applicable fees before confirmation.
- Availability, exchange methods, funding methods, and final prices vary by market. Do not promise a product or payout route solely because a provider advertises it elsewhere.

### Internal sourcing and switching

- **A base adapter for every supplier.** Build an adapter for each planned supplier against its documentation and sandbox, behind the shared interface for its kind. Which suppliers are live is configuration, not code: each is enabled or disabled per country and product by an admin, and only the suppliers chosen for the MVP are switched on at launch. A supplier without confirmed API access gets a stub adapter until access is confirmed.
- **MVP suppliers:** Reloadly (gift cards, airtime, data) and VTpass (Nigerian pay-TV and bills) are live at launch. eSIM Access (eSIMs) and Nexway (software) join once their pilots succeed. All other adapters are built but switched off.
- **Supplier funding profile.** Record for every supplier how it bills and what it needs up front, and never treat these as the same thing: *pay per item sold* (charged per order) is not *no minimum deposit*. Many suppliers advertise pay-as-you-go but still require a prepaid wallet with a minimum first deposit or minimum top-up. Record: billing model (prepaid wallet, per order, credit terms), minimum first deposit, minimum top-up, payment and FX fees, refunds of unused items, and written permission to serve downstream resellers. Small deposits reduce startup capital; they do not remove prefunding.

- Normalize provider products, country rules, denominations, costs, quotes, order states, and webhook events behind BitoCard-owned interfaces.
- For purchases, choose an eligible available source by **net margin**, after provider cost, FX, fees, and operational constraints; use fulfilment reliability and market eligibility as routing safeguards.
- For incoming gift card sales, route to an eligible source offering the best viable net return after verification and settlement costs.
- Lock the customer-facing quote for its stated validity period. A fallback to another source must still honour that quote and avoid duplicate fulfilment. If neither is possible, fail clearly and release the wallet reservation.
- **Unclear is not failed.** A timeout, network error or ambiguous supplier response leaves the order pending. Query the same supplier for its status (with backoff) and switch to another source only once that supplier confirms the transaction failed. Never retry with a second source while the first may still complete, because the customer could be charged twice. Unresolved orders go to an admin exception queue.
- Keep provider identities, credentials, cost prices, internal routing decisions, and supplier-specific error details out of reseller and customer interfaces and the reseller API.

### Pay-TV rollout

Pay-TV suppliers are subscription-payment sources: BitoCard pays the customer's subscription with the TV operator through them.

1. **Pilot: Nigeria, Ghana and Kenya.** Nigeria: VTpass and Interswitch/Quickteller. Ghana: Korba Xchange first, Hubtel in parallel (Techlink GH and KiNG FLEXY GH as backups). Kenya: Reloadly utilities first; iPay/eLipa if Reloadly lacks KPLC or TV; Tupay as a separate TV provider if needed. Electricity (ECG, KPLC) and water bills follow the same rules as pay-TV.
2. **Then other African countries** via Cellulant/Tingg and others. Never assume continent-wide availability: enable each country only once a supplier confirms its billers there.

Ask each supplier, and record the answers before building its adapter:

- Enabled countries, TV brands and packages.
- Wholesale commission, fees and minimum funding.
- Written permission to serve downstream resellers under BitoCard.
- Smartcard/IUC validation, renewal versus package change support, and how pending payments are resolved (status query, callbacks).
- Sandbox access and any IP allowlisting.

Catalogue and routing rules:

- A product is a **country, brand and package**: DStv Nigeria and DStv Ghana are separate products, as are their packages.
- Each order has a **transaction type**: renewal of the current package, or package change.
- Before payment, validate the smartcard or IUC number with the supplier and show the returned account name and current package for the customer to confirm.
- Route only between sources that support the same country, package and transaction type.
- Timeouts follow the "Unclear is not failed" rule: keep the order pending and requery its status before switching suppliers. VTpass explicitly requires requerying unclear or timed-out transactions.

### Telecom rollout

Telecom products work differently from one-off purchases:

- **Recurring:** numbers are monthly subscriptions, renewed automatically from the reseller wallet; a failed renewal must warn before the number is released.
- **Regulated:** many countries require the end user's identity or address documents before a number is activated. Resellers need a way to collect and submit them, and the API must expose each product's requirements.
- **Billed after use:** calls and SMS are charged after they happen, not quoted upfront.

Suppliers (all to be confirmed):

| Supplier | Offering | Notes |
|---|---|---|
| DIDWW | International virtual numbers (90+ countries), SIP trunks, voice and SMS, OTP; API provisioning | Strong candidate for wholesale number resale. SMS capability varies by number. |
| Telnyx | Global numbers, SMS API, programmatic provisioning | Check its separate voice and SMS coverage filters. |
| Vonage | Virtual numbers for messaging and calls | Publishes an SMS-number matrix by country. |
| Twilio | SMS-enabled numbers, messaging APIs | Confirm inbound SMS and international reach per number type. |
| Plivo | Voice and SMS business numbers | Catalogue separates voice-only from SMS-capable numbers. |
| Africa's Talking | African SMS, two-way short codes, virtual voice | Regional complement; short codes and virtual voice numbers are separate services. |

Ask each supplier, and record the answers before building its adapter: enabled countries and number types; voice, inbound SMS and outbound SMS capability per number type; monthly and usage pricing, fees and minimum funding; written permission to resell to downstream resellers under BitoCard; regulatory document rules per country; porting and release rules; sandbox access and any IP allowlisting.

Catalogue and routing rules:

- A number product is a **country, number type (local, mobile, national, toll-free) and capability set** (voice, inbound SMS, outbound SMS). Show capabilities explicitly; never imply SMS on a voice-only number.
- Route only between sources offering the same country, number type and capabilities, and that accept the same regulatory documents.
- Once provisioned, a number stays with its supplier: renewals and usage go to that supplier, never re-routed.
- These suppliers sell products to resellers; they are separate from Termii, which BitoCard uses for its own sign-in codes.

### eSIM rollout

eSIM data packages for travellers and secondary lines, sold on demand (never pre-bought stock).

Suppliers, in order of evaluation (all to be confirmed):

| Supplier | Published model | Status |
|---|---|---|
| eSIM Access | API ordering and top-ups; no minimum order, no monthly or setup fee, free activation | **First choice.** Confirm the smallest wallet deposit and payment fees, then pilot. |
| eSimerge | REST API, webhooks; no monthly fee, no minimum order, no minimum deposit advertised; prepaid wallet, credit terms advertised | **Second.** Request a sandbox; validate access and fulfilment with a small pilot. |
| Airalo Partners | API for packages, orders and installation instructions; minimum selling price applies | Alternative; small or no-deposit entry not verified. |
| eSIM Go | Prepaid API; docs state a $1,000 minimum top-up (other docs say limits vary by account) | Poor fit for launch unless a lower minimum is agreed. |

Ask each shortlisted supplier: minimum funding (first deposit and top-up), every fee, refunds for unused eSIMs, top-up support, usage reporting (API or webhook), sandbox access, IP allowlisting, and written permission to serve multiple downstream reseller storefronts.

Choose the cheapest supplier by comparing **identical packages**, not public claims: same coverage, networks, data allowance, validity, activation rule and top-up support, at the delivered cost after fees and FX.

Product model:

- A package is defined by **coverage** (one country, a region or global), included networks, data allowance (or unlimited with its fair-use limit), validity in days, **activation rule** (validity starts at purchase, at installation or at first connection), speed, hotspot support, top-up support, and any included voice or SMS.
- Route only between suppliers whose packages match on all of these.
- Show device requirements before purchase: an eSIM-capable, carrier-unlocked device.

Order flow:

1. The reseller's wallet (or the startup allowance) covers the wholesale cost; the customer pays the reseller's price.
2. BitoCard reserves the wholesale cost and orders the eSIM from the supplier on demand. Timeouts follow "Unclear is not failed".
3. Deliver the installation details securely: QR code, manual activation code (SM-DP+ address and matching ID), and one-tap install links where the device supports them, with step-by-step activation instructions.
4. Show status (not installed, installed, active, expired), data usage and remaining validity, and offer top-ups where supported.

Rules:

- **Activation codes are secrets.** An eSIM can be installed only once, so whoever holds the code owns the eSIM. Encrypt codes at rest, return them only on the owning reseller's order endpoint, never put them in webhook payloads or logs (webhooks say the eSIM is ready and the reseller fetches it), and never re-send them to a changed email address without checks.
- **An eSIM stays with its supplier.** Top-ups and usage always go to the supplier that issued it (keyed by ICCID), never re-routed.
- **Refunds follow the supplier's rules:** typically only unused, uninstalled eSIMs within a window. Show the refund rule before purchase.
- Before selling, update the legal documents: eSIM terms (refunds, device compatibility, fair use) and the privacy notice (ICCID, usage data, the eSIM suppliers).

### Software and licences rollout

Only buy from authorised distributors; never source grey-market keys. API availability is verified for the shortlist below; a zero-deposit or low-cost start is not yet confirmed for any of them.

| Supplier | Suited to | Phase |
|---|---|---|
| Nexway Connect | Downloadable consumer software and antivirus; ordering and download/key delivery via its Connect API | **A: first** |
| Ingram Micro | Broad software distribution, Microsoft; reseller APIs and Cloud Marketplace API (approval and sandbox) | **B**: Microsoft retail/ESD (choose Ingram or TD SYNNEX) |
| TD SYNNEX | Software distribution; Digital Bridge (products, pricing, orders) and StreamOne (cloud subscriptions, billing) APIs | **B**: alternative to Ingram |
| Pax8 | Recurring business software and cloud subscriptions; public APIs and webhooks | **C**: business subscriptions |
| ALSO Cloud Marketplace | Microsoft cloud and business security subscriptions (for example Sophos), mainly Europe | **C**: alternative to Pax8 |

Ask each supplier in writing before choosing it:

- **Multi-tier resale rights:** can BitoCard supply independent resellers selling under their own brands?
- **Countries:** UK, US and each intended African market, including export or sanctions restrictions.
- **Funding:** minimum deposit, monthly fees, minimum orders, credit and payment terms (record in the supplier funding profile).
- **Fulfilment:** instant key, activation link, download, or provisioning into the customer's account.
- **Commercial terms:** margins, failed activations, refunds, renewals and cancellation commitments.

Licence types are separate catalogue channels, never interchangeable:

- **Retail/ESD:** genuine standalone licences with electronic delivery. The default for consumer software, including Windows.
- **OEM:** device-bound; Microsoft ties OEM licence transfers to the licensed device. Do not sell OEM licences to end customers unless a supplier grants explicit written rights, and then show the device conditions before purchase. Excluded from the MVP.
- **CSP and other subscriptions:** eligible perpetual software and subscriptions provisioned into the customer's own tenant or account (for example Microsoft 365). CSP does not imply standalone Windows Home/Pro keys; confirm each SKU and whether it needs an existing qualifying licence. Microsoft requires the customer's acceptance of its customer agreement.

Product model and routing:

- A licence product is defined by publisher, product and edition, **licence type**, **term** (perpetual, monthly, annual), **device or user count**, region lock, platform and language, and **fulfilment type**.
- Route only between suppliers matching licence type, region, term and device or user count.
- A subscription stays with its original supplier for renewals, changes and cancellation, unless an explicit migration process exists.

Rules:

- **Keys and activation links are secrets**, handled like eSIM activation codes: encrypted at rest, shown only on the owning reseller's order endpoint, never in webhooks or logs.
- **Refunds:** a revealed or delivered key is normally non-refundable; failed activations go through the supplier's replacement process. Show the rule before purchase.
- **Subscription commitments:** some subscriptions (for example Microsoft's annual terms) cannot be cancelled after a short window, and BitoCard owes the supplier for the full term. Collect the commitment up front or make the reseller liable for it in the reseller terms before selling committed subscriptions; follow each supplier's cancellation window exactly.
- **Renewals** are charged from the reseller wallet, with warnings before a renewal fails or a subscription lapses.
- Before selling, update the legal documents: software terms (end-user licence pass-through, refunds, activation), the privacy notice (licence and account data, the suppliers), and check digital-services tax (for example UK and EU VAT) on sales to consumers.

### Virtual cards rollout

Virtual payment cards issued to storefront customers through a licensed card issuer. Every partner choice depends on the issuer approving BitoCard's reseller distribution model and commercial terms in writing.

| Partner | Role |
|---|---|
| Flutterwave | **First choice** for a Nigeria-focused pilot |
| Maplerad | Alternative for Nigeria |
| Onafriq | Pan-African expansion conversation |

Ask each issuer, and record the answers before building its adapter: approval of the multi-reseller model, card currencies (naira and dollar cards) and current regulatory status, cardholder verification requirements, fees (issuance, monthly maintenance, funding, FX, declines, termination), funding and spending limits, dispute and chargeback handling, card termination and balance return, transaction webhooks, sandbox and IP allowlisting.

Rules:

- **The issuer owns the card programme.** BitoCard distributes; the cardholder accepts the issuer's cardholder terms. Cards stay with their original issuer for life.
- **Cardholders are verified before issue** (BVN in Nigeria, Didit elsewhere, plus whatever the issuer requires).
- **Never store or log card numbers, CVVs or PINs.** Show card details only through the issuer's secure display (for example a hosted iframe or one-time token), so BitoCard stays out of PCI DSS card-data scope. The API returns only masked numbers and card IDs.
- Funding a card, its fees and FX are separate ledger entries; show every fee and the exchange rate before the customer confirms.
- Support freeze, unfreeze and terminate; on termination, return any remaining balance to the customer's wallet or bank account according to the payout settings chain.
- Card transactions arrive by issuer webhook and are processed idempotently; declines and disputes are shown to the customer and reseller.
- Before selling, update the legal documents: card terms (pointing to the issuer's cardholder agreement), the privacy notice (the issuer, cardholder data) and fee disclosures.

### Wallet, records, and operations

- Keep a durable, auditable transaction ledger for funding, pending funds, available funds, reservations, debits, releases, refunds, settlements, fees, and reseller margins. Do not use a client-side balance as the source of truth.
- Credit wallet funds only after a payment is confirmed. Make provider orders and webhook handling idempotent so retries cannot charge or fulfil twice.
- Record the customer price, reseller wholesale cost, BitoCard supplier cost, applicable fees/FX, and resulting margins separately. Show each party only the amounts they are entitled to see.
- Provide order history, status updates, receipts, exception review, support workflows, and admin reconciliation.
- Add identity checks, fraud controls, payment integration, market-specific terms, and provider agreements before accepting real funds or gift card codes.

### Reseller API (API-first)

BitoCard is API-first. Every capability is built as a public, versioned API before any screen uses it, so a reseller can run entirely on their own website, app or back office without a BitoCard storefront. Hosted storefronts, the reseller dashboard and BitoCard's own store are clients of that same API, with no private shortcuts.

- Offer authenticated, scoped access to the catalogue, availability, quotes, order creation, order status, wallet balance and signed webhooks.
- Apply the same pricing, funding, routing and data isolation rules whether an order comes from a hosted storefront or a reseller's own system.
- Resellers own their end customers: the API accepts the reseller's own customer reference and does not require customers to hold BitoCard accounts.
- Give every reseller a sandbox with test keys and simulated fulfilment.
- Never expose upstream provider APIs, identities or costs.

### API documentation (`apps/docs`)

- The API documentation is public at `https://docs.bitocard.com` (indexed by search engines) and hosted only in `apps/docs` (Next.js): guides, the full API reference, webhook events, errors, changelog and sandbox behaviour.
- The reference is generated from the API's own OpenAPI document, never written by hand, so docs and API cannot drift. A change to a public endpoint ships with its docs in the same change.
- Reading the docs needs no account. Calling the API from the docs ("Try it") requires the reseller to sign in; it then runs against that reseller's own **sandbox** (simulated fulfilment) or **production** account. Requests go from the browser straight to the API.
- Production calls from the docs are real: they can debit wallets and fulfil orders. Default to the sandbox, clearly mark live mode, require explicit confirmation before any live write, and offer a read-only option for production testing.
- "Try it" uses a short-lived, tenant-scoped token issued from the reseller's sign-in, never a pasted or stored API key. Never send tokens to the docs server, log them or store them.

### Platform decisions

- **Stack:** Next.js + React + RTK Query clients; NestJS API; PostgreSQL + Prisma. No GraphQL.
- **One unified REST API:** `/v1`, described by OpenAPI, chosen for speed and scale (CDN-cacheable reads, simple rate limits, works from any language). Reseller systems, hosted storefronts, SHQ (the reseller dashboard), the docs and the admin app all use it; admin-only endpoints sit in the same API behind admin roles. The RTK Query hooks are typed by hand against the API presenters, in `@bitocard/api-client/admin` (admin endpoints, which are left out of the OpenAPI document) and `@bitocard/api-client/reseller` (SHQ), because the OpenAPI document does not describe responses yet; keep them in step when a presenter changes, and generate them from the document once it has response schemas.
- **Vendor aggregation:** BitoCard aggregates many vendor and partner APIs (gift cards, airtime, data, utilities, payments, email, SMS) behind its own unified API. Each vendor is a server-side adapter implementing a BitoCard-owned interface for its kind (supplier, payment, email, SMS), so adding or removing a vendor never changes the public API. Vendor credentials, raw responses and errors stay inside the adapter; the public API returns only BitoCard's own models and error codes.
- **Sign-in:** resellers (and hosted storefront customers) can use Google, email + password or mobile number + password; a mobile number is verified by SMS code before it can sign in. Admins cannot use Google (see Admin address). Reseller systems use scoped API keys (test and live).
- **Who signs in on BitoCard:** only resellers (and their staff) and BitoCard admins hold BitoCard accounts. End customers never do.
- **Customers belong to the reseller:** customers are authenticated at the reseller's end. Resellers on their own systems use their own sign-in and pass their own customer reference to the API. Hosted storefronts have no guest checkout: customers sign in before ordering, with accounts scoped to that one store and owned by its reseller (an account at one store does not exist at another).
- **Pilot markets:** Nigeria, Ghana and Kenya; only resellers based there can sign up during the pilot.
- **Reserved-account order:** Flutterwave first in all pilot countries; Monnify as a second Nigerian source with failover.
- **Failed-order refunds:** to the customer's wallet if they have one, otherwise to the original payment method.
- **Currencies:** BitoCard's base currency is USD (main treasury wallets). It also keeps a country base wallet in each local currency, synced with its local bank accounts; conversion between the USD wallets and country wallets uses live market rates refreshed on a schedule. Resellers trade in their own country's currency; selling internationally requires the Premium plan. Every quote locks the exchange rate it used.
- **Customer verification is gated per category and country by admins.** Defaults: not required for utilities (airtime, data, pay-TV, electricity, internet/Wi-Fi); required for gift cards (buy and sell), virtual numbers, virtual cards, wallets and payouts; other categories set by admins.
- **Reseller pricing:** markup on top of face value within the Markup Protection Scheme cap; where admins enable it, selling at face value and earning BitoCard's discount instead. On customer gift-card sales, the reseller may take a spread on the payout rate, capped by admins.
- **Exchange rates:** Open Exchange Rates for reference rates, checked against Flutterwave's offered rates. Use the less favourable rate plus an admin-set margin per currency (disclosed), so conversions never lose money; pause conversions and alert admins if the two sources diverge beyond a threshold.
- **Supplier registry:** the full list of suppliers and vendors, their countries and pilot status is in `PLANS.md` (section 4). Every one gets a base adapter.
- **Reseller payouts:** each sale's profit becomes withdrawable 15 days after the sale, with a minimum withdrawal amount (for example $10 or local equivalent); admins set both.
- **SHQ address:** `https://shq.bitocard.com` (private, never indexed): all reseller authentication (sign-up, sign-in with Google, email or mobile number and password, password reset, team invitations) and the reseller back office. Resellers never sign up on the main site, which is for retail customers.
- **Admin address:** `https://admin.bitocard.com` (private, never indexed). Admins have no Google sign-in: email + password only, limited to `@bitocard.com` and `@golojan.co.uk` addresses (checked server-side), with 2-step verification required.
- **API address:** `https://api.bitocard.com` for both sandbox and production. The key decides the mode (`bc_test_…` sandbox, `bc_live_…` live); test data is kept separate from live data and never touches real suppliers or money.
- **Domains:** MVP sells **.com only**. Vercel is the registrar (Domains Registrar API) and connects reseller domains to storefronts (Vercel for Platforms). It cannot register country endings such as .co.uk, .ng, .com.ng or .co.za; resellers can still connect those. Keep the domain registrar behind an adapter interface; BitoCard's resell.biz reseller account is the candidate second registrar for country endings. Always show renewal prices as prominently as first-year prices.
- **BitoCard nameservers.** Branded `ns1.bitocard.com` / `ns2.bitocard.com` on resell.biz, which supports branded nameservers (manage its DNS by API). A reseller's domain, bought through BitoCard or anywhere else (including .ng and .co.uk), can point its nameservers to BitoCard, and BitoCard then runs its DNS through a DNS adapter interface. When taking over a domain, import its existing records first (especially email MX, SPF and DKIM) so nothing breaks, and let resellers manage their own extra records in the dashboard. Also offer a records-only connection (A/CNAME) for resellers who keep their own DNS.
- **Caching:** Redis (Upstash via the Vercel Marketplace) for catalogue and price caching, per-key rate limits and short-lived locks. Postgres remains the durable record for the ledger, orders and idempotency keys.
- **SMS:** Termii, behind the SMS adapter interface, for mobile verification and sign-in codes.
- **Email:** Resend and MailerSend, behind one email interface so either can send. Configure SPF, DKIM and DMARC for each sending domain.
- **Reseller wallets everywhere.** Every reseller has a wallet so wholesale cost is always covered before an order. They top it up through checkout (card or another payment provider) in any country, and also through their own reserved bank account where reserved accounts are enabled.
- **Reserved bank accounts.** Provided through Flutterwave (and Monnify in Nigeria), starting with Nigeria and Ghana and extending to every country where Flutterwave offers them (confirm each country with Flutterwave before enabling it). Where enabled, every wallet owner, reseller or customer, gets their own reserved account. Live reseller accounts are also gated per reseller by an admin (the `reserved_accounts` switch, off by default), and in Nigeria the owner's BVN must first pass a check with Flutterwave whose name matches the verified owner. Deposits are received from the provider connection, matched to the owner and synced to their BitoCard wallet; credit only on confirmed settlement, idempotently.
- **Customers pay at checkout where reserved accounts are not enabled.** Customer wallets exist only in reserved-account countries; elsewhere each customer purchase is paid at checkout.
- **$500 startup allowance (market-entry promotion).** A one-time promotional allowance that lets an eligible new reseller start selling without pre-funding their wallet.
  - It covers only the wholesale cost of **customer-paid orders**. The reseller cannot spend it directly, withdraw it, transfer it or have it paid out. The ledger keeps it in its own restricted account, never counted as cash.
  - It does **not** refill: each order uses up its wholesale cost. Once it is used up, the reseller funds their wallet as normal.
  - Customers must pay through BitoCard's payment channels. When payment settles, BitoCard keeps its wholesale cost, the reseller's profit goes to their wallet, and the customer receives the product.
  - Admins can stop or re-enable the programme and revoke any reseller's remaining allowance at any time, including mid-use.
  - Reseller verification must come before any allowance is granted. Eligibility is set per country and gated by admins; expiry and accounting treatment must be confirmed with the accountant before launch.
- **Reseller profit belongs to the reseller** and can be withdrawn to their verified bank account.
- **Chargebacks are absorbed by the reseller** (taken from their wallet), unless they subscribe to the Premium plan.
- **Reseller plans.** A free standard plan and a single paid monthly **Premium plan** (price set by admins, charged from the wallet). Premium adds chargeback handling and protection by BitoCard, priority support including chat, and further benefits. There are no API fees: API features can be restricted by plan, but all are enabled on every plan by default.
- **Markup Protection Scheme.** Reseller prices may be at most 50% above BitoCard's wholesale price. Admins control the scheme and the cap; enforce it in the API, not only in the dashboard.
- **$1 customer welcome bonus.** In the MVP but fully gated: off by default, and an admin enables it per reseller (never globally). It applies to eligible purchases during the promotional period, once per customer. It is funded 100% by BitoCard as a marketing expense, recorded separately from the startup allowance, with expiry and anti-abuse limits.
- **Settings chain for payout options.** BitoCard enables the options per country (for example, gift-card sale proceeds to the customer's wallet, to their bank account, or both); each reseller chooses from what BitoCard has enabled for their store. A reseller can never switch on an option BitoCard has not enabled.
- **Identity checks.** Resellers are verified with **Didit** before approval (and before any allowance). Customers are verified with **BVN** checks and **bank account validation through Flutterwave** (account name matched before any payout). BVN exists only in Nigeria; customers in other countries are verified with Didit.
- **Tax.** **BitoCard is the seller of record** for every customer sale of its own products, in every channel (the reseller is, for sales fulfilled by their own supplier; see Reseller's own integrations): it registers for, collects and pays VAT, GST or sales tax by the customer's location (through the Golojan entity for the region), keeps tax separate in the ledger, and issues compliant receipts under the reseller's store brand. Confirm registrations per country with a tax adviser.
- **Payments:** multiple providers (Flutterwave, Monnify, Stripe and others), each behind one payment adapter interface, chosen by the payer's country and currency. Credit a wallet only after the provider's signed webhook confirms payment; handle each webhook idempotently.
- **Data region:** United States. Keep the database and the API's Vercel Functions region together. The privacy notice must name these processors and the US storage location before any personal data is collected.

### Hosting

- The API runs on **Vercel Functions** (its own Vercel project, `apps/api`), with Vercel Queues, Workflow and Cron for background work, alongside the frontends.
- Before building each vendor adapter, confirm whether the vendor requires calls from allowlisted IP addresses. If any do, enable Vercel Static IPs for the API project; if the plan cannot provide them, that is the trigger to reconsider hosting (for example DigitalOcean).
- Keep the API portable: standard NestJS, no Vercel-specific code in business logic, queues behind an interface, Postgres through Prisma. Moving hosts must be a deployment change, not a rewrite.

### Outbound webhooks to resellers

- **Transactional outbox:** write each event to an outbox table in the same database transaction as the change it describes, then dispatch it through Vercel Queues to the delivery function. Postgres stays the record of every delivery; queue messages only say when to look at an endpoint, so a lost or repeated message is harmless and the `webhooks` cron (every 5 minutes) catches anything missed. Off Vercel (local, Docker, tests) the same code delivers straight after each commit instead. Do not use RabbitMQ or Redis Streams unless long-running workers are introduced; then swap them in behind the same interface (`WebhookQueue`).
- Log every delivery attempt (status, response code, timing) in Postgres.
- **Signed:** HMAC-SHA256 over the timestamp and body with a per-endpoint secret; reject anything older than 5 minutes; rotate secrets with an overlap window.
- **At least once:** every event has a unique `id`; tell resellers to ignore IDs they have handled. Order is not guaranteed, so include the object's version or `updated_at`.
- **Retries:** about 1 min, 5 min, 30 min, 2 h, 6 h, then every 12 h for up to 3 days, with jitter. 10-second timeout; any 2xx is success.
- **Isolation:** a concurrency limit per endpoint, so one slow reseller never delays others. Disable an endpoint after 3 days of failures and alert the reseller by email and in the dashboard.
- **Self-service:** delivery log, resend and test-event buttons in the dashboard; the sandbox sends test events.
- **Catch-up:** `GET /v1/events?since=…` lets resellers fetch anything they missed; the API, not the webhook, is the source of truth.
- **Safe destinations:** HTTPS only; block private and internal IP addresses when an endpoint is saved and again at every delivery.
- **Documented so any reseller can implement them.** An event without complete docs does not ship. In `apps/docs`:
  - Define every event in the OpenAPI document's `webhooks` section, so its reference is generated, never hand-written.
  - **Event catalogue:** one page per event type (for example `order.completed`) covering when it fires and when it does not, which object it carries, a full realistic example payload, every field with its type and meaning, and which events can come before or after it.
  - **Step-by-step guide:** create an endpoint, verify the signature, acknowledge fast and process later, ignore duplicate IDs, handle out-of-order events, then catch up with `GET /v1/events`.
  - **Copy-paste code** for receiving and verifying, at least in Node.js, PHP (including Laravel) and Python.
  - **Signature test vector:** a published secret, timestamp, body and expected signature, so resellers can check their own code.
  - **Delivery details:** headers, retry schedule, timeouts, auto-disable rules and sandbox test events.
  - **Troubleshooting:** common failures with their fixes.
  - **Versioning:** payload versions and a changelog. Adding fields is not a breaking change; removing or renaming one is.

### Legal updates owed

Update the legals app (`apps/legals`) **before** each of these goes live, and bump `legalUpdated`:

- **Reseller sign-in and API keys:** privacy notice (reseller account data, US storage, processors: database host, Vercel, Resend, MailerSend, Termii, payment providers; mobile numbers), cookie notice (strictly necessary session cookie on `.bitocard.com`), and new **Reseller terms** and **API terms**.
- **Wallet top-ups, reserved accounts and payouts:** reseller terms (pre-funding, top-ups not withdrawable, the payout hold and minimum, the 24-hour wait on new bank accounts, refunds, chargebacks, Premium billing and its grace period) and the privacy notice (Flutterwave and Monnify as processors; the owner's BVN checked with Flutterwave and held encrypted only until their reserved accounts are opened, then erased; payout bank details encrypted).
- **Identity checks:** privacy notice for Didit (ID documents and likely face biometrics, a special category needing explicit consent), BVN and bank account validation, with retention periods.
- **Reseller plans and promotions:** Premium plan terms (price, chargeback protection, cancellation), startup allowance terms (eligibility, revocation) and welcome bonus terms.
- **Customer wallets and reserved accounts:** take legal advice per country on holding customer balances (e-money or payments licensing, or a licensed partner holding the funds) before enabling them; add customer wallet terms and the banking partners to the privacy notice.
- **BitoCard as seller of record:** customer sale terms in BitoCard's name (refunds, delivery, the regional Golojan entity), receipts, and a review of data protection roles: as the seller BitoCard is likely a controller of transaction data, not only a processor for the reseller.
- **Reseller's own integrations:** reseller terms making the reseller seller of record for sales fulfilled by their own suppliers, a data processing agreement (BitoCard processes that data for them), the fees with their exact calculation and the subscription; the privacy notice for credentials held on resellers' behalf; tax advice on BitoCard's fees and subscriptions.
- **Hosted storefronts with customer accounts:** an agreement with resellers setting out who is controller of which customer data (BitoCard, as seller of record, is likely a controller of transaction data; the reseller controls its own marketing and relationship data), and guidance that each reseller needs its own customer-facing privacy notice for what it controls.
- **Waitlist:** the Africa-wide waitlist privacy notice (on hold until Legals supplies the text and its effective date).

## Release sequence

1. Build the public API first and prove it with BitoCard's own reselling storefront as its first client: accounts, API keys, catalogue, funding, ledger, buying, routing, fulfilment, support and administration.
2. Open reseller onboarding: API keys and sandbox for resellers using their own systems, and hosted storefronts on BitoCard subdomains (branding, pricing, reports, optional custom domains) for those who are not.
3. Add eligible gift card selling and linked trades, in the API and the storefronts together, where provider verification and settlement flows are ready.

## Current deliverable

This repository currently contains a **coming soon page**, not the trading platform. The coming-soon page is a compact, mobile-first, single-screen desktop layout in `apps/storefront/app/page.tsx`. `apps/storefront/public/bitocard-logo.png` is the approved logo and site icon. The two information actions, **How it works** and **For resellers**, open native HTML dialogs. Keep keyboard focus, Escape closing, accessible dialog labels, and a usable mobile layout intact.

The page must communicate that the product is coming soon. Do not add a working signup form, wallet, checkout, live prices, supplier catalogue, or claims of active fulfilment unless the necessary backend and provider integrations are implemented. A storefront mockup is illustrative.

## Brand and copy

- Name: **BitoCard**; ownership credit: **A Golojan Ltd venture**.
- Preferred icon: the user-supplied interlocking B/exchange-arrow mark, with its original dark navy areas and the original yellow areas changed to vivid pink. Keep the recognisable shape and transparent background. Before the next visual release, align the site icon with this latest approved navy-and-pink treatment.
- On navy backgrounds (the admin and SHQ sign-in panels and the console rail) use the light logo, `public/bitocard-logo-light.png` in `apps/admin` and `apps/shq`: the same mark with its navy areas white and the pink kept. It is generated from `bitocard-logo.png` (navy blended to white by colour, 512 px), so regenerate it whenever the logo changes. Use the normal logo on white.
- Approved tagline: **Digital store in 5 minutes** (numeral "5"), shown directly beneath "BitoCard" in the storefront header, with the logo icon flush left spanning both lines. It refers to the store setup goal; keep the on-page note that verification and funding may take longer. Use a clean, confident navy-and-pink palette with ample white space. Avoid adding other slogans or claims of guaranteed income.
- Lead with the reseller offer: a branded store, a BitoCard subdomain first, an optional custom domain later, product selection, reseller-set customer prices, and a pre-funded wallet.
- Describe the five-minute goal as **store setup**, not guaranteed funding, verification, or first sale. Those steps may take longer.
- Use plain UK English. Do not promise specific countries, products, payment methods, or launch dates until confirmed.

## Page behaviour and scope

- Keep the desktop page within the viewport at typical laptop sizes, while allowing scrolling when text enlargement or short viewports require it.
- On mobile, stack the content in a short, readable sequence and keep tap targets comfortable.
- The main page should contain the logo with its tagline, coming-soon status, one clear reseller message, two dialog triggers, an illustrative storefront, and ownership credit.
- Keep detailed onboarding and reseller capabilities in the dialogs. The API, custom-domain setup, and product availability are planned capabilities; label them accordingly.
- Do not show provider names in public-facing page copy.

## SEO

- Search and social metadata (titles, descriptions, Open Graph, Twitter, JSON-LD, manifest) must not say "coming soon". Describe the reseller offer instead; the visible page keeps its Coming soon status and caveats.
- Never claim live products, prices, fulfilment or countries in metadata that the page itself does not support.
- Shared helpers live in `@bitocard/ui`: `seo` (`JsonLd`, `organizationSchema`), `og-image` (`brandOgImage` light card, `bannerOgImage` gradient banner, both 1200x630 with Inter 600/800 from `packages/ui/assets/fonts`, SIL OFL) and `icon-image` (`brandIcon` favicons).
- Legals SEO:
  - Every page's metadata comes from `pageMetadata()` in `apps/legals/components/seo.ts`: canonical, `en-GB`/`x-default` alternates, Open Graph and Twitter with the page's banner image. Pass the same `seo` object to `LegalPage`, which adds WebPage and breadcrumb JSON-LD with `primaryImageOfPage`.
  - Banner images are served at stable URLs `/og/<name>.png` by `app/og/[image]/route.tsx` (prerendered), configured per page in `components/og.tsx`. Do not use `opengraph-image` files inside route groups: Next.js gives them hashed URLs, which breaks the Twitter, sitemap and JSON-LD references.
  - Adding a page means adding it to `ogPages`, the sitemap and `pageMetadata()`.
  - The sitemap lists each page with `lastModified`, its image and language alternates; robots.txt names the host.
- The logo-and-tagline header is `BrandLockup`; its CSS uses `.wordmark.brand-lockup` so app `.wordmark` rules cannot break the layout. Check the header visually after touching either.

## Legal pages

- All legal documents live in one app, `apps/legals`, served at `legals.bitocard.com`: a multi-page site with a main menu of **Home**, **Documents** and **Contact** (tagline **Legals & Compliance**).
  - `/` Home: full-screen hero in the storefront coming-soon style, region card, signposts, commitments.
  - `/documents` hub, and each document at `/documents/privacy`, `/documents/terms`, `/documents/cookies` and `/documents/notice`; the header's Documents item is a click-to-open dropdown (All documents plus each document). Old `/privacy`-style paths redirect permanently.
  - Every page except Home opens with the full-width gradient `PageBanner` (breadcrumbs, eyebrow, title, lead) from `components/blocks.tsx`.
  - `/contact`: legal team email, privacy request process, response times, responsible entities and regulators. Keep every timescale and process there consistent with the privacy notice.
  - Pages other than Home live in the `app/(site)` route group, which supplies the shared header and footer. Reusable pieces are in `components/` (`blocks.tsx`, `content.ts`, `icons.tsx`).
- Add, update or localise legal documents only in this app; never add legal pages to another app. They target global visitors, with region sections for Europe (UK/EEA/Switzerland), the United States, Canada, Africa and Asia.
- Every other site links to them with `appUrl("legals", doc.href)` from `@bitocard/ui/site`: the storefront home footer and the shared `ComingSoon` footer (docs, admin, reseller). The storefront permanently redirects its old `/legal/*` paths to the matching `/documents/*` pages.
- The landing page only summarises what the documents say (regions, laws covered, commitments). Keep its claims in step with the documents and never add certifications or guarantees that are not in place.
- Entities, regions, governing law, contact (`legal@bitocard.com`) and the "last updated" date live in `packages/ui/src/legal.ts`. Change them there, and bump `legalUpdated` whenever any legal page changes.
- Entity by region: Golojan Technologies LLC (Delaware) for the Americas, Asia and anywhere unlisted; Golojan Ltd (England and Wales, company no. 17481904) for the UK and Europe; De-Golojan Technologies Ltd (Nigeria) for Africa.
- The pages describe what the site actually does: no cookies, local storage, analytics, forms or accounts. Update the privacy and cookie notices **before** adding analytics, a signup form, sign-in or any other data collection, and add a consent banner before any optional cookie.
- Each entity's registration number (with its local label) and registered address are in `legal.ts` and shown on the Legal notice. No EU GDPR representative is appointed (decided by the owner); do not add one. These drafts need review by qualified lawyers in each target region before launch.

## Repository and delivery

- This is an npm-workspaces Turborepo with six applications in `apps/`. `docs`, `storefront` (the main site, bitocard.com), `admin`, `shq` (Seller Head Quarters, the reseller back office) and `legals` are Next.js apps: use App Router directly in each and do not introduce `src/` wrappers. `api` is a NestJS 12 app with the standard Nest `src/` layout. Root tooling and this file stay at the repository root.
- API rules: keep the entrypoint at `apps/api/src/main.ts` and app setup in `src/bootstrap.ts`. Never name a top-level `src/` file `app`, `index` or `server`, because Vercel would pick it as the entrypoint. Build with `nest build` (tsc, decorator metadata on), not an esbuild or SWC bundler. The API is an ES module package (`"type": "module"`, as NestJS 12 ships ESM only): relative imports end in `.js` (`./x.js`, `./dir/index.js`) and the Prisma client is generated as ESM. Never go back to CommonJS: Vercel's function loader refuses `require()` of ES modules even on Node versions that allow it (`ERR_REQUIRE_ESM`). Mark providers `@Injectable()` and rely on constructor injection.
- API foundation (`apps/api`):
  - Every public route is under `/v1` except `/`, `/health` and `/robots.txt`. The OpenAPI document is served at `/v1/openapi.json` and committed as `apps/api/openapi.json`; run `npm run openapi -w @bitocard/api` after changing endpoints (`npm test` fails if it is stale). The same command writes `packages/api-client/src/reseller/api-lists.generated.ts` (API key scopes and webhook event types) from the API source, so SHQ never keeps its own copy; never edit it by hand.
  - Errors always use `{ "error": { "type", "code", "message", "param"?, "request_id" } }`: throw `ApiError` for expected failures; anything else becomes a generic `api_error`. Never return internal details.
  - Every POST requires an `Idempotency-Key` header (handled globally by `IdempotencyInterceptor`, stored in Postgres for 24 hours).
  - Request bodies are DTO classes with class-validator decorators; unknown fields are rejected.
  - Database: Prisma 7 with the Postgres driver adapter (`DATABASE_URL`, Neon pooled). Edit `prisma/schema.prisma`, then create a migration with `npm run db:migrate:create -w @bitocard/api -- <name>` against a development database; never edit an applied migration. Vercel builds run `prisma migrate deploy` after the build when `DATABASE_URL` is set. The generated client in `src/generated/` is not committed.
  - Configuration (`src/config`, `src/integrations`):
    - The environment holds only what the API needs to start or what protects admin access: `DATABASE_URL`, `ENCRYPTION_KEY`, `CRON_SECRET`, `ALLOWED_ORIGINS`, cookie settings, `ADMIN_EMAIL_DOMAINS`, Redis, rate limit, logging and webhook transport. Never move those into the database: a mistaken admin edit must not lock admins out or widen who can sign in.
    - Service keys and their settings are **integration settings** (`src/integrations/definitions.ts`), set by a super admin in the admin app (Settings > Integrations, `GET/PUT /v1/admin/integrations`). Each is named after the environment variable it replaces; the admin value wins, then the environment (local development and tests), then the default in `config.ts`, and values are validated with the same zod rules.
    - Secrets are encrypted with `ENCRYPTION_KEY`, never returned (only the last four characters as a hint), and audited without their values. Every change needs the admin's current authenticator code (`AdminAuthService.confirmCode`; wrong codes count towards the lockout).
    - Services read `IntegrationsService.config` (never `APP_CONFIG`) for anything in `integrationKeys`, and build provider clients with `integrations.derive(...)` so a new key is used without a restart. Each instance refreshes its copy before a request (`IntegrationsRefreshInterceptor`, at most every 30 seconds, and at once after a change on that instance); code outside HTTP requests (the queue consumer) calls `refresh()` itself.
    - A new service key goes in `integrationKeys` and a group in `integrationGroups` (marking secrets and required fields), not in `.env.example`.
    - Every supplier in the registry has a group (Settings > Integrations > Suppliers). Suppliers whose adapter is still a stub get theirs from `supplierCredentialGroups` (`src/integrations/supplier-credentials.ts`): credentials named `<CODE>_<FIELD>` (`TELNYX_API_KEY`), set in the admin app only (no environment fallback), marked "adapter not built", and read by the adapter once built with `IntegrationsService.supplier(code)`. Confirm each supplier's fields against the credentials it actually issues before building its adapter; when the adapter is built, move its fields into `integrationKeys`/`config.ts` if it needs an environment fallback, and add a supplier added to the registry here too.
  - Rate limits per caller on `/v1` use Upstash Redis when configured, in-memory counters otherwise. The limiter uses only INCR and PEXPIRE so it behaves the same on Upstash and plain Redis; do not reintroduce `@upstash/ratelimit` (its scripts are Upstash-only). If Redis fails, requests are allowed and the failure logged.
  - Sign-in and access (`src/auth`, `src/api-keys`, `src/team`):
    - `AuthGuard` runs first on every request and sets `req.caller`: an API key (`Authorization: Bearer bc_test_…/bc_live_…`) or the realm's session cookie (`bc_session` for resellers, `bc_admin_session` for admins). Every route needs a caller unless marked `@Public()`.
    - Route rules: `@RealmOnly('admin')` for admin routes (default is reseller), `@Roles(...)` for reseller staff (owners always pass), `@Scopes(...)` for API keys, `@SessionOnly()` where keys must not be used. New API-key scopes go in `apiKeyScopes` and the docs.
    - Cookie-authenticated changes must come from an allowed Origin (`ALLOWED_ORIGINS`); this is the CSRF protection, so never relax it.
    - `@SkipIdempotency()` only on routes that set cookies or return secrets and are safe to repeat.
    - Passwords: Argon2id, 10 to 128 characters, breached-password check (Have I Been Pwned range API, fails open). Five failures lock an account for 15 minutes. Codes are 6 digits, hashed, single-use, 30 minutes, 5 attempts, one resend a minute.
    - Reseller sign-up (`POST /v1/auth/signup`) creates the person and their reseller account (they own it), or with `invitation_token` joins the inviting team, and signs them in. SHQ confirms the email first (`POST /v1/auth/signup/email` emails a code, `POST /v1/auth/signup/email/verify` exchanges it for a `signup_token` valid one hour and once, `signup_verifications` keeps only hashes for a day), so the account is created confirmed; without a token a code is emailed after sign-up instead. A signed-in person with a confirmed email who owns no reseller account (for example after leaving a team) opens one with `POST /v1/auth/reseller-account` (business name and an open country; one owned account per person, `already_owner` otherwise).
    - Signed in, a person changes their name (`PATCH /v1/auth/profile`), password (`POST /v1/auth/password/change`, needs the current one; signs out their other sessions) and sign-in email (`POST /v1/auth/email/change` with the current password, then the code sent to the new address at `/v1/auth/email/change/verify`; the old address is emailed). Wrong current passwords count towards the sign-in lockout. Accounts without a password (Google only) set one with Forgot password.
    - Admins: email and password on `ADMIN_EMAIL_DOMAINS` only, never Google, then an authenticator code every sign-in (secrets encrypted with `ENCRYPTION_KEY`, codes never reusable, 10 recovery codes). Create admins with `npm run admin:create -w @bitocard/api`; there is no public admin sign-up.
    - Google sign-in is for resellers only and never links to an existing email/password account automatically.
    - Google sign-up is deliberate: `GET /v1/auth/google/start?intent=signup` is the only way a Google account creates a BitoCard account, and it creates only the person (email confirmed by Google, no password, no reseller account); onboarding then opens the reseller account (`POST /v1/auth/reseller-account`). Signing in (`intent=signin`, the default) with a Google account that never signed up fails with `google_account_not_found` and creates nothing. A Google-only person signs in with Google until they set a password through Forgot password; after that both their email and password and Google work. The intent is stored with the one-time state (`oauth_states.intent`).
    - Outside services (Resend, MailerSend, Termii, Google, Have I Been Pwned) have configurable base URLs; tests replace them with local fakes (`fakeService` in `test/helpers.mjs`). Without provider keys (in the admin app or the environment), email and SMS are captured in an outbox instead of sent.
    - Admin routes use `@RealmOnly('admin')` plus `@AdminRoles(...)` (super_admin always passes), and every admin change is written to the audit log through `AuditService.record` with before and after.
  - Markets, settings and stores (`src/countries`, `src/settings`, `src/plans`, `src/stores`):
    - Countries live in the database (seeded with NG, GH, KE by migration), not in environment variables: sign-up, currency, reserved accounts, markup cap, payout hold, minimum withdrawal, and per-category availability and customer verification.
    - The public country view (`/v1/countries`) includes the money rules resellers work under (reserved accounts offered, markup cap, payout hold days, minimum withdrawal) and the enabled categories; tax settings stay admin-only.
    - Settings chain: options are defined in `optionDefinitions`; a country allows a subset with a default; a reseller chooses within it, and falls back to the default if the country withdraws their choice.
    - Feature switches are defined in `switchDefinitions` with the scopes they allow (global, country, reseller). Resolution is reseller, then country, then global, else off. The welcome bonus is reseller-only.
    - Plans: Standard and Premium. `apiRestrictions` lists API scopes a plan switches off; empty means everything is on.
    - Stores: one per reseller for now, subdomain rules and reserved names in `stores.service.ts`, publishing needs a confirmed owner email. `GET /v1/storefronts/:subdomain` is the public lookup the storefront app uses.
    - Admin endpoints are excluded from the public OpenAPI document.
  - Money (`src/ledger`, `src/fx`, `src/payments`, `src/payouts`, `src/tax`, `src/billing`, `src/cron`):
    - Every money movement is a balanced double-entry `JournalEntry` posted through `LedgerService` (`prepare` outside the transaction, `write` inside it, or `post` for both). Never update `balanceMinor` directly; never edit or delete entries. Amounts are integer minor units (`BigInt` in code, numbers in responses). Each entry has a unique `reference`, so an event can never be posted twice.
    - Reseller accounts: `reseller_funding` (top-ups: pays wholesale cost, never withdrawn), `reseller_earnings` (matured profit: spendable and withdrawable), `reseller_earnings_held` (inside the payout hold), `reseller_reserved` (held for orders), `reseller_payouts_pending`, `reseller_allowance` (the startup allowance, USD, restricted). They can never go below zero (checked in the UPDATE and by a database constraint).
    - The startup allowance (`src/ledger/allowance.service.ts`): US$500 granted once (ledger reference `allowance:grant:<reseller>`), posted from the `promotions` expense to the reseller's `reseller_allowance` account, live only. It is granted when a reseller passes the identity check with the `startup_allowance` switch on (reseller, country or global), or later by a finance admin (`POST /v1/admin/resellers/:id/startup-allowance`); finance revokes what remains with a reason (`.../startup-allowance/revoke`), after which it can never be granted again. The wallet reports it as `startup_allowance` (never part of `available`). Spending it on the wholesale cost of customer-paid orders comes with hosted checkout (M10); until then nothing draws on it.
    - Reserved accounts, live: the country must offer them, the `reserved_accounts` switch must be on for the reseller (reseller, country or global), and the reseller active. In Nigeria the owner first passes the BVN check (`POST /v1/account/bvn`, owner only, after the identity check; Flutterwave consent page returning to SHQ's `/wallet/reserved-accounts`, name matched to the verified owner); `POST /v1/wallet/reserved-accounts` then takes no BVN and uses the checked one. The sandbox needs neither.
    - `GET /v1/wallet/top-ups` lists checkout payments and bank transfers into reserved accounts (`source`). Payouts name their bank account (`bank_account`, kept after the account is removed) in API responses but not in webhook payloads.
    - Test and live money are separate (`LedgerMode`). API keys decide the mode; dashboard sessions are live unless they send `BitoCard-Mode: test`. Test mode uses the sandbox provider only, never real providers, and outcomes are set through the `simulate` endpoints.
    - Credit a wallet only after re-reading the payment from the provider (never trust a webhook body), claim the record with a conditional `updateMany` on its status inside the same transaction as the ledger write, and rely on unique references so retries and concurrent webhooks are harmless. An unclear provider answer leaves the record pending for the requery job.
    - Orders hold wholesale cost with `WalletService.hold` (funding first, then earnings) and resolve it with `captureHold` or `releaseHold`. Sale profit goes through `creditEarnings`, released by the `earnings` job after the country payout hold.
    - Payment providers implement the interfaces in `src/payments/providers.ts` and are chosen by `PaymentProviders`; provider errors are `ProviderError` with `definite` set only when the provider clearly refused.
    - Exchange rates: `FxService.rate()` returns `pay` (charging local currency for USD) and `receive` (converting USD to local); it throws `conversion_unavailable` when a currency is paused or its rates are stale.
    - Tax: `TaxService.calculate()`; live sales need a rate a finance admin has confirmed.
    - Scheduled jobs are `GET /v1/cron/<job>` with `Authorization: Bearer <CRON_SECRET>` (schedules in `vercel.json`); every job must be safe to run twice or late.
    - Adding bank accounts, withdrawing and changing plan are dashboard-only (`@SessionOnly`). Plans are paid from the live wallet, so changing plan in sandbox mode is refused (`live_only`).
  - Suppliers, catalogue and quotes (`src/suppliers`, `src/catalogue`):
    - Every supplier in the registry (`suppliers` table, seeded from PLANS.md) has an adapter implementing `SupplierAdapter` (`src/suppliers/adapter.ts`); suppliers without confirmed API access use `StubAdapter`. Register real adapters in `SupplierAdapters`. Adapters map the supplier catalogue to `CatalogueItem`s with a BitoCard product key (`category:country:brand:variant`), so equivalent offers from different suppliers share one product.
    - Which suppliers are used is configuration: the supplier switch, and `supplier_markets` (supplier, reseller country, category). A supplier without credentials serves only the sandbox. Catalogue sync keeps admin settings (product switches, agreed `discountBps`, priority) and marks offers the supplier no longer lists unavailable.
    - `PricingService` routes to the cheapest eligible offer and never prices below BitoCard cost. Local face-value products (airtime, data, pay-TV, bills in the reseller currency) sell at face value plus the reseller markup, or at face value with the reseller discount (the `fixed_price_earning` option). Everything else is priced from supplier cost converted at BitoCard `pay` rate, plus the BitoCard margin from the most specific `PricingRule`, plus the reseller markup. Markups are capped by the country Markup Protection Scheme when set and again when priced.
    - Every team member can read `/v1/pricing` (markups name their product); only owners and admins change markups.
    - Quotes lock the price for 10 minutes and record the routed supplier and its cost internally. Supplier names, SKUs and costs must never appear in reseller responses (tests check this).
    - Pay-TV and bills quotes validate the smartcard or meter number with the routed supplier (simulated in the sandbox; `0000000000` is never recognised). Airtime and data need a valid mobile number for the product country.
    - Tax applies only to categories an admin has marked `taxable` for the country; live quotes in a taxable category need a confirmed tax rate.
  - Orders (`src/orders`):
    - An order uses one open quote. Wholesale cost plus tax is held from the wallet (`order:<id>`), the quote is claimed in the same step, and the hold is captured only when the supplier confirms: wholesale to `platform_revenue`, tax to `tax_payable`, and the supplier cost posted as `cost_of_sales` against `supplier_float` in the supplier currency. A failed order releases the hold.
    - Unclear is not failed: a timeout, unclear error or pending reply leaves the order `processing`; the `orders` job checks the same supplier on the `checkScheduleMs` back-off and puts the order in the admin exception queue (`needsReview`) after the last step. Only a definite failure (a clear refusal when placing, or a confirmed failed status) moves the order to another supplier, and only if that supplier costs no more than the quoted wholesale price; otherwise the order fails.
    - Each supplier attempt has its own `supplierReference` (Lagos date and time first, as VTpass requires) and is logged in `OrderAttempt` for admins.
    - Codes, PINs and tokens are encrypted at rest and returned only by `GET /v1/orders/:id` (and the create response) for the owning reseller, never in lists, admin views, logs or webhooks.
    - Receipts are numbered from the `order_receipt_number_seq` sequence and name the regional seller entity from `src/orders/seller.ts`, which must match `packages/ui/src/legal.ts` (a test checks it).
    - The sandbox never calls suppliers: orders complete with `SANDBOX-` codes unless created with `simulate: failed|pending`.
    - Admins trace orders (attempts and ledger entries), requery, resolve the exception queue (operations) and refund completed orders to the reseller wallet (finance), all audited.
    - Supplier notifications (`src/orders/supplier-webhooks.ts`: Reloadly at `POST /v1/webhooks/reloadly`, DIDWW at `POST /v1/webhooks/didww`) must never be lost: verify the signature, store the raw body encrypted in `supplier_webhooks` (unique per body hash, so a supplier's retry is stored once) and only then reply, inside the supplier's time limit; process after the reply (`waitUntil`). The body is never trusted: it only names the order (Reloadly `customIdentifier` = our supplier reference), which is re-checked with the supplier through `OrdersService.attempt(id, 'check', { scheduled: false })` (unscheduled checks never count towards the exception queue). While the order is still pending, or the supplier cannot be reached, the notification is retried by the `supplier-webhooks` job (every 5 minutes, on `supplierWebhookRetryMs`); unmatched or repeatedly failing ones are kept a year for admins (Orders > Supplier notifications, retry by hand, audited). Bodies are never returned by the API or logged.
    - Reloadly signs with `X-Reloadly-Signature`: hex HMAC-SHA256 of `<raw body>:<X-Reloadly-Request-Timestamp>` with the webhook signature secret (`RELOADLY_WEBHOOK_SECRET`, an integration setting). The timestamp's age is not checked: replays are harmless because bodies are never trusted. Without the secret every notification is refused, so Reloadly keeps retrying until it is set.
    - DIDWW (`src/suppliers/didww.adapter.ts`, API version `2022-05-10`, `Api-Key` header) sells virtual numbers. Numbers are a worldwide category (synced once for the countries in `DIDWW_COUNTRIES`, sold to resellers in every market). A product is a DIDWW DID group and price plan: country, number type, area and capabilities (`virtual_numbers:GB:local:london-voice-sms-0ch`), priced in USD at setup plus the first month. Numbers needing the end user's documents, metered numbers and fax-only numbers are not synced until document collection and usage billing exist. Each number is ordered for one billing cycle (`billing_cycles_count: 1`), so DIDWW never renews, and charges for, a number BitoCard has not been paid for; monthly renewals from the reseller wallet are still to be built. The delivery is `virtual_number` with the number (not a secret). DIDWW orders take no reference of ours, so each order's callback address carries it (`<DIDWW_CALLBACK_URL>/v1/webhooks/didww?reference=…`); DIDWW echoes the address on the order, which is how an order whose reply was lost is found again instead of being placed twice. Callbacks are form posts signed with `X-DIDWW-Signature`: hex HMAC-SHA1, keyed with the API key, of the called address (explicit port, path and query) followed by the sorted field names and values.
  - Identity checks (`src/identity`):
    - Providers sit behind `DocumentCheckProvider` (Didit) and `BvnProvider` (Flutterwave BVN consent) in `providers.ts`. Results are always re-read from the provider, never taken from a webhook body, and applied once (conditional claim on an open status).
    - Keep only the outcome, the verified name and the document country: never document images or numbers, and never a customer's BVN (it is passed to Flutterwave and dropped). The one exception is a reseller owner's BVN for reserved accounts, held encrypted on their BVN check only until the accounts are opened (the bank needs it), then erased; erased at once if the check fails and after 7 days if unused. Checks need recorded consent (`consent: true`), because face checks are biometric data.
    - Reseller owners (`POST /v1/account/verification`, owner only, sessions only) verify with Didit. Approval sets `verifiedAt`/`verifiedName` and makes a pending reseller active unless the `manual_reseller_approval` switch is on; admins can never activate an unverified reseller. Checks in review are decided in `/v1/admin/verifications` (operations), audited.
    - Customers are checked by the reseller's own customer reference (`/v1/customers/:reference/verification`, scope `customers:verify`): BVN in Nigeria, approved only if the BVN record's name matches; Didit elsewhere; simulated in test mode. Outcomes are `customer_verification.*` events. For resellers' own systems the check is optional (they are responsible for their customers); hosted storefronts will require it where the category and country demand (M10, via `IdentityService.isCustomerVerified`).
    - Live payout accounts need a verified reseller and an account name sharing a distinctive word with the verified owner's or the business's name (`accountNameMatches`).
    - The `identity` job (every 30 minutes) re-reads unreported checks and expires checks unfinished after 7 days.
  - Events and webhooks (`src/webhooks`):
    - Record an event with `EventsService.record(tx, …)` inside the same transaction as the change, only when that transaction actually changed the state (after the conditional claim), and call `events.committed()` after it commits. The event's `object` is the public presenter output, never secrets.
    - Event types live in `eventTypes` (`events.ts`). A new type needs its entry in `eventDocs` and `eventObjectSchemas` (`openapi.ts`: when it fires and does not, what comes before and after, a full example) in the same change; a test checks real payloads against the schemas. The OpenAPI document is 3.1 because of its `webhooks` section.
    - The payload is serialised once and stored (`events.payload`), so retries and resends send identical bytes. Signature: `BitoCard-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body" keyed with the whole whsec_ secret>`, plus a second `v1` during a rotation's overlap.
    - Transport (`queue.ts`): `WEBHOOK_QUEUE=vercel` (the default on Vercel) sends one message per endpoint with due work to the `webhook-deliveries` topic, delayed until its next retry; Vercel pushes it to the standalone consumer function `apps/api/api/webhook-queue.mjs` (trigger in `vercel.json`; Vercel accepts triggers only on `api/` functions for the NestJS preset), which starts the app's services without HTTP routes (`src/webhooks/consumer.ts`) and delivers that endpoint. A busy endpoint returns the message for 10 seconds. `database` (the default elsewhere) delivers inline after each commit. Keep the direct `@nestjs/core` import in `src/main.ts`: Vercel's NestJS preset finds the entrypoint by it.
    - Delivery: one leased worker per endpoint, at most 5 requests in flight, 10-second timeout, no redirects, retries on `retryScheduleSeconds` with ±10% jitter, giving up 3 days after the event. 3 days of failures disables the endpoint (`disabled_reason: failing`), stops its pending deliveries and emails the owner. Manual attempts (resend, test) never count towards disabling.
    - Endpoints are HTTPS on public addresses, checked on save and again when connecting (`safeLookup` pins the checked addresses). `WEBHOOK_ALLOW_PRIVATE_URLS` exists for local development and tests only and is refused in production.
    - `GET /v1/events` lists events oldest first after `since` (event ID or time), holding back the last `EVENTS_SETTLE_SECONDS`; events and delivery logs are kept 30 days (`webhooks-cleanup` job). Test (`ping`) events go to one endpoint and are never listed.
    - The reseller guide is `apps/docs/content/webhooks.md` (rendered by the docs app in M12). Its signature test vector and its Node.js, Python and PHP code are run by the tests; keep them in step with `signing.ts`.
    - Give every public endpoint an `@ApiOperation` summary and describe request fields with `@ApiProperty` (the Swagger CLI plugin is off: it breaks with TypeScript 6).
  - Tests in `apps/api/test` run against the compiled `dist/` with PGlite (in-process Postgres) and the real migrations, so they need no database server.
- Admin app (`admin.bitocard.com`) is one Next.js app, `apps/admin` (Vercel project `bitocard-admin`). Do not split it into microfrontends unless a separate team needs to own an area (tried and dropped in M9: more deployments and slower navigation for no benefit):
  - `/signin` sits outside the `(console)` route group; everything else is inside it and behind `AdminGate`: the overview dashboard `/`, `/orders`, `/catalog`, `/resellers`, `/verifications`, `/activity`, `/settings` (feature switches, markets, and integrations for super admins). A new admin area is a folder in `(console)` plus its entry in `sections` and `menus`.
  - The root layout wraps everything in `AppProviders`; pages render inside `AdminShell` (navy rail, section menu from `menus` in `@bitocard/admin-ui/shell`, breadcrumbs, account menu; a drawer on phones). Use `AppLink` for links (Next.js `Link`, swapped for plain anchors in the package tests).
  - Pages are client components that fetch with the RTK Query hooks from `@bitocard/api-client/admin`; the browser calls the API directly with the admin session cookie (`NEXT_PUBLIC_API_URL`). Show the API's error message (`errorMessage`), confirm audited actions with `ActionDialog` (reason recorded), and hide controls the admin's roles cannot use (`can`), mirroring the API's role checks (the API decides).
  - Admins never sign in with Google; the sign-in page is email and password, then the authenticator (QR set-up on first sign-in, recovery codes shown once).
  - Local development: `npm run dev:admin` starts the admin on http://localhost:3003; run the API with `ALLOWED_ORIGINS=http://localhost:3003`.
  - Build UI from `@bitocard/admin-ui` (cards, stat cards, `DataTable` that stacks on phones, tabs, dialogs, `LineChart`, status badges with one colour per status, `CodeInput` six-box authenticator codes, formatters for minor-unit money). Money totals across markets are shown in USD, BitoCard's base currency (the overview's `usd` view, converted at reference rates for reporting and naming any currency without a rate); never default to one market's currency. Check new screens at phone width with no horizontal page scroll.
- SHQ (`shq.bitocard.com`) is one Next.js app, `apps/shq` (package `@bitocard/shq`, Vercel project `bitocard-shq`), built like the admin app:
  - `/signup`, `/signin`, `/forgot-password` and `/invitations` (accepting a team invitation) sit outside the `(console)` route group; everything else is inside it and behind `ResellerGate` (`components/reseller.tsx`), which signs the person in, asks for the emailed code until their email is confirmed, and shows onboarding ("Set up your business": business name and country, `POST /v1/auth/reseller-account`) to anyone who is not a member of a reseller account, which is where Google sign-ups land first.
  - `/signup` is step by step: (1) first name, last name and email; (2) the 6-digit code emailed to confirm it, before any account exists; (3) business name and country (countries open for sign-up); (4) password, then the account is created with its email already confirmed. With `?invitation=<token>` it is details then password, and the account joins the inviting team (no business or country). An expired confirmation sends the person back to step 1; other errors back to the step that needs fixing. "Sign up with Google" starts Google with `intent=signup` and returns to `/signup` (errors are shown there as `?auth_error=`), which sends the signed-in person on: to onboarding, or with an invitation to accept it. "Sign in with Google" on `/signin` never creates an account; an unknown Google account is told to sign up first. A failed password sign-in reminds Google-only people to use Google or reset their password (without saying whether the account exists). `?email=` prefills `/forgot-password`.
  - Pages render inside `ShqShell` (the shared `ConsoleShell` from `@bitocard/admin-ui/shell`: rail, section menu, breadcrumbs, account menu, drawer on phones) and fetch with the hooks from `@bitocard/api-client/reseller`. Show the API's error message, and hide controls the member's role cannot use with `can(membership, ...roles)` (owners always pass), mirroring the API's `@Roles`.
  - Order pages refresh themselves: an order's page checks every 5 seconds while it is processing (and refreshes the wallet when it settles); the orders list every 15 seconds while any listed order is processing. Polling pauses in background tabs.
  - A person can belong to several reseller accounts: the account is chosen in the account menu, remembered in the browser, and sent as `BitoCard-Reseller` on every request (`setRequestContext`). The Live/Sandbox switch sends `BitoCard-Mode: test` and clears the API cache; sandbox pages show the `simulate` controls and an amber banner.
  - Local development: `npm run dev:shq` starts SHQ on http://localhost:3004; run the API with `ALLOWED_ORIGINS=http://localhost:3004` (plus the admin origin if needed).
- Shared code lives in `packages/`: `@bitocard/api-client` (RTK Query API slice with cookies, automatic Idempotency-Key on POST and BitoCard error shape; admin endpoints in `/admin`, SHQ endpoints in `/reseller`), `@bitocard/admin-ui` (console theme and components shared by the admin app and SHQ, `ConsoleShell`, the admin shell and session gate; Vitest tests), `@bitocard/ui` (brand, `styles/interactive.css` imported by every app's `globals.css` so everything clickable shows the hand cursor and disabled controls show not-allowed (never remove it; add `cursor-*` utilities only for exceptions), `BrandLockup` logo-with-tagline header, coming-soon workspace page, site constants, cross-app URLs, legal data), `@bitocard/next-config` (`createNextConfig`, security headers, noindex for private apps), `@bitocard/eslint-config` and `@bitocard/typescript-config`. Put cross-app code there rather than copying it between apps. Packages ship TypeScript source with no build step.
- Deployment target is Vercel: one Vercel project per app, Root Directory `apps/<app>`, with install, build and ignore commands in each app's `vercel.json` (static settings; no `@vercel/config` dependency). The ignore command is plain `npx turbo-ignore` (skip when the app and its workspace dependencies are unchanged since that project's last deployment); never add `--fallback`, which made a new project's first deployment compare against the previous commit and skip itself. The original Sites output and `.openai/hosting.json` are absent; if that hosting identity is restored, reuse it rather than creating a second Site.
- Preserve the existing private audience unless the user explicitly requests a sharing change.
- **Testing is mandatory.** Every change ships with tests covering it; untested code is not done. Two environments:
  - **Local, with Docker:** `npm run docker:up` starts Postgres 17, Redis and an Upstash-compatible REST proxy (`docker-compose.yml`); `npm run test:docker` runs the API tests against them (database `bitocard_test`, reset on every run); `npm run docker:api` runs the API image the way production does. `npm test` also runs without Docker using PGlite, for quick feedback.
  - **Production, on Vercel:** CI (`.github/workflows/ci.yml`) runs `npm run check` plus the API tests against Postgres and Redis service containers on every push and pull request. After each successful Vercel deployment of the API, `.github/workflows/smoke.yml` runs `apps/api/scripts/smoke.mjs` against the deployed URL (health with database, headers, OpenAPI, error format).
  - A change is ready only when both the PGlite and the Docker test runs pass. Add smoke checks for each new critical public endpoint.
- For changes, run `npm run check` (lint and typecheck, then build; do not run typecheck and build in parallel). Verify responsive layout and dialog behaviour for storefront and admin edits. Do not claim publication without a configured deployment workflow.
- Do not commit generated archives or credentials. Keep the source repository and the published version in sync.
<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
