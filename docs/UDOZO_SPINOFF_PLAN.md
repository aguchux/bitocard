# Udozo: Shop and B2B spin-off plan

Decided by the owner on 30 October 2026. **BitoCard Shop** (the B2C classifieds marketplace with Safe pay and the Anjio shop assistants; `docs/BITOCARD_CLASSIFIEDS_PLAN.md`) and **B2B reselling** (suppliers' listings sold on resellers' Resale shop stores; `docs/BITOCARD_B2B_RESELLING_PLAN.md`) leave BitoCard and become their own brand, **Udozo**, at **udozo.com**. The domain is already owned. It was a memorial portal, which the owner is deleting themselves; nothing of it is carried over and no work for it is in this plan.

**Status:** steps 1 and 2 built (30 October 2026); the rest planned.

## The decision

1. **The Shop and B2B leave BitoCard.**
   - BitoCard's API, apps and documents no longer serve them: no Shop tab, no shop.bitocard.com, no SHQ Resale section, no Resale shop template, no `/v1/resale` in BitoCard's API docs.
   - Nothing in the Shop is live with real customers: every `classifieds_*` switch is off live and its legal review is still owed. So this is a re-platforming with no data to move.
2. **Udozo is its own product.** It has its own domain, brand, accounts, money, admins, books and apps.
3. **Its own database and Redis.** Udozo runs **the same API code as a second deployment** (`APP_PRODUCT=udozo`). This makes Udozo more separate than Afrippa, which shares BitoCard's database behind a `platform` column. Udozo's whole database is its own, so no product columns are needed in it.
4. **Built on BitoCard.** Udozo's apps keep BitoCard's components, layouts and behaviour and build on them. Udozo's admins choose its colour theme.

## The owner's answers (30 October 2026)

1. **Brand:** Udozo, `udozo.com`.
2. **Infrastructure:**
   - its own Postgres database (Neon, US) and Redis (Upstash);
   - the same `apps/api` code deployed again as `api.udozo.com`, **on BitoCard's droplet** as a second compose stack;
   - its own environment: `DATABASE_URL`, Redis, `ENCRYPTION_KEY`, `CRON_SECRET`, `STORE_SERVER_SECRET`, the admin settings.
3. **Accounts:**
   - Udozo's own, in its own database: an email at BitoCard and at Udozo are two unrelated accounts, and there is no handoff between the products.
   - **One Udozo account works on udozo.com and on every reseller store**: one wallet and one purchase history.
4. **Everything is by country:**
   - A shopper's country is fixed at sign-up (as BitoCard's `customers.country`). Their wallet and payouts are in its currency, and they buy and sell only in their own market (`udozo.com/<cc>`).
   - A reseller's business country is fixed. Their catalogue lists only suppliers' listings from that country.
   - A reseller's stores sell only to shoppers of that country. Others may browse, but their checkout is refused (`market_unavailable`) and the store says it sells only to that country.
5. **Money:** Udozo's own merchant accounts (Paystack, Flutterwave, pawaPay, the transfer provider), set in its own integration settings, and its own books. Udozo, not BitoCard, holds Safe pay money.
6. **B2B leaves with the Shop:**
   - **Seller HQ** at `shq.udozo.com` (Udozo's SHQ). One account runs **any number of stores**: there is no store limit.
   - **Subdomains are only for the sandbox and testing.** Every store gets `<store>.udozo.com` at once, provisioned automatically by Vercel through a wildcard on Udozo's stores project, so no DNS record is made per store. A store on its subdomain runs only in the sandbox.
   - **A live store must use its own domain,** bought through Vercel automatically (purchase, connection and certificate) or connected. Once live, the subdomain redirects to it.
   - Udozo has its own reseller API and webhooks.
7. **Admin:** `admin.udozo.com`, with Udozo's own admins.
8. **Apps:** Udozo's own apps (`apps/udozo`, `apps/udozo-shq`, `apps/udozo-admin`), built from BitoCard's shared components and UI, plus verify.udozo.com.
9. **Theme:** Udozo's admins choose the colour theme, which is applied to every Udozo app and email.
10. **Plans and fees, all gated by Udozo's admins:**
    - **Premium** is a monthly fee and includes **a free domain**.
    - A one-time **Seller HQ setup fee** can be switched on or off by admins, with its amount set per market.
    - **The setup fee and the first Premium month must cover the domain purchase.** Renewals are covered by the monthly fee.
    - Resellers without Premium pay for their domains themselves.

## Addresses

| Address | What it serves |
|---|---|
| `udozo.com` | The marketplace (markets at `/ng`), sign-up and sign-in, posting (`/sell`), and the seller's area (`/account`: listings, messages, orders, favourites, Safe pay, payouts, and My Resellers at `/account/resellers`) |
| `udozo.com/<cc>/l/<number>-<slug>` | A public listing. Resale-only listings never appear here |
| `shq.udozo.com` | Seller HQ: sign-up, KYB, the resale catalogue, listings and rules, stores (any number), design, domains, Premium and the setup fee, orders, wallet, payouts, reports, developers |
| `<store>.udozo.com` | A store in the **sandbox only** |
| `<the reseller's own domain>` | The **live** store: `/listings`, `/l/<ref>-<slug>`, `/suppliers/<id>`, `/account/purchases`, signed in with the shopper's Udozo account through the sign-in handoff |
| `admin.udozo.com` | Udozo's admin |
| `verify.udozo.com` | Identity checks (KYC, and KYB for resellers) |
| `api.udozo.com` | Udozo's API instance |

## How things flow

1. **Posting:** a seller posts at `udozo.com/sell`. In **Where to sell** they choose Udozo, resellers or both, with the stock, the resellers' discount and the markup limit. After review the listing is live at `udozo.com/<cc>/l/…`.
2. **Opening a listing to resellers:** no separate step. The listing joins the resale catalogue of resellers in the seller's country. The seller works with them at `udozo.com/account/resellers`: notes to approve, deals, the chat, stopping a reseller, and accepting orders automatically.
3. **Reselling:**
   - The reseller signs up at `shq.udozo.com` and passes KYB at `verify.udozo.com`.
   - They add listings at their own prices within the supplier's limits.
   - They create stores, which are tested on `<store>.udozo.com`.
   - They take Premium (getting the free domain) or buy or connect a domain, then go live on it.
4. **Buying on a store:**
   1. The shopper pays from their Udozo wallet; the money is locked.
   2. The supplier accepts at `udozo.com/account/orders/<id>`, or auto-accept does it; the money moves to escrow.
   3. The supplier ships or hands the item over.
   4. The buyer confirms, and the release is split three ways: the supplier's payouts, the reseller's earnings in Seller HQ, and Udozo's fees.

## What is reused

Everything in the Shop and B2B is reused and carried over to Udozo, not rewritten:
- **API:** `src/classifieds` (including the shop assistants) and `src/resale`;
- **apps:** `apps/shop`, the storefront's Shop tab and resale store pages, SHQ's Resale section, and the admin app's Shop section;
- **packages:** `@bitocard/api-client/classifieds`, `resale` and `shop-assistants`, `@bitocard/ui/shop-terms`, `handoff` and `handoff-ui`.

The shared foundations come with it, in Udozo's own database:
- customer accounts, two-step and sessions;
- customer wallets, payments, payouts and the ledger;
- BitoCard Verify, support tickets, live chat and AI;
- media, stores and templates, domains (Vercel);
- plans, subscriptions and invoices;
- webhooks, notifications and push, settings and integrations, and the audit log.

## Steps

### 0. Owner and operations inputs
1. **DNS for udozo.com:**
   - nameservers on **Vercel DNS**, with the wildcard `*.udozo.com` on Udozo's stores project, so sandbox subdomains need no record per store;
   - records for `shq`, `admin` and `verify`;
   - Udozo's Vercel account for buying resellers' domains (Domains Registrar API) and adding them to the stores project.
2. **`api.udozo.com` on the shared droplet.** It is not on a Cloudflare zone, so Cloudflare cannot proxy it, and the droplet's firewall (`bitocard-api`) admits only Cloudflare's ranges today.
   - **Recommended:** open 80 and 443. Caddy serves `api.udozo.com` with a Let's Encrypt certificate and takes the visitor's address from the connection. Caddy also limits the `api.bitocard.com` site to Cloudflare's ranges (`remote_ip`), so BitoCard stays behind Cloudflare.
   - The alternative is a Cloudflare zone for a separate API host name.
3. A Neon project (US) and an Upstash Redis database for Udozo.
4. **The operating entity.** A separate company is recommended, as the money holder and data controller. Udozo's own Paystack, Flutterwave and pawaPay accounts are opened under it.
5. Legal advice per market on Safe pay escrow through licensed partners. This is the open point the Shop terms already carry.
6. The starting prices per market: Premium, the setup fee, and the domain endings offered.
7. The shop assistant keeps the name **Anjio** unless the owner says otherwise.

### 1. Product mode in the API (ships alone; BitoCard unchanged)
1. **`APP_PRODUCT`** (environment only): `bitocard` by default, or `udozo`. A small `src/products/product.ts` holds everything that names the product:
   - the name, the sender name and the support address;
   - the site, admin, SHQ and verify URLs;
   - cookie names: `bc_*`, or `udz_customer`, `udz_session` and `udz_admin_session`;
   - the API key prefix (`bc_` or `udz_`) and the webhook signature header;
   - the authenticator issuer, the Verify brand and the push icon;
   - the store host domain (`bitocard.com` or `udozo.com`).

   Code that names BitoCard today reads it instead: `sessionPolicy`, `apiKeyPattern` in `auth.guard.ts`, email templates, `ShopEmails`, the `HandoffService` targets, and `SHOP_URL`, which becomes the product's own site.
2. **Modules per product** (`app.module.ts`):
   - **BitoCard** mounts everything except `ClassifiedsModule` and `ResaleModule`. Its `/v1/classifieds*`, `/v1/resale*`, `/v1/store/resale*` and `/v1/store/cash` then answer as unknown routes.
   - **Udozo** mounts the shared foundations plus classifieds and resale. It mounts none of: suppliers, the catalogue, orders, eSIMs, numbers, VPN, Spin and win, crypto or Afrippa.
   - A shared module that imports a BitoCard-only one is split or given a hook, as `StorefrontService.useResale` already is. For example, `ResaleModule` reaches the catalogue through `StorefrontModule`.
3. **Product-scoped pieces:**
   - **Jobs:** `cron.json` jobs say which products they run for, and each instance's scheduler runs its own.
   - **OpenAPI:** one document per product. BitoCard's loses the Resale tag; Udozo's has it.
   - **Settings and integrations:** the switch and integration lists are per product (`switchKeysFor`, `groupsFor`), so Udozo's admin shows only what Udozo uses. That is payment gateways, email, SMS, AI, storage, push, Vercel and Google; never suppliers, crypto or the Cloudflare store addresses.
4. `CustomerCashController` (Safe pay payouts) moves from `src/crypto/crypto.controller.ts` into `src/payouts`.
5. **Product seed:** `scripts/product-seed.mjs`, run by deploy after the migrations, and safe to run again.
   - The same migrations run on both databases.
   - Udozo's seed renames the house store and root account to Udozo and makes its plans (Startup and Premium).
   - It also hides the rows Udozo does not use: Afrippa's operator, the supplier registry and Enterprise.
   - **Rule:** every migration runs on both databases. Data only one product wants goes in the product seed.
6. **Tests** (`test/product-mode.test.mjs`):
   - booting each product lists its routes: BitoCard has no Shop or Resale routes, and Udozo has no catalogue, orders, crypto or Afrippa routes;
   - cookie names, key prefixes and senders follow the product;
   - every existing test passes in BitoCard mode;
   - the classifieds and resale tests run in Udozo mode.

**Step 1 status (30 October 2026): built.**
- **Routes are owned per controller, not by unmounting modules.**
  - `@ProductOnly('bitocard' | 'udozo')` marks every controller (or route) of one product; unmarked ones are shared.
  - `ProductRoutesGuard`, the first global guard, answers the other product's routes as unknown routes. `PRODUCT_ROUTES=all` (tests and local development; refused in production) serves every route.
  - **Why not unmount modules:** `CheckoutModule` imports the catalogue and orders, so unmounting would pull in BitoCard's whole commerce. Splitting the modules can come later; the guard already keeps each instance to its own surface.
- **Udozo's:** classifieds, shop assistants, resale, Safe pay payouts (`/v1/store/cash`, `/v1/admin/crypto/payouts`) and the resale reports.
- **BitoCard's:** Afrippa and crypto; catalogue, quotes, pricing, suppliers, stock; orders, numbers, eSIMs, VPN; Spin and win; order disputes; checkout and the storefront catalogue; country stores; resellers' own integrations and platform fees; customers' checks by reference.
- **Names per product** (`src/products/product.ts`, `productOf(config)`): session cookies (`udz_session`, `udz_admin_session`), API keys (`udz_test_…`; a key of the other product's shape is refused unread), the webhook signature header (`Udozo-Signature`), and the admins' authenticator and emails (`Udozo Admin`).
- **Jobs:** `cron.json` names the owner of product jobs (`src/products/jobs.ts`, `jobOwners`). Each scheduler runs its own and the shared ones, and the API refuses the other product's (404).
- **OpenAPI:** each instance describes only its own routes. BitoCard's `openapi.json` lost the Resale endpoints, and the docs' Resale section went with them (changelog entry).
- **Product seed:** `scripts/product-seed.mjs`, run by `migrate-deploy.mjs` after migrations. On Udozo's database it names the house accounts and marketplace store Udozo, unpublishes BitoCard's country stores, and hides Enterprise.
- **Tests:** `test/product-mode.test.mjs` sweeps both instances, both ways. The resale tests run as Udozo (`APP_PRODUCT=udozo`), so their responses are checked against Udozo's document.
- **Left for later steps:**
  - moving `CustomerCashController` out of `src/crypto` (its gate is `CryptoWalletsService.requireCashOut`) and the rest of Udozo's branding (emails, the other webhook headers), in step 3;
  - the `resale_order.*` event types in BitoCard's webhook catalogue and the apps' pages, in step 2.

### 2. Unhook the Shop and B2B from BitoCard's apps
1. **Storefront** (these go):
   - the Shop tab (`app/(app)/shop`, `components/app/shop/*`, `lib/shop*.ts`, `shopTab` in `components/app/tabs.ts`);
   - `ShopBand`;
   - the Resale shop template's pages and components (`/listings`, `/l/`, `/suppliers`, `/account/purchases`, `components/store/resale*.tsx`);
   - the `/shop/l/` redirect and the header's Shop link.
2. **SHQ:** `(console)/resale` and its nav entries go, and the `resale_shop` template leaves BitoCard's templates. No live store uses it.
3. **Admin:**
   - `(console)/classifieds`, `components/shop-assistants`, Support's shop assistants and Reports > Safe pay and resale go;
   - the Shop menu in `packages/admin-ui/src/shell/nav.ts` goes;
   - the resale standing card leaves the reseller page.
4. **Handoff:** shop.bitocard.com leaves the handoff (`isHouseOrigin` in `@bitocard/ui/handoff`, `appUrl("shop")`). The handoff stays between bitocard.com and its country stores.
5. **Legal:** BitoCard's documents lose the Shop terms, the Shop sections of the privacy and cookie notices, and reseller terms 12b (`apps/legals`, `packages/ui/src/legal.ts`), and `legalUpdated` is bumped.
6. **Docs:** `AGENTS.md`, `PLANS.md` and the Classifieds and B2B plans point here.

The code is moved to Udozo's apps (step 4), not deleted.

**Step 2 status (30 October 2026): built.** The removed apps' code is in git at `f5ee491` (the step 1 commit, the last tree with it): step 4 takes it from there.
- **Storefront** (removed):
  - the Shop tab and its pages (Payouts included), the home page's Shop band, the Shop quick link;
  - the Resale shop's pages (`/listings`, `/l/`, `/suppliers`, `/account/purchases`) and their sections and heroes;
  - the `/shop/l/` redirect, and the Shop terms link.
  - Account is always a tab again, and `/account/crypto/cash-out` goes to the wallet.
- **SHQ:** the Resale section is gone (`/resale` redirects to `/store`), so are the resale scopes' labels and the Resale orders report, and the template picker never offers the Resale shop.
- **Admin:** the Shop section, the shop assistants, Safe pay payouts and Reports > Safe pay and resale are gone, with redirects for their old addresses. The rail's Shop entry is gone too (`packages/admin-ui` nav, tested in `test/nav.test.ts`).
- **Legal:** the Shop terms are gone (redirected to the documents hub), along with the Shop sections of the privacy and cookie notices (`bc_assistant` removed), reseller terms 12b and the terms of use's pointer. `legalUpdated` is 30 October 2026.
- **Handoff:** shop.bitocard.com is no longer a target, neither in `isHouseOrigin` nor in the API's `HandoffService`. The old Shop app no longer offers BitoCard's sign-in.
- **API:**
  - the Resale shop template is neither listed nor chosen on BitoCard (`template_unknown`);
  - the Shop's switches are hidden from BitoCard's admins and resellers (`udozoSwitches`, `switchKeysFor`);
  - resale API key scopes are refused on BitoCard (`apiKeyScopesFor`);
  - `resale_order.*` events are refused for BitoCard's endpoints and left out of its OpenAPI document (`eventOwners`, `eventTypesFor`, `withoutOtherEvents`);
  - SHQ's generated lists follow (`api-lists.generated.ts`);
  - the Shop's API tests run as Udozo.
- **Note:** shop.bitocard.com is still deployed and now fails against BitoCard's API. Pausing its Vercel project (`bitocard-shop`) is an operations step until step 4 makes it Udozo's.

### 3. Udozo's rules in the API
1. **One account everywhere:** in Udozo, every store's customer accounts are the house store's, as BitoCard's country stores share bitocard.com's (`StoreSellers.accountStore`, `CustomersService.countryStore`).
2. **The Udozo sign-in handoff** is needed from launch, because live stores are on their own domains.
   1. A store's sign-in sends the shopper to `udozo.com/handoff/go?to=<store origin>&next=<path>`, which signs them in on udozo.com if needed.
   2. udozo.com then returns them to `<store origin>/handoff#c=<code>`.
   3. There the store's server exchanges the code once for its own host-only session.

   This reuses `HandoffService`, `customer_handoffs`, `@bitocard/ui/handoff` and `handoff-ui`. The only targets allowed are udozo.com and Udozo stores' active domains and subdomains.
3. **By country:**
   - the shopper's fixed country is checked in resale quotes and orders, Safe pay and the store's checkout;
   - the reseller's catalogue is filtered to their country (`ResaleStoresService`).
4. **Stores:**
   - **No limit:** `maxStoresPerReseller` becomes a product setting, and Udozo has none.
   - **One template:** Udozo's stores use `resale_shop` only (`src/stores/templates.ts` per product).
   - **Subdomains:** served by the wildcard, so `StoreHostsService` (BitoCard's Cloudflare records) does nothing in Udozo.
   - **Live needs a domain:** `checkout_mode` may be `live` only with an active domain (`domain_required`, 409). It goes back to `test` when the store's last active domain is lost (expired, suspended or disconnected). On a live store, the subdomain redirects to the primary domain for good.
5. **Domains:** `src/domains` (`StoreDomainsService`: buying through Vercel, connecting, DNS, renewals) on Udozo's own Vercel settings. It is gated on Udozo's own switch, not BitoCard's `custom_domains` plan feature.
6. **Plans and fees:** BitoCard's plan code (`PlansService`, `PlanAccessService`, subscriptions, the `plans` job with its 7-day grace), plus:
   - **The `free_domains` plan limit:** 0 for BitoCard; 1 for Udozo's Premium, set by admins. Purchases and renewals it covers cost the reseller nothing, and the domain's cost is posted as Udozo's promotion expense.
   - **The setup fee:** a per-market setting in Udozo's admin (on or off, and its amount). It is charged once from the wallet (`setup_fee:<reseller>`), and going live answers `setup_fee_unpaid` until it is paid.
   - **Taking Premium** charges the setup fee (when on and unpaid) and the first month together. Only then is the free domain bought through Vercel, and only within what they collected. A dearer domain answers `domain_not_covered`, with the difference to pay.
   - **A warning for admins:** they are warned (`fees_below_domain_price`) when a market's setup fee plus one month is below the price of its endings.
7. **Theme:**
   - `GET /v1/theme` (public, cached) and `PUT /v1/admin/theme` (operations, step-up, audited);
   - ready-made themes, or custom primary, accent, ink and page colours, with a contrast check (`theme_contrast`) and a preview before publishing;
   - BitoCard's navy and pink are the default until Udozo's own theme is chosen.
8. **Branding in the API:** the shop emails, notices, the assistant's rules (`shopSystemPrompt`), Verify outcomes and the authenticator issuer say Udozo, from the product config.

### 4. Udozo's apps (its own apps, on BitoCard's shared UI)
1. **`apps/udozo`** (`@udozo/web`, from `apps/shop`) serves `udozo.com`, `*.udozo.com` and connected domains:
   - the marketplace, sign-up (new) and the handoff;
   - `/sell` and `/account/*`, moved from the storefront's Shop tab into a new `packages/udozo-ui`;
   - the resale store pages, moved from the storefront;
   - Udozo's brand assets (a third brand in `scripts/brand-assets.py`);
   - the theme, applied as CSS variables as `storeShell` does.
2. **`apps/udozo-shq`** (`shq.udozo.com`), on `ConsoleShell` and `@bitocard/admin-ui`, built from SHQ's screens:
   - resale (moved), stores (any number) and the design editor (`HomeEditor`);
   - Store > Domains: buy or connect, with the free Premium domain marked;
   - Premium and the setup fee, wallet, payouts, reports and developers;
   - the first-store guide.
3. **`apps/udozo-admin`** (`admin.udozo.com`), on the shared admin shell:
   - the Shop section (moved from BitoCard's admin), shop assistants, and Safe pay and resale reports;
   - resellers, plans and the setup fee, domains and the theme;
   - markets and payment methods, and integrations;
   - support, verifications, the books and the activity log.
4. **verify.udozo.com:** `NEXT_PUBLIC_VERIFY_BRAND=udozo`, a third brand in `apps/verify/lib/brand.ts`.
5. Every Udozo app calls `api.udozo.com` through its `NEXT_PUBLIC_API_URL`.

### 5. Deploy and launch
1. **The droplet:**
   - `api-udozo` and `scheduler-udozo` in `deploy/droplet/docker-compose.yml`, from the same image, with secrets in `/etc/udozo/api.env`;
   - a Caddy site for `api.udozo.com` (step 0 item 2);
   - `deploy.sh` migrating and seeding both databases and waiting for both instances to be healthy;
   - `deploy-api.yml` smoke-testing both hosts.
2. **Vercel projects:** udozo (with the wildcard), udozo-shq, udozo-admin and verify-udozo, each with affected-projects skipping and `VERCEL_DEEP_CLONE`.
3. **Udozo's legal documents** (terms, Safe pay, reseller terms, privacy, cookies), accepted by version.
4. **Browser checks** at 375 px, and a sandbox store on its subdomain taken live on a connected domain.
5. **A pilot** in one market.

### 6. Later
Drop the Shop and resale tables from BitoCard's database once they are confirmed empty.

## Verification
- **Each step:** `npm run check`, plus the affected API tests on PGlite and Docker (`npm run test:docker`).
- **Step 1:** `product-mode.test.mjs` passes for both products, and every existing test passes in BitoCard mode.
- **Step 2:**
  - the storefront, SHQ and admin builds have no Shop or Resale pages;
  - BitoCard's `openapi.json` is regenerated without Resale;
  - `legal-documents.test.mjs` passes.
- **Step 3:**
  - one account across stores;
  - the handoff to a connected domain;
  - the country refusals;
  - no store limit;
  - `domain_required` and the fall back to test;
  - Premium with the setup fee buying the free domain (and `domain_not_covered`), and `setup_fee_unpaid`;
  - the theme's contrast check;
  - a Safe pay and a resale order end to end in the sandbox.
- **Step 5:** both instances healthy with their own databases (`/health` names the database on each host), and no Udozo request ever reaching BitoCard's database.

## Questions for the owner

1. **The operating entity:** will Udozo be operated by a separate company? This is recommended, as it holds Safe pay money and is the data controller.
2. **`api.udozo.com`:** open the shared droplet to Let's Encrypt for it (recommended), or use a Cloudflare zone for the API host name?
3. **Starting prices per market:** Premium's price, the setup fee, and the domain endings offered.
