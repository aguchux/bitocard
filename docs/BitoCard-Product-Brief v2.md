# BitoCard — Final Product Brief

- **Planning baseline:** 2 October 2026.
- **Purpose:** Consolidated product scope and release direction; supplier shortlists are proposals until commercial access and coverage are confirmed.

- **Product and ownership**
  - BitoCard is a reseller-first digital products and utilities platform owned by Golojan Ltd.
  - It combines partner catalogues, pricing and fulfilment into one BitoCard service.
  - Intended markets include the UK, US and selected African countries. Additional countries depend on supplier coverage, payment access and operational readiness.

- **Platform users**
  - Administrators manage suppliers, markets, products, pricing, resellers, transactions and support.
  - Golojan's own reselling brand will be the first tenant, operating on a BitoCard subdomain.
  - Independent resellers operate branded storefronts and serve their own customers.
  - Retail customers buy supported products and sell or trade eligible gift cards.

- **Product catalogue**
  - Digital gift cards, mobile airtime and data bundles.
  - Supported utility bills, electricity payments and TV/pay-TV subscriptions.
  - Travel and regional eSIM data packages, including eligible top-ups.
  - Digital software, antivirus licences and Windows licences; retail/ESD, OEM and business subscriptions are distinct product types.
  - Virtual payment cards, subject to supplier access and market eligibility.
  - SMS-capable virtual numbers and supported voice-number services, subject to inventory, capabilities and supplier agreements.
  - Virtual-number coverage is intended to include Africa, Asia and Europe where supported; no universal coverage is assumed.
  - Products, denominations, currencies, payment methods and exchange options vary by country.
  - Physical goods and integrations with stores such as Jumia and Konga are deferred.

- **Supplier aggregation and routing**
  - Initial planned sources: Reloadly, Prestmit and Cardtonic.
  - Reloadly is the planned source for gift cards and mobile top-ups; Prestmit and Cardtonic are planned gift-card buying/selling sources where their APIs support the required operations.
  - Additional category suppliers remain under evaluation; access, products, settlement terms and territories must be confirmed before activation.
  - Resellers see one BitoCard catalogue, price and order status. Supplier identities, credentials, costs and routing decisions remain internal.
  - Normalize equivalent supplier products into BitoCard product IDs while preserving country, denomination and service restrictions.
  - Select eligible purchase sources by availability, net margin, total costs and fulfilment reliability.
  - Select gift-card sale sources by the best viable net return and supported verification/settlement flow.
  - Lock customer-facing quotes for their stated validity period.
  - Reconcile uncertain orders before retrying or switching sources to prevent duplicate fulfilment.
  - Rented phone numbers and recurring software subscriptions remain with their original supplier unless a supported transfer or migration is completed.
  - BitoCard maintains the upstream funding needed for fulfilment; reseller wallet balances alone do not guarantee provider liquidity.

- **Buying, selling and trading**
  - Customers browse eligible products and review a final quote before purchase.
  - Customers can fund accounts and pay for supported orders from wallet balances.
  - Eligible unused gift cards receive quotes and verification before settlement.
  - Trade links an accepted gift-card sale to a new purchase and displays any value difference.
  - Unverified gift cards must not become cleared wallet funds or fund outgoing products.

- **Reseller storefronts**
  - Provide a hosted storefront with reseller branding, eligible product selection and customer-facing prices.
  - Give resellers dashboards for store settings, balances, orders, sales and margins.
  - BitoCard handles sourcing and fulfilment; resellers maintain their customer relationships.
  - Paid orders require sufficient available reseller funds or eligible startup credit to cover BitoCard's wholesale cost.
  - Resellers choose products, set permitted retail markups and view resulting profit without seeing upstream supplier costs.
  - Each storefront is a separate tenant with its own branding, customers, orders and reporting.

- **Domains and storefront addresses**
  - Every reseller can start on a BitoCard subdomain.
  - Resellers can search for and purchase a domain through BitoCard and link it to their store.
  - Resellers can connect an existing domain they own without purchasing another domain.
  - Integrate a registrar reseller API for domain availability, registration, renewal and management; the registrar is to be selected.
  - Provide ownership verification, DNS guidance or automated configuration where supported, HTTPS activation and connection status.
  - Provide renewal reminders and transparent registration and renewal prices.
  - Keep domain charges separately identifiable in transaction records.
  - Domain purchases and external DNS changes must not block basic subdomain onboarding.

- **Five-minute onboarding goal**
  - Create and verify the reseller account.
  - Choose a store name and subdomain.
  - Add branding and select available products.
  - Accept suggested margins or adjust customer prices.
  - Preview and publish the store.
  - Five minutes refers to store setup. Funding, required verification and domain activation may take longer.

- **Wallet and ledger**
  - Resellers normally pre-fund their wallets before accepting paid orders.
  - Reserve the wholesale cost when an order is accepted.
  - Settle the debit after successful fulfilment and release funds after confirmed failure.
  - Track available, pending and reserved funds, deposits, purchases, settlements, fees, refunds and adjustments.
  - Separate customer balances, reseller cash, promotional credit, reseller earnings and outstanding startup-credit principal.
  - Maintain an auditable double-entry ledger; balances derive from posted transactions rather than editable totals.
  - Keep currencies separate and disclose exchange rates and fees before conversion.
  - Define customer-wallet payment and direct-checkout settlement rules so the same payment is never counted twice.
  - Record customer price, reseller wholesale cost, supplier cost, FX, fees and resulting margins separately.
  - Credit funding only after confirmed payment and use idempotent processing to prevent duplicate credits or orders.
  - Enforce server-side authorization and isolate each reseller's customer and transaction data.

- **Market-entry promotion**
  - Proposed $500 recoverable startup credit enables eligible resellers to begin without initial cash funding; it is recoverable working capital, not an unrestricted cash gift.
  - Credit cannot be withdrawn, transferred or converted into unrestricted wallet cash; eligible catalogue products and usage limits are controlled by BitoCard.
  - Promotional sales must use BitoCard payment channels so recovery can be enforced.
  - Recover 100% of the startup principal through qualifying sales while allocating earned reseller profit.
  - Recovery must reduce the outstanding credit principal; recovered amounts must not silently replenish a perpetual credit allowance.
  - Define the settlement allocation among principal recovery, product costs, fees and reseller profit, including refunds and chargebacks.
  - Promotional customer funds must clear through BitoCard-controlled settlement before recovery or earnings become final.
  - After complete recovery, the reseller continues through normal wallet funding.
  - Proposed $1 retail welcome bonus supports eligible digital-product purchases through participating storefronts during the promotional period.
  - The welcome bonus is a marketing expense with eligibility, expiry and anti-abuse limits, separate from recoverable reseller credit.
  - Finalize eligibility, limits, expiry, refunds, recovery allocation and accounting before launch.
  - Recovery is a programme requirement; this brief does not establish that defaults or fraud can cause no loss.

- **Funding channels**
  - Evaluate dedicated or reserved bank accounts for automatic wallet funding.
  - Match confirmed deposits to the correct customer or reseller.
  - Select country-specific payment and banking partners; universal coverage is not yet confirmed.
  - Flutterwave and alternative reserved-account/MFB providers are evaluation options, not confirmed permanent-account coverage for every country.


- **eSIM offering**
  - Sell eligible country, regional and global data packages through reseller storefronts.
  - Show destination coverage, supported networks where provided, data allowance, validity, activation rules and device compatibility before purchase.
  - Deliver installation instructions and supplier-issued QR/activation details securely after fulfilment.
  - Show order status and available usage/expiry data where the provider API exposes them.
  - Offer top-ups only where supported for the purchased eSIM; show whether a new eSIM is required.
  - Prefer pay-per-order or low-deposit commercial arrangements to reduce initial capital needs.
  - Supplier evaluation shortlist: eSIM Access, eSimerge, eSIM Go and Airalo Partners.
  - Compare current deposit requirements, API access, destination costs, resale-price restrictions, refunds and support; none is appointed by this brief.

- **Software and licence offering**
  - Sell eligible downloadable software, antivirus/security products and Windows licences.
  - Evaluate Nexway Connect for digital software fulfilment; Ingram Micro and TD SYNNEX for software distribution; ALSO and Pax8 for recurring business subscriptions.
  - Confirm exact Windows SKUs and electronic licence delivery rather than assuming cloud API access includes standalone Windows Home/Pro keys.
  - Confirm permission for BitoCard to distribute through independent resellers, plus territories, minimum deposits and order commitments.
  - Record publisher, edition, licence channel, operating system, region, device/user count, term, renewal rules and fulfilment method.
  - Distinguish new retail licences, upgrades, OEM licences and account-based subscriptions; disclose qualifying-device or existing-licence requirements.
  - Provide secure key/activation-link delivery and instructions, with fulfilment and activation-support history.
  - Encrypt licence keys and restrict access; exclude keys and activation secrets from routine logs.
  - Prevent duplicate allocation of one-time licence keys.
  - Keep subscription renewal/cancellation commitments tied to the original purchase and supplier.

- **TV, utilities, virtual numbers and virtual cards**
  - Validate relevant identifiers such as meter, smartcard or customer numbers where supplier APIs support validation.
  - Show the biller, package, country, total payable amount and any fees before confirmation.
  - Deliver bill receipts, electricity tokens and subscription confirmation where applicable.
  - For virtual numbers, disclose supported SMS/voice capabilities, rental period, renewal charges and intended usage restrictions.
  - Manage virtual-number provisioning, message access, expiry and renewal within supplier-supported capabilities.
  - For virtual payment cards, define issuance, funding, fees, limits and verification according to the selected issuing partner.
  - Separate these services from ordinary gift-card delivery because their lifecycle and verification requirements differ.

- **Commercial model**
  - BitoCard earns a margin between supplier acquisition cost and its reseller wholesale price.
  - Resellers earn the permitted difference between their retail price and BitoCard wholesale cost, after applicable fees.
  - Domain registration/renewal and additional services can contribute disclosed margins.
  - Gift-card exchanges use transparent buy/sell quotes and applicable fees.
  - Storefront subscription fees, API fees and other platform charges remain pricing decisions to finalize; this brief does not assume them.

- **Technology direction**
  - Next.js and React for storefronts and dashboards.
  - RTK Query for frontend GraphQL requests, caching and refresh behaviour.
  - NestJS and Apollo GraphQL for the backend API.
  - Business services coordinate catalogue, quotes, pricing, routing, wallets and orders.
  - Server-side partner adapters translate normalized operations to individual supplier APIs.
  - Proposed PostgreSQL/Prisma storage, Redis caching and RabbitMQ background fulfilment/reconciliation.
  - BigQuery is an optional later analytics layer, outside the live transaction path.

- **Reseller API: later phase**
  - Authenticated catalogue, availability, quote, order, status and wallet access.
  - Signed webhooks and scoped reseller credentials.
  - Apply the same funding, pricing, authorization and routing rules as hosted storefronts.
  - Keep upstream providers and their credentials private.

- **Administration and operations**
  - Supplier configuration, product mapping, pricing rules and market controls.
  - Reseller approval, verification and storefront/domain management.
  - Order history, receipts, status updates, support and exception review.
  - Payment, provider and ledger reconciliation, refund handling and margin reporting.
  - Manage recurring number rentals, software subscriptions and domain renewals separately from one-time digital purchases.
  - Monitor provider health, rate changes, low supplier balances and fulfilment exceptions.
  - Provide role-based administration, audit history and controlled manual adjustments.
  - Apply applicable verification, privacy, licensing and payment-partner requirements by country and product.
  - Track activation time, active resellers, paid orders, fulfilment success, delivery time, net margin, funding exceptions and promotional principal recovery.

- **Brand and current coming soon page**
  - Navy and pink identity with the interlocking B/exchange-arrow logo.
  - Compact mobile-first page and a full-screen desktop presentation.
  - Positioning: launch a branded digital-products store in minutes, backed by BitoCard sourcing and fulfilment.
  - Core promises: reliable delivery, transparent rates and a straightforward customer experience.
  - How it works and For resellers open information dialogs.
  - Illustrative storefront and Golojan Ltd ownership credit.
  - The current page is a preview; operational onboarding, payments and fulfilment remain planned.
  - AGENTS.md records the page requirements and product direction.

- **Release approach**
  - Prove catalogue, funding, routing, orders and fulfilment through Golojan's first storefront.
  - Enable independent reseller onboarding, branding, pricing and reporting.
  - Add domain purchases and existing-domain connections alongside the storefront rollout.
  - Enable gift-card sales, trades and additional digital services as provider integrations are ready.
  - Launch the reseller API after hosted workflows and operational controls are stable.

- **MVP acceptance criteria**
  - A reseller can create, configure and publish a subdomain store through a short guided flow.
  - Confirmed deposits credit the correct wallet once; concurrent orders cannot overspend available funds.
  - A funded order receives a valid quote, reserves funds, reaches a recorded fulfilment outcome and produces a receipt.
  - Confirmed failures release or refund funds correctly; uncertain outcomes enter reconciliation.
  - Reseller and customer data remain isolated across storefronts.
  - Admins can trace every order from customer payment through provider fulfilment and ledger entries.
  - Supplier identities and credentials remain internal to BitoCard.
  - Promotional credit recovery and customer-bonus spending can be audited separately.

- **Phased delivery and deferred scope**
  - Phase 1: own-brand pilot, initial gift-card/top-up catalogue, prefunded wallets, order tracking and administration.
  - Phase 2: independent reseller onboarding, branded storefronts, pricing, reporting and domain services.
  - Phase 3: gift-card selling/trading and additional categories, including eSIMs and software, as their integrations become ready.
  - Launch incentives become available only after recovery, settlement and anti-abuse controls are tested.
  - Phase 4: public reseller API and broader country/category coverage.
  - Physical-goods marketplace integrations, including Jumia/Konga-style catalogues, remain deferred.
  - Finalize supplier contracts, geographic eligibility, payment channels, domain registrar, promotion terms and commercial pricing before launch.
