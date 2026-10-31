# Udozo: Shop and B2B spin-off plan

Decided by the owner on 30 October 2026. **BitoCard Shop** (the B2C classifieds marketplace with Safe pay and the Anjio shop assistants; `docs/BITOCARD_CLASSIFIEDS_PLAN.md`) and **B2B reselling** (suppliers' listings sold on resellers' Resale shop stores; `docs/BITOCARD_B2B_RESELLING_PLAN.md`) leave BitoCard and become their own brand, **Udozo**, at **udozo.com**. The domain is already owned. It was a memorial portal, which the owner is deleting themselves; nothing of it is carried over and no work for it is in this plan.

**Status:** steps 1 to 3 built (30 October 2026), committed locally; steps 4 to 6 planned.

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
   - its own copy of the API, **`apps/udozo-api`**, deployed **on Vercel on its own** as `api.udozo.com` (changed on 31 October 2026 for total separation; it was first planned as the same `apps/api` code on BitoCard's droplet; Step 5b);
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
   - **Subdomains are only for the sandbox and testing.** Every store gets `<store>.udozo.com` at once, set up automatically: a DNS-only CNAME in udozo.com's Cloudflare zone and the address on Udozo's stores project, where Vercel issues its certificate (udozo.com's DNS is on Cloudflare, so a Vercel wildcard is not possible). A store on its subdomain runs only in the sandbox.
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
   - udozo.com's DNS on **Cloudflare** (the owner's answer): `api.udozo.com` an A record to the droplet, proxied; stores' sandbox subdomains made one by one through Cloudflare's API (Udozo's Store addresses (Cloudflare) settings);
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
   - **Subdomains:** `StoreHostsService` makes each in udozo.com's Cloudflare zone (see the owner's answers below).
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

**Step 3 status (30 October 2026): built.** Everything below applies on Udozo's instance only; BitoCard is unchanged.
- **Theme:** `site_themes`, `src/theme`.
  - `GET /v1/theme` (public, cached; `?preview=`);
  - `GET /v1/admin/theme`, `PUT …/draft` (a ready-made theme or four colours, contrast checked: `theme_contrast`), `POST …/preview`, `POST …/publish` (operations, step-up, audited).
- **One account everywhere:**
  - `StoreSellers.sharesAccounts`/`accountStore`, `CustomersService.sharedStore` and `customerFor`;
  - resale purchases are one history;
  - a resale order's buyer is emailed by the store it was bought at.
- **Handoff:** udozo.com (`STOREFRONT_URL`), any published store's `<store>.udozo.com`, and the active domains of published stores (and their `www`), over https only.
- **By country:** resale quotes and orders refuse a shopper from another country (`market_unavailable`); Safe pay already compared the listing's country.
- **Stores:**
  - no store limit, and Resale shops only (the default template);
  - each one's address made in udozo.com's Cloudflare zone and on the stores project (`StoreHostsService`, `productOf(config).storeHostDomain`; house stores none);
  - live only with an active domain (`domain_required`); a live store left without one goes back to the sandbox, at once or by the `domains` job, and its reseller is told (`store.sandbox_without_domain`).
- **Setup fee** (`setup_fees`, `resellers.setup_fee_*`; `src/billing/setup-fees.*`):
  - finance sets it for every market in US dollars (`PUT /v1/admin/setup-fees/WW`, charged in each market's currency at the `pay` rate) and, where wanted, a market's own in its currency (`PUT …/:country`, `DELETE …/:country` to follow every market's again); step-up, audited, `fees_below_domain_price`;
  - a seller pays it once (`/v1/billing/setup-fee`, or with their first Premium month);
  - going live answers `setup_fee_unpaid` until it is paid.
- **Free domain:**
  - the `free_domains` plan limit (Udozo's only; the product seed sets Premium's to 1);
  - `GET/POST /v1/stores/:store/free-domain`: bought with nothing taken from the wallet within what the store's Premium collected (its paid month, plus the setup fee when paid with it; otherwise `domain_not_covered`), and renewed free while the store keeps Premium;
  - Vercel's price is still booked as cost of sales, not as the promotions expense first planned;
  - domains are open on every plan (the `custom_domains` switch still gates them).
- **Payouts:** `/v1/store/cash` left the crypto code (`src/payouts/customer-cash.ts`, with its own check; a crypto freeze no longer applies). The admins' list is `/v1/admin/customer-payouts`.
- **Words:** the marketplace's and reselling's errors, notices, emails, order messages, the shop assistant's rules and knowledge, the template and switch descriptions say Udozo. Listing links are on udozo.com, and notice links on Udozo's `/account/...` pages.
- **Not done here:**
  - the subdomain lookup answering in test mode: instead, the store's own `checkout_mode` decides, and Udozo's app sends a live store's subdomain to its domain (step 4);
  - Verify outcome emails and the webhook headers other than the signature (`bitocard-event-id` and the rest), left for the apps step;
  - resellers' Store > Customers lists stay per store, so on Udozo they are empty (shoppers are Udozo's accounts), to rethink with Seller HQ.

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

**Step 4 status (30 October 2026): the apps are built** (not deployed; that is step 5):
- **`apps/udozo`** (`@udozo/web`, port 3007): the marketplace, Udozo's own accounts (`udz_customer`), the handoff, `/sell` and the seller's `/account/*`, the theme, and **resellers' stores**:
  - `proxy.ts` tells udozo.com (and its www and Vercel previews) from a store's sandbox subdomain or a reseller's own domain (`classifyHost` in `lib/store-host.ts`), finds the published store (`GET /v1/storefronts/:subdomain`, or `/v1/storefronts/domains/:domain` first; a minute per instance) and rewrites its request to `app/store/[store]/…`, naming the store, its origin and the path asked for in request headers (`x-udozo-store`, `x-udozo-store-origin`, `x-udozo-store-path`; any the browser sent are removed on every request). udozo.com never serves `/store/…` (404); an unknown store is "This store is not open" (404), an unreachable API a 503.
  - A live store with a domain is served there only: its subdomain answers 308 to the domain, keeping the path.
  - Pages: home (`GET /v1/store/resale/home?store=&preview=`, new: the store's sections alone, filled; `StorefrontService.storeHome`), `/preview?token=` (Seller HQ's draft link), `/listings`, `/l/<ref>-<slug>` with buying from the Udozo wallet, `/suppliers/<id>`, `/account/purchases(/<id>)`, `/api/purchases/<order>/dispatch-photos/<photo>`, and a social image in the store's colours. The layout wears the store's design (`storeShell`), shows "Test store" while in the sandbox, and indexes only a live store on its own domain (its robots.txt too).
  - Signing in on a store goes to udozo.com's `/handoff/go?to=<store origin>&next=<path>`; the store's `/handoff` exchanges the code naming its own origin. `customerFetch` sends `BitoCard-Store` on a store's requests. The phone and wallet links go to the shopper's account on udozo.com.
- **`apps/udozo-shq`** (Seller HQ, port 3011) and **`apps/udozo-admin`** (port 3012), on the shared console; **verify.udozo.com** is `NEXT_PUBLIC_VERIFY_BRAND=udozo`.
- **Still to do:** Udozo's legal documents and the deployments (step 5). Seller HQ's Developers page keeps Udozo's scopes and events by hand, and its first-store guide is BitoCard's text.

### 5. Deploy and launch
1. **Udozo's API on Vercel** (replacing the droplet stack, 31 October 2026): `apps/udozo-api` as its own Vercel project, migrating and seeding Udozo's database in each production build, with Vercel Cron and Vercel Queues (see Step 5b).
2. **Vercel projects:** udozo (stores' addresses added to it by the API), udozo-shq, udozo-admin and verify-udozo, each with affected-projects skipping and `VERCEL_DEEP_CLONE`.
3. **Udozo's legal documents** (terms, Safe pay, reseller terms, privacy, cookies), accepted by version.
4. **Browser checks** at 375 px, and a sandbox store on its subdomain taken live on a connected domain.
5. **A pilot** in one market.

**Step 5 status (30 October 2026; removed on 31 October 2026, see Step 5b): the droplet side was built** (never switched on):
- `api-udozo` and `scheduler-udozo` in `deploy/droplet/docker-compose.yml` (profile `udozo`, `APP_PRODUCT=udozo` fixed there, 512 MB), secrets in `/etc/udozo/api.env` (`udozo.env.example`), `set-env.sh <NAME> udozo`;
- Caddy serves `api.udozo.com` (`sites/udozo.caddy`, Cloudflare origin certificate from `origin-cert.sh csr|install udozo`) once deploy.sh enables it;
- `deploy.sh`: with `/etc/udozo/api.env` present, checks both environments and migrates both databases (Udozo's then seeded) before replacing either instance, then checks both hosts through Caddy serve their own product at the new commit, and refuses two instances on one database (`/health`'s `product` and `database_id`);
- `deploy-api.yml` copies the site and smoke-tests `https://api.udozo.com` once `UDOZO_API_LIVE` is `true` (`SMOKE_PRODUCT=udozo`; `test/smoke-script.test.mjs` runs the smoke test against both products);
- Udozo's instance defaults to its own addresses (`productDefaults` in `config.ts`: udozo.com, shq, verify, admin, `udozo.com` admins);
- runbook: `deploy/droplet/README.md`, Udozo's API. **Still to do:** Vercel projects for Udozo's apps.

**Step 5b (31 October 2026, the owner's decision: total separation): Udozo's own API.**
- **Its own code:** `apps/udozo-api` (`@udozo/api`), a copy of `apps/api` taken at `cfe3b0dc`. From here each copy changes on its own: a fix to shared behaviour (auth, ledger, payments, KYC, webhooks) is made in both, deliberately. Each has its own migrations from that point; the rule that every migration runs on both databases ends.
- **Each copy runs only as its product in production:** Udozo's defaults `APP_PRODUCT` to `udozo` and refuses `bitocard` in production; BitoCard's refuses `udozo` (`loadConfig`; `test/product-mode.test.mjs` in each). Until 5c strips them, each copy still carries the other product's code, hidden by `ProductRoutesGuard`, and Udozo's shared tests still run as BitoCard (`APP_PRODUCT: 'bitocard'` in its `test/helpers.mjs`).
- **On Vercel:** `apps/udozo-api/vercel.json`: the NestJS preset; install and build from the repository root, then `npm run deploy:prepare -w @udozo/api` (`scripts/vercel-build.mjs`: production builds only, it checks the environment with `check-env.mjs`, so a bad setting such as `COOKIE_SECURE=off` fails the build instead of the running API, then migrates and seeds Udozo's database; preview builds do neither, `test/vercel-build.test.mjs`); `npx turbo-ignore`. Vercel Cron runs the 15 jobs Udozo runs (`test/vercel-crons.test.mjs` checks they match the job table less BitoCard's), and webhook deliveries go through Vercel Queues (`api/webhook-queue.mjs`, topic `webhook-deliveries`). It has its own `openapi.json` (Udozo's routes only; its `scripts/export-openapi.mjs` never writes SHQ's lists). Environment: `vercel.env.example`, as Production variables only, so preview builds never migrate Udozo's database.
- **Off the droplet:** `api-udozo`, `scheduler-udozo`, `sites/udozo.caddy`, `/etc/udozo` and the `udozo` options of `set-env.sh` and `origin-cert.sh` are gone; `deploy.sh` and `deploy-api.yml` deploy BitoCard's API alone again.
- **DNS:** `api.udozo.com` is a CNAME to Vercel (`cname.vercel-dns.com`), **DNS only** (not proxied), in udozo.com's Cloudflare zone, and the domain is added to the `udozo-api` project, which issues its certificate. There is no fixed outgoing address: Udozo uses no supplier that allowlists one.
- **Still to do:** the Vercel project, its environment and domain; then 5c.

**5c. Strip each copy:**
- **Udozo's copy:** remove every `@ProductOnly('bitocard')` controller and route, BitoCard's jobs, modules, tests and integrations, then the services nothing calls; its tests run as Udozo.
- **BitoCard's copy:** remove every `@ProductOnly('udozo')` controller and route, Udozo's jobs, product defaults, seed and tests.
- **Then:** `APP_PRODUCT` and `ProductRoutesGuard` go from both.
- **Legal documents drafted** (30 October 2026; item 3), drafts for lawyers' review on udozo.com: `/legal` and `/legal/<slug>` (`terms`, `safe-pay`, `sellers`, `privacy`, `cookies`; content in `apps/udozo/lib/legal.ts`, pages in `app/(global)/legal`), naming De-Golojan Technologies Ltd as owner and operator, `support@udozo.com` and `legal@udozo.com` (to be set up). Linked from udozo.com's footer and sitemap, stores' footers, sign-up and the identity check's consent, Seller HQ's sign-up and verify.udozo.com. **Accepted by version:** the API's `shopTermsVersion` is `2026-10-30`, equal to `legalVersion`, and `shopTermsPath` is `/legal/terms`, which the accept prompt links. Tests: `apps/udozo/test/legal.test.ts`. Still owed: lawyers' review per market (Safe pay licensing, the liability cap, the setup fee's refund terms, the controller split with sellers).

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

## Owner's answers (30 October 2026)

1. **The operating entity:** De-Golojan Technologies Ltd (Nigeria) owns and operates Udozo. Udozo's legal documents name it.
2. **DNS:** udozo.com's DNS is on Cloudflare. Since 31 October 2026 `api.udozo.com` is a DNS-only CNAME to Vercel (Step 5b), no longer an A record to the droplet. Vercel cannot issue a wildcard certificate without its own nameservers, so stores' sandbox addresses are made one by one as BitoCard's are: a DNS-only CNAME per store through Cloudflare's API (`StoreHostsService`, on Udozo's own Cloudflare settings) and the address added to Udozo's stores project, instead of a wildcard.
3. **Starting prices:** a US$10 Seller HQ setup fee for every market and Premium at US$5 a month, set by the product seed once (admins change them later). US$15 covers a .com in the first store's month; a later store's Premium (US$5 alone) does not, so its free domain answers `domain_not_covered` unless the price rises or the domain is cheaper. Domain endings: .com, as for BitoCard.
