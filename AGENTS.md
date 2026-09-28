# BitoCard Coming Soon Site

## Project purpose

BitoCard is a reseller-first platform owned by Golojan Ltd. It will let approved resellers launch branded storefronts for digital gift cards, mobile airtime, data, and other supported utilities. BitoCard supplies a unified catalogue and fulfilment layer. Resellers serve their own customers, set customer-facing prices, and pre-fund their reseller wallets before taking paid orders.

The intended markets are the UK, US, and selected African countries, enabled country by country as provider coverage, payments, verification, and operations are ready. BitoCard's consumer-facing offering is buying, selling, and trading eligible digital gift cards and buying supported utility products through reseller storefronts.

The planned upstream sources are Reloadly, Prestmit, and Cardtonic. BitoCard selects a suitable source internally using availability and net profitability. Do not expose upstream provider identities, costs, credentials, or routing rules to storefront visitors or resellers. The reseller API is a later phase. Provider coverage, terms, and live access must be confirmed before implementation.

## Product model and planned features

### Who uses BitoCard

- **Platform operators (Golojan Ltd):** manage providers, supported markets, product mapping, pricing rules, reseller approvals, transactions, fulfilment exceptions, and support.
- **BitoCard's own reselling brand:** the first tenant and reference storefront, launched on a subdomain of the BitoCard platform.
- **Independent resellers:** create and manage branded storefronts for their own customers. They interact with BitoCard as their supplier, without selecting or seeing the underlying source.
- **Storefront customers:** browse products, buy digital goods, and, where enabled, submit eligible gift cards for sale or trade.

### Reseller storefronts

- Target a short, self-service store setup: account verification, store name and BitoCard subdomain, branding, product selection, suggested margins or reseller pricing, preview, and launch. **Five minutes is a setup goal**, not a promise that funding, verification, domain propagation, or the first order completes within five minutes.
- Provide a hosted storefront on a BitoCard subdomain first. Allow an optional verified custom domain with HTTPS later.
- Give each reseller control of their customer-facing brand, eligible catalogue, prices or margins, store settings, orders, and reports, subject to platform and market rules.
- Use a **pre-funded reseller wallet**. Require sufficient available balance to cover the BitoCard wholesale cost before accepting an order. A published store may exist before funding, but paid checkout cannot operate until funding and any required verification are complete.
- Keep the reseller's customer relationship and customer-facing support context distinct from BitoCard's upstream supplier relationships.

### Catalogue and transactions

- Present one BitoCard catalogue across supported countries, currencies, denominations, and product types. Initial categories are digital gift cards, mobile airtime, and data; other utilities or virtual cards are future or market-dependent additions.
- **Buy:** show a final quote, reserve the required balance, submit one fulfilment order, deliver the result, and record the transaction. Release the reservation if an order fails without delivery.
- **Sell:** where supported, accept an eligible unused gift card for a time-limited quote and verification. Keep the submission pending until the source confirms acceptance; only then settle the customer or reseller balance. Never treat an unverified card as cleared funds.
- **Trade:** treat an exchange as a linked verified sale and new purchase. The incoming card must be accepted before an outgoing product is delivered. Show any value difference and applicable fees before confirmation.
- Availability, exchange methods, funding methods, and final prices vary by market. Do not promise a product or payout route solely because a provider advertises it elsewhere.

### Internal sourcing and switching

- Normalize provider products, country rules, denominations, costs, quotes, order states, and webhook events behind BitoCard-owned interfaces.
- For purchases, choose an eligible available source by **net margin**, after provider cost, FX, fees, and operational constraints; use fulfilment reliability and market eligibility as routing safeguards.
- For incoming gift card sales, route to an eligible source offering the best viable net return after verification and settlement costs.
- Lock the customer-facing quote for its stated validity period. A fallback to another source must still honour that quote and avoid duplicate fulfilment. If neither is possible, fail clearly and release the wallet reservation.
- Keep provider identities, credentials, cost prices, internal routing decisions, and supplier-specific error details out of reseller and customer interfaces and the future reseller API.

### Wallet, records, and operations

- Keep a durable, auditable transaction ledger for funding, pending funds, available funds, reservations, debits, releases, refunds, settlements, fees, and reseller margins. Do not use a client-side balance as the source of truth.
- Credit wallet funds only after a payment is confirmed. Make provider orders and webhook handling idempotent so retries cannot charge or fulfil twice.
- Record the customer price, reseller wholesale cost, BitoCard supplier cost, applicable fees/FX, and resulting margins separately. Show each party only the amounts they are entitled to see.
- Provide order history, status updates, receipts, exception review, support workflows, and admin reconciliation.
- Add identity checks, fraud controls, payment integration, market-specific terms, and provider agreements before accepting real funds or gift card codes.

### Reseller API (later phase)

Offer authenticated, scoped access to BitoCard's catalogue, availability, quotes, order creation, order status, wallet balance, and signed webhooks so approved resellers can use their own websites or apps. Apply the same pricing, funding, routing, and data isolation rules as the hosted storefronts. Do not expose upstream APIs directly.

## Release sequence

1. Prove the platform with BitoCard's own reselling storefront: accounts, catalogue, funding, ledger, buying, routing, fulfilment, support, and administration.
2. Open hosted reseller onboarding, BitoCard subdomains, branding, pricing, reports, and optional custom domains.
3. Add eligible gift card selling and linked trades where provider verification and settlement flows are ready.
4. Release the reseller API after the hosted workflows and operational controls are stable.

## Current deliverable

This repository currently contains a **coming soon page**, not the trading platform. The coming-soon page is a compact, mobile-first, single-screen desktop layout in `apps/storefront/app/page.tsx`. `apps/storefront/public/bitocard-logo.png` is the approved logo and site icon. The two information actions, **How it works** and **For resellers**, open native HTML dialogs. Keep keyboard focus, Escape closing, accessible dialog labels, and a usable mobile layout intact.

The page must communicate that the product is coming soon. Do not add a working signup form, wallet, checkout, live prices, supplier catalogue, or claims of active fulfilment unless the necessary backend and provider integrations are implemented. A storefront mockup is illustrative.

## Brand and copy

- Name: **BitoCard**; ownership credit: **A Golojan Ltd venture**.
- Preferred icon: the user-supplied interlocking B/exchange-arrow mark, with its original dark navy areas and the original yellow areas changed to vivid pink. Keep the recognisable shape and transparent background. Before the next visual release, align the site icon with this latest approved navy-and-pink treatment.
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

## Legal pages

- The storefront publishes `/legal` (overview), `/legal/privacy`, `/legal/terms`, `/legal/cookies` and `/legal/notice`, linked from the home page footer. They target global visitors, with region sections for Europe (UK/EEA/Switzerland), the United States, Canada, Africa and Asia.
- Entities, regions, governing law, contact (`legal@bitocard.com`) and the "last updated" date live in `packages/ui/src/legal.ts`. Change them there, and bump `legalUpdated` whenever any legal page changes.
- Entity by region: Golojan Technologies LLC (Delaware) for the Americas, Asia and anywhere unlisted; Golojan LLC (England and Wales) for the UK and Europe; De-Golojan Technologies Ltd (Nigeria) for Africa.
- The pages describe what the site actually does: no cookies, local storage, analytics, forms or accounts. Update the privacy and cookie notices **before** adding analytics, a signup form, sign-in or any other data collection, and add a consent banner before any optional cookie.
- Company numbers, registered addresses and an EU GDPR representative are not yet recorded; never invent them. These drafts need review by qualified lawyers in each target region before launch.

## Repository and delivery

- This is an npm-workspaces Turborepo with five applications in `apps/`. `docs`, `storefront`, `admin` and `reseller` are Next.js apps: use App Router directly in each and do not introduce `src/` wrappers. `api` is a NestJS 12 app with the standard Nest `src/` layout. Root tooling and this file stay at the repository root.
- API rules: keep the entrypoint at `apps/api/src/main.ts` and app setup in `src/bootstrap.ts`. Never name a top-level `src/` file `app`, `index` or `server`, because Vercel would pick it as the entrypoint. Build with `nest build` (tsc, decorator metadata on), not an esbuild or SWC bundler. Mark providers `@Injectable()` and rely on constructor injection.
- Shared code lives in `packages/`: `@bitocard/ui` (brand, coming-soon workspace page, site constants), `@bitocard/next-config` (`createNextConfig`, security headers, noindex for private apps), `@bitocard/eslint-config` and `@bitocard/typescript-config`. Put cross-app code there rather than copying it between apps. Packages ship TypeScript source with no build step.
- Deployment target is Vercel: one Vercel project per app, Root Directory `apps/<app>`, with install, build and ignore commands in each app's `vercel.json` (static settings; no `@vercel/config` dependency). The original Sites output and `.openai/hosting.json` are absent; if that hosting identity is restored, reuse it rather than creating a second Site.
- Preserve the existing private audience unless the user explicitly requests a sharing change.
- For changes, run `npm run check` (lint and typecheck, then build; do not run typecheck and build in parallel). Verify responsive layout and dialog behaviour for storefront edits. Do not claim publication without a configured deployment workflow.
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
