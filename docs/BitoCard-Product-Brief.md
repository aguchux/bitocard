# BitoCard Product Brief

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
  - Supported utility bills and TV subscriptions.
  - Virtual payment cards, subject to supplier access and market eligibility.
  - SMS-capable virtual numbers, subject to inventory, capabilities and supplier agreements.
  - Products, denominations, currencies, payment methods and exchange options vary by country.
  - Physical goods and integrations with stores such as Jumia and Konga are deferred.

- **Supplier aggregation and routing**
  - Initial planned sources: Reloadly, Prestmit and Cardtonic.
  - TV, utilities, virtual-card and virtual-number suppliers are under evaluation; no additional supplier is confirmed by this brief.
  - Resellers see one BitoCard catalogue, price and order status. Supplier identities, credentials, costs and routing decisions remain internal.
  - Normalize equivalent supplier products into BitoCard product IDs while preserving country, denomination and service restrictions.
  - Select eligible purchase sources by availability, net margin, total costs and fulfilment reliability.
  - Select gift-card sale sources by the best viable net return and supported verification/settlement flow.
  - Lock customer-facing quotes for their stated validity period.
  - Reconcile uncertain orders before retrying or switching sources to prevent duplicate fulfilment.
  - Rented phone numbers remain with their original supplier unless formally ported.

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
  - Paid orders require sufficient available reseller funds to cover BitoCard's wholesale cost.

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
  - Record customer price, reseller wholesale cost, supplier cost, FX, fees and resulting margins separately.
  - Credit funding only after confirmed payment and use idempotent processing to prevent duplicate credits or orders.
  - Enforce server-side authorization and isolate each reseller's customer and transaction data.

- **Market-entry promotion**
  - Proposed $500 recoverable startup credit enables eligible resellers to begin without initial cash funding.
  - Promotional sales must use BitoCard payment channels so recovery can be enforced.
  - Recover 100% of the startup principal through sales while allocating earned reseller profit.
  - After complete recovery, the reseller continues through normal wallet funding.
  - Proposed $1 retail welcome bonus supports eligible purchases during the promotional period.
  - Finalize eligibility, limits, expiry, refunds, recovery allocation and accounting before launch.
  - Recovery is a programme requirement; this brief does not establish that defaults or fraud can cause no loss.

- **Funding channels**
  - Evaluate dedicated or reserved bank accounts for automatic wallet funding.
  - Match confirmed deposits to the correct customer or reseller.
  - Select country-specific payment and banking partners; universal coverage is not yet confirmed.

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
  - Manage recurring number rentals and domain renewals separately from one-time digital purchases.

- **Brand and current coming soon page**
  - Navy and pink identity with the interlocking B/exchange-arrow logo.
  - Compact mobile-first page and a full-screen desktop presentation.
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
