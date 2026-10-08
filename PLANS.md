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
| Resellers and their staff | Yes: sign up, sign in and reset passwords on **SHQ** (`shq.bitocard.com`); the main site is for retail customers. Sign-up is deliberate and step by step (name and email, email code, business name and country, password); Google sign-in never creates an account, and Google sign-up is followed by onboarding (business name and country) | Google, email + password, or mobile + password (SMS-verified) | **Didit** before approval |
| Reseller systems | API | Scoped API keys: `bc_test_…` sandbox, `bc_live_…` live | Belongs to a verified reseller |
| Hosted storefront customers | No BitoCard account | Per-store account owned by the reseller (Google, email or mobile + password); no guest checkout | Only where required (see below): **BVN** + Flutterwave bank account validation in Nigeria; **Didit** elsewhere |
| Customers of resellers' own systems | No | The reseller's own sign-in; the API sees only the reseller's customer reference | Reseller's responsibility |

All **Decided**. BitoCard's own retail store (the parent store) is on the main site, `bitocard.com`, with its catalogue at `/catalogs`; resellers using BitoCard's storefront get a clone of it on their subdomain or domain.

**When customers must verify (Decided).** Whether verification is required is an admin setting per product category and country, which admins can set or unset at any time. Defaults:

- **Not required:** utility products such as airtime, data, pay-TV, electricity and internet/Wi-Fi.
- **Required:** gift cards (buying and selling), virtual numbers, virtual cards and mobile money top-ups, plus wallets and any payout.
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
| Mobile money top-ups | Money sent to a customer's mobile money wallet (pawaPay payouts) in every country and provider the account supports; any amount within the provider's limits; customer verification by default | Decided (built); legal advice per country **To confirm** before live |
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
| 7 | Hubtel | Electricity (ECG prepaid/postpaid), Ghana Water, TV | Ghana | **On hold**: the October 2026 research found merchant payment APIs but no API for supplying bills; kept in the registry, not qualified until one is shown |
| 8 | Techlink GH | Electricity (ECG), Ghana Water, TV | Ghana | Backup |
| 9 | KiNG FLEXY GH | Electricity (ECG), Ghana Water, DStv, GOtv, StarTimes | Ghana | Backup |
| 10 | iPay Africa | KPLC prepaid/postpaid, DStv, GOtv, Nairobi Water, airtime | Kenya | MVP qualify if Reloadly lacks KPLC or TV (docs dated; confirm live) |
| 10b | eLipa | Bills, airtime, payouts | Kenya; Uganda, Malawi and Zambia leads | MVP qualify with iPay; regional lead (split from "iPay Africa / eLipa") |
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
| 22 | DIDWW | Virtual numbers, SIP, SMS | 90+ countries | Later (adapter built: first month of numbers with no documents and no per-minute billing, filtered by admin feature rules per feature (required, allowed or excluded; default SMS and app codes required, for SMS read in BitoCard or forwarded by email); renewals to follow) |
| 23 | Telnyx | Virtual numbers, SMS | Global | Later |
| 24 | Vonage | Virtual numbers, SMS | Global | Later |
| 25 | Twilio | Virtual numbers, SMS | Global | Later |
| 26 | Plivo | Virtual numbers, SMS | Global | Later |
| 27 | Africa's Talking | SMS, short codes, virtual voice | Africa | Later |
| 28 | Flutterwave (cards) | Virtual payment cards | Nigeria pilot | Later (phase 4) |
| 29 | Maplerad | Virtual payment cards | Nigeria | Later (alternative) |
| 30 | Onafriq | Virtual payment cards | Pan-African | Later (expansion) |
| 31 | DT One | Airtime, data, eSIM, bills, gift cards, gaming PINs | 160+ countries claimed; the live feed decides | **Qualify** (broad pan-African alternative to Reloadly) |
| 32 | expressPay | Bills, airtime, data | Ghana | Qualify (confirm fulfilment, not only collections) |
| 33 | Zendit | Gift cards, airtime, bundles and data (eSIMs and bill payments not yet used) | 150+ countries claimed; the live feed decides | **Pilot** (adapter built; prepaid USD wallet, separate test mode) |
| 34 | pawaPay | Mobile money top-ups (payouts to customers' wallets) | The countries and providers on the pawaPay account (Sub-Saharan Africa) | **Pilot** (adapter built; prefunded wallet per country; legal advice before live) |

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
| File storage (logos, icons, images) | DigitalOcean Spaces (US region, CDN), S3-compatible | MVP: built; needs the bucket, keys and its CORS rule |

**Pilot sourcing paths**

- **Nigeria:** Reloadly (gift cards, airtime, data) and VTpass (pay-TV, bills), with Quickteller as the second source.
- **Ghana:** qualify Korba Xchange first for API integration; Techlink GH, KiNG FLEXY GH and expressPay are backups (Hubtel on hold, see above). Confirm which ECG meter types (prepaid, postpaid) each enables.
- **Kenya:** query Reloadly's live catalogue for KPLC (prepaid and postpaid) and TV billers first. If either is missing, ask iPay/eLipa to confirm current KPLC and TV availability; add Tupay if a separate TV provider is needed.

### Supplier registry and directory (planned, M13c; Open until approved)

Source research: `docs/BitoCard-African-Supplier-Registry-Research.md` (4 October 2026) and its seed, `docs/BitoCard-African-Supplier-Registry-Seed.csv` (32 suppliers, 21 English-speaking African markets). The research is a baseline, not proof of live inventory or resale permission.

**What it is.** One registry of every supplier, searchable by admins and, in a reseller-safe form, by resellers. Each supplier can be used through two independent **channels**:

1. **BitoCard's own supply (`bitocard`).** BitoCard holds the account and uses it for its parent store (bitocard.com) and to resupply resellers. The rules are unchanged: suppliers stay invisible to resellers and customers, and routing is by net margin.
2. **Resellers' own accounts (`own`).** A reseller signs up with a supplier in their country themselves, without BitoCard, and connects their credentials in SHQ (M13b). The reseller is the seller of record for those sales.

A supplier can be on either channel, both or neither. Each channel is enabled per country, so one supplier can serve many countries.

**Rules**

- **API provisioning is the inclusion test.** A supplier is listed as a product supplier only when official docs or provider materials show it can discover products or fulfil orders by API, for the product in question.
  - A checkout or collections API alone does not qualify.
  - So Tingg's payment coverage is not bill-supply coverage, and Hubtel is on hold for this reason.
- **Three countries, never merged:**
  1. **Account market:** where a business can contract with the supplier and hold credentials. This decides which resellers may connect it.
  2. **Fulfilment market:** where the recipient, meter or account is.
  3. **Country of use:** where the item works (gift-card region, eSIM destination, licence territory, number country).
- **Coverage is per country and category,** and each entry has its own status:
  - `claimed`: published by the supplier;
  - `confirmed`: returned by an authenticated catalogue;
  - `stale`: the last feed failed (never read as "no coverage");
  - `unavailable`.
- **Technical readiness and commercial access are tracked separately.** Each supplier has:
  - an API status: `documented`, `partner_gated`, `waitlist` or `none`;
  - a qualification stage: `candidate`, `qualifying`, `approved`, `live`, `on_hold` or `rejected`;
  - an adapter status: `stub` or `built`.

  Only a supplier with a built adapter can be connected or routed to.
- **Every claim has evidence:**
  - its source: official docs, provider API, contract, sales confirmation or test order;
  - the URL or document;
  - who recorded it and when;
  - a review date (the registry flags entries past it).
- **Suppliers BitoCard uses stay hidden from resellers.** The SHQ directory lists only suppliers a reseller can sign up with and connect themselves. It never shows whether BitoCard uses a supplier, or BitoCard's terms, costs, routing or evidence.

**Access rules: by country and by reseller, for each channel**

Rules resolve like feature switches: **reseller, then country, then global**. At the same level a block beats an allow, and with no rule the supplier is off. A rule can be narrowed to one category, for example DT One allowed for airtime only in Kenya.

- **`bitocard` channel:**
  - Admins enable a supplier per country and category (today's `supplier_markets`). It then supplies the parent store and resupplies resellers in that country.
  - Admins can also block or allow it for one reseller. A blocked supplier is never routed to for that reseller's orders. The products stay on sale wherever another supplier covers them.
- **`own` channel:**
  - Admins switch on reseller access per integration (built: the Reseller access switch on each integration card; only those show in the Reseller access tab), then offer it globally or in chosen countries (today's `integration_offers`, extended with a category).
  - Every integration has a Sandbox switch (built): the provider's sandbox or live address is picked automatically, admins test BitoCard's credentials with Test connection, and resellers test their sandbox credentials with the provider's sandbox. A sandboxed integration is never used live.
  - Admins can also allow or block it for one reseller: for example, a pilot with one reseller before opening a country, or a block after abuse.
  - The M13b gates still apply unchanged: the `own_integrations` switch, the plan feature, a verified account and the connection's approval.
  - Blocking a reseller who is already connected suspends their connection, with the reason shown, exactly as when operations suspend one.
- Every rule change is audited. The supplier's page shows each change with who made it and why.

**Search**

- **Admins:** Suppliers in the admin app, `GET /v1/admin/suppliers?q=&country=&category=&channel=&stage=&api_status=&adapter=`.
  - Search by name, code, alias (the seed's provider codes), category, capability, country and notes.
  - Filter by stage, channel, API status, adapter status, and evidence past its review date.
  - A supplier's page shows:
    - countries and evidence;
    - funding profile;
    - channel rules (country and reseller);
    - connected resellers;
    - adapter state.
  - A **country view** lists every supplier and category covering a country, by status, so gaps are visible at a glance (for example "Malawi: no bills supplier confirmed").
- **Resellers:** SHQ Integrations > Directory, `GET /v1/integrations/directory?q=&category=&country=`.
  - Sessions only, and outside the public OpenAPI document like the rest of `/v1/integrations`.
  - Lists suppliers whose account market includes the reseller's business country, searchable by name, category and what they sell.
  - Each card shows:
    - the supplier's public name and categories;
    - the countries it covers;
    - links to sign up with the supplier and to its docs, from the registry;
    - the credentials it will ask for;
    - its state for this reseller.
  - The states are:
    - **Connect:** offered and connectable;
    - **Connected;**
    - **Coming soon:** in the registry, but the adapter is not built or the supplier is not offered yet;
    - **Not available on your plan or account:** with the gate that applies.
  - Not listed: suppliers blocked for this reseller, rejected or on hold.
  - **Request** on a Coming soon supplier records the reseller's interest (once per reseller and supplier). Admins use these requests to prioritise adapters and offers.

**Data (proposed)**

- `suppliers` gains:
  - `aliases`;
  - a kind: `product_supplier`, `payment_gateway` or `communications`;
  - a public name;
  - website, docs and sign-up URLs;
  - API status;
  - qualification stage, replacing today's `SupplierStatus` (existing values mapped across);
  - adapter status;
  - a review date.
- `supplier_capabilities`: supplier, category, direction (`buy`, `sell`, `issue`, `pay_bill`, `payout`), and whether sandbox and live are supported.
- `supplier_coverage`: supplier, country, category, the three country roles, status, source and evidence, and when it was checked.
- `supplier_access_rules`: supplier, channel, scope (global, country or reseller), an optional category, `allow` or `block`, and the reason, who and when.
  - Today's `supplier_markets` and `integration_offers` become the country and global rules: migrated, then retired.
- `supplier_requests`: resellers' interest in a supplier.
- The 21 research markets are added to `countries`, closed for sign-up. Coverage can then name them without opening them.

**Seeding**

- A migration seeds the registry from the CSV, keyed by today's codes so adapters, connections and orders keep working.
- The CSV's codes become aliases:
  - `interswitch_quickteller` → `quickteller`
  - `korba_xchange` → `korba`
  - `king_flexy_gh` → `kingflexy_gh`
  - `cellulant_tingg` → `cellulant`
  - `airalo_partners` → `airalo`
  - `nexway_connect` → `nexway`
  - `also_cloud` → `also`
- Two new suppliers, `dtone` and `expresspay_gh`, each get a stub adapter and a credential group.
- `ipay_elipa` splits into `ipay_africa` and `elipa`, and its settings move with it.
- Coverage starts as `claimed`, with the research's source URLs.
- Re-seeding never overwrites admin edits.

**Catalogue discovery**

- For suppliers with a built adapter and credentials, the nightly `catalogue` job marks coverage `confirmed` from the authenticated feed, per country and category, recording the response hash and time.
- A failed feed marks coverage `stale`, never `unavailable`.
- Changes go to a review list for admins.
- Volatile items (eSIM packages, number stock) are still rechecked when quoting, as now.

**Phases**

1. **R1, registry and admin search:**
   - the data model, the CSV seed and aliases;
   - admin search, the supplier page and the country view;
   - stub adapters for DT One and expressPay, and the iPay/eLipa split.
2. **R2, access rules:**
   - channel rules per country and reseller;
   - wired into routing (`bitocard` channel) and the M13b gates (`own` channel);
   - suspension on block, and auditing.
3. **R3, SHQ directory:**
   - reseller search with each supplier's state;
   - sign-up and docs links;
   - interest requests and the admin list of them.
4. **R4, evidence and discovery:**
   - coverage confirmed from live feeds;
   - stale handling and review dates;
   - the review list for changes.
5. **Adapters follow qualification.** The next adapters to build are chosen from the pilot sourcing paths and reseller demand, starting with DT One, Korba and iPay/eLipa. Each is checked against the research's qualification checklist.

**Before R3 goes live:**

- reseller terms stating that resellers contract with suppliers themselves and BitoCard makes no promise about those suppliers;
- a legal check on naming third-party suppliers in SHQ and linking to their sign-up pages.

### Pricing (Decided, starting values admins can change)

- BitoCard margin on cost-priced products (gift cards and anything bought in another currency): **3%** by default, settable per category, market or product.
- Local face-value products (airtime, data, pay-TV, bills): resellers pay face value and add their markup, or (where admins enable the discount option) sell at face value and keep the discount admins set. BitoCard keeps the supplier commission minus any reseller discount.
- A product is never offered if BitoCard would pay its supplier more than its wholesale price (for example when the supplier exchange rate is better than BitoCard conversion rate).
- Quotes hold their price for **10 minutes**, for up to 10 items.
- Tax is collected only on categories admins mark taxable in a country, after tax advice.

### Orders (Decided, starting values admins can change)

- Unconfirmed orders are checked with the same supplier after 30 s, 1, 2, 5, 10 and 30 minutes, then 1, 2, 4 and 8 hours; still unclear after that (about 16 hours), they join the admin exception queue and are checked every 6 hours until an admin resolves them.
- Orders placed through the API are charged to the reseller wallet at wholesale cost plus any tax (BitoCard, as seller of record, pays the tax); the reseller collects the customer price.
- Airtime, data, pay-TV and bills: one per order; gift cards: up to 10 per order.
- Refunds of completed orders go back to the reseller wallet as topped-up funds (spendable, not withdrawable).

### Identity checks (Decided, starting values admins can change)

- A reseller whose owner passes Didit goes live automatically; admins can require manual approval per country or globally (`manual_reseller_approval`). Admins can never activate an unverified reseller.
- Customers of resellers' own systems are the reseller's responsibility; BitoCard offers an optional customer check API (BVN in Nigeria, Didit elsewhere). Hosted storefronts enforce it where the category and country require it.
- A BVN check passes only when the name on the BVN record matches the customer's first and last names.
- Live payout accounts must be in the verified owner's or the business's name.
- Unfinished checks are offered again for a day and closed after 7 days.

### Admin app (Decided)

- One admin app at `admin.bitocard.com` (one Vercel project, `bitocard-admin`): sign-in, dashboard, orders, catalogue, resellers, identity checks, activity log and settings. Microfrontends were tried and dropped: with one team and a few dozen pages they added deployments and slower navigation for no benefit. Each area keeps its own folder and the UI lives in shared packages, so an area can be split out later if a separate team needs to own it.
- Admins sign in with email, password and an authenticator app only (never Google). Sessions, roles and every change are enforced and audited by the API; the app hides actions an admin's roles do not allow.
- Service keys are set in the admin app, not the server environment (Settings > Integrations, super admins only): email, SMS, Google sign-in, Flutterwave, Monnify, exchange rates, Reloadly, VTpass and Didit, plus links and alerts. The API starts with only its required environment (database, encryption key, cron secret, allowed origins, admin email domains), and each service is connected as BitoCard subscribes to it, without a restart. Secrets are encrypted, never shown again, and changes need a fresh authenticator code and are audited without their values.
- The dashboard shows sales and orders by currency (live or sandbox), money held for resellers, active resellers, supplier health, items needing attention, and recent orders.

### Supplier notifications (Decided)

- Suppliers that send status notifications (Reloadly first) post them to the API, which stores every one before acknowledging it, so none is lost even if processing fails. A notification never decides an outcome: it makes BitoCard re-check that order with the supplier straight away instead of waiting for the next scheduled check. Notifications that match no order, or keep failing, are kept for admins to review and retry.
- A reseller's own supplier account notifies its own address: each live connection gets `/v1/webhooks/<supplier>/<connection>`, checked with that reseller's own secret (Reloadly: the webhook secret they save on the connection, after entering the address in Reloadly's dashboard; DIDWW: their API key, with the address given on every order automatically). These notifications can only name that connection's own orders, are processed like BitoCard's, and are listed for the reseller in SHQ (Integrations > Order updates). When one is given up on, the reseller and BitoCard operations are notified in-app.

### In-app notifications (Decided)

- SHQ and the admin app both have a notifications inbox (the bell in the header, and a Notifications page). Each notification is for the roles that act on it: reseller owners see everything in their account; admins, developers, finance and support staff see what concerns their role (for example finance: top-ups, withdrawals, plan renewals; developers: webhook endpoints, own-supplier problems; support: orders whose outcome is unclear). In the admin app, super admins see everything and operations, finance and support see their own work (reviews, the exception queue, failed withdrawals, paused conversions, new resellers).
- Security notices (password or primary email changed, an email address added) go to the person only, whichever account they are using. Sandbox notifications are labelled.
- **Email addresses. Decided**
  - A person can add several email addresses, each confirmed with a code sent to it.
  - Exactly one is primary: it signs in and gets notices, and it cannot be removed.
  - To change it, the person makes another confirmed address primary (with their password). The old primary address is told, and is kept as another address.
  - An address belongs to one person only.
- In-app notifications add to the existing emails, which are unchanged. Per-person email preferences are a later option.
- Kept 90 days; each person reads and marks their own.
- **Push to devices (built):** each browser a person turns push on in (SHQ or the admin app, desktop or phone; on iPhone from the Home Screen app) is registered with its own ID and gets their notifications even when BitoCard is closed, while they stay signed in there. Signing out, removing the device or the browser's push service dropping it stops pushes. People choose which notifications are pushed; urgent and security ones always are. Pushes are encrypted end to end (only the browser can read them) and never carry codes, PINs or secrets. Native mobile apps can use the same device registry later (Firebase and Apple push channels).
- **Storefront customers (baselined for hosted checkout):** the same inbox and device push will serve hosted-storefront customers, each recipient being either a staff person or a customer of one store. Customer notifications (order delivered, failed or refunded, wallet credits, gift-card sales accepted or declined, identity checks, security notices) are already defined, with what is pushed by default (an order ready is; security notices always are). They appear under the store's brand, from the store's own address, with its logo, and never name BitoCard's suppliers or costs; the reseller does not see their customers' inboxes. Nothing reaches customers until customer accounts and sign-in exist (hosted checkout, M10). Resellers on their own systems notify their own customers, using BitoCard's webhooks.

### Webhooks (Decided, starting values)

- Events at launch: `order.completed`, `order.failed`, `order.refunded`, `top_up.succeeded`, `top_up.failed`, `payout.paid`, `payout.failed`, plus a `ping` test event. Payload version `2026-10-01`.
- Up to 16 endpoints per reseller in each mode (sandbox and live); at most 5 requests in flight to one endpoint.
- Rotated secrets keep signing for 24 hours by default (0 to 168 hours).
- Events and delivery logs are kept for 30 days.
- The reseller guide (`apps/docs/content/webhooks.md`) is written; the docs app renders it in M12, before external resellers are onboarded.

### Category plans

- **Pay-TV and bills:** pilot in Nigeria, Ghana and Kenya using the sourcing paths above; other countries only once billers are confirmed per country. Electricity tokens (prepaid) and receipts (postpaid) follow the same validate-then-pay flow. Product = country + brand + package (DStv Nigeria and DStv Ghana are separate products). Validate the smartcard and show the account name and current package before payment.
- **eSIM:** compare identical packages (coverage, networks, data, validity, activation rule, top-ups) at delivered cost. Order on demand, never pre-bought. Show device compatibility first. Deliver QR, manual code and one-tap install links securely; show status, usage and expiry; refunds follow the supplier's unused-eSIM rules.
- **Software:** authorised distributors only. OEM is excluded from the MVP and allowed only with written rights. CSP does not imply standalone Windows keys. Prevent duplicate allocation of one-time keys. Collect committed subscription terms up front or make the reseller liable before selling them.
- **Virtual cards:** pilot in Nigeria with Flutterwave, Maplerad as the alternative, Onafriq for pan-African expansion, all subject to the issuer approving BitoCard's reseller model and terms. Cardholders are verified first; BitoCard never stores card numbers or CVVs; every fee and FX rate is shown before confirmation; cards stay with their issuer.
- **Virtual numbers:** a product is country + number type + capability set; never imply SMS on a voice-only number. Monthly renewals from the reseller wallet, with warnings before release. Collect regulatory documents where a country requires them. Usage is billed after it happens.

Questions to ask each supplier are listed per category in `AGENTS.md`.

## 5. Reseller storefronts and onboarding

### BitoCard's own store, bitocard.com (Decided)

- bitocard.com is BitoCard's in-house marketplace for retail customers, not a reseller clone: gift cards, mobile airtime and data, bills and pay-TV, eSIMs, software and virtual cards as each is enabled.
- Admins lay out its home page in the Storefront Manager (admin app): sections on a 12-column desktop grid (6 on tablets, one column on phones), dragged into place and sized per screen. The sections are a hero with search and category shortcuts; product rails (trending, top selling, new, featured, a category, a brand or hand-picked); category and brand grids; promo cards; and a trust bar. Every publish is a version that can be restored; previews show the draft before it goes live.
- Search covers everything on sale: brands and the companies behind them, products, categories (including the words people use, such as "top up" or "electricity") and countries. It never shows BitoCard's own suppliers.
- Brands are presented with their name, company, logo, card art, colour, tags and search aliases, set by admins.
- **Listing. Decided**
  - Products synced from suppliers are not on bitocard.com until an admin lists them, one by one or in bulk (for example all of a supplier's gift cards). Unlisting takes them off at once.
  - Each reseller lists the products their own hosted store shows. A reseller's own systems (the API) can sell every product in their catalogue, listed or not.
  - BitoCard's listing and a reseller's are separate: neither changes the other.
- **BitoCard's own stock. Decided**
  - Admins add products BitoCard has bought outright, such as software licences and gift cards: title, brand, description, how to redeem, region, face value, cost per code, an optional margin, and the codes themselves.
  - Software is global: no region, sold to resellers in every market (software is on everywhere). Each software product has a licence term (months, or lifetime) and its list of keys; each term is its own product and price. Brands are added first under Catalog > Brands (name and logo) and chosen from that list.
  - A reseller can name their customer's email on a gift card or software quote: the codes or keys are emailed to the customer under the reseller's store name once delivered, as well as being shown on the order.
  - They sell like any supplier's products: resellers see and sell them through the API and their own stores, and bitocard.com shows them once listed. The quantity on sale is the number of codes left; a product goes off sale when they run out and comes back when codes are added.
  - Each code is handed to one order only, oldest first. Codes are encrypted, never shown to admins (only their last four characters and the order each went to), and a code already stocked or sold can never be added again. Admins can pause sales and withdraw faulty codes.
- **Brand registry. Decided**
  - A registry of well-known brands (mobile networks, gift cards, pay-TV, shopping, gaming…) gives each brand its name, company, colour, search words and logo, so stores look branded from the start.
  - Admins upload each brand's logo (PNG or SVG) and card art on one page (Storefront > Brand registry). One upload covers every product of that brand.
  - Until a logo is uploaded, the brand uses its bundled icon from the brand icon pack (most networks, gift cards and payment brands); brands with neither show their initials on the brand colour.
  - Until card art is uploaded, the brand uses its bundled gift card design (about 150 brands, mainly UK retail, dining, travel and experiences, added to the registry with them), on bitocard.com, in resellers' catalogues and in the admin app. An admin upload always replaces it.
- **Images are uploaded, not only linked. Decided** Admins upload brand logos (network operators are brands), gift-card and brand card art, product images (shown instead of the supplier's logo), supplier logos (admin only), category icons and images, and storefront images. Resellers upload their store's logo and images in SHQ.
  - Files go straight from the browser to DigitalOcean Spaces with signed links, and are kept in clear folders: `platform/brands/<brand>/logos`, `platform/products/<category>/<country>/<brand>/<variant>`, `resellers/<reseller>/store/logos`, and so on.
  - The API checks every file before it can be used: really an image of the declared type and size; SVG from admins only, and only plain drawings.
  - A media library lists every file, where it is used and who uploaded it. Files can be reused; a file in use cannot be deleted.
  - Resellers only ever see their own files.
- The store shows face values; the customer's price is quoted at checkout (M10b). Customers sign up on bitocard.com (email and password, email confirmed by code), buy from product pages, pay on the payment page of a method offered in their market, and see their orders and codes in their account. **Nothing is ordered until the payment is confirmed**; an order that fails after payment is refunded in full to how the customer paid. BitoCard sells through one house account per market (customers pay in the market's currency; the retail margin is that account's earnings). **Decided** bitocard.com is always the store: until admins publish a home page, it shows the approved default layout. The reseller landing page (`/resellers`) is where resellers learn about BitoCard before registering: a first screen with Register, then every feature in alternating rows, each with a sign-up button.
- The reseller landing page is bitocard.com/resellers: what BitoCard offers resellers, with Register leading to SHQ sign-up. "Open a reseller store" throughout the store leads there first.

- Hosted storefront per reseller: its own tenant with branding, products, customer-facing prices, customers, orders and reports. **Decided**
- Resellers choose products, set retail prices, and see their profit, never supplier costs. **Decided**
- **Markup Protection Scheme:** reseller prices may be at most **50% above BitoCard's wholesale price**, so customers are protected from excessive prices. Admins control the scheme and its cap. **Decided**
- **Fixed-price products** (airtime, data, pay-TV, electricity and other face-value items): resellers can add a markup on top of face value, within the cap. Where admins enable it, they can instead sell at face value and earn the discount BitoCard gives them. **Decided**
- **Gift-card sales by customers:** the reseller can take a spread on the payout rate, capped by admins. **Decided**
- Dashboard: **SHQ (Seller Head Quarters)** at `shq.bitocard.com`: store settings, balances, top-ups and withdrawals, orders, catalogue and pricing, API keys, webhook endpoints and delivery logs, team and settings. All reseller authentication (sign-up, sign-in, password reset, team invitations) is on SHQ, so the main site, `bitocard.com`, stays for BitoCard's retail customers. **Decided**
- Hosted storefronts are **clones of BitoCard's parent store** (the main site's store at `bitocard.com/catalogs`) under the reseller's brand, prices and domain. **Decided**
- **Reseller's own integrations (planned, M13b). Decided:** a verified reseller connects their own accounts with suppliers and with payment gateways, and BitoCard runs their business on them for a small fee per transaction plus their subscription.
  - **What can be connected.** Only services BitoCard has built an adapter for (no custom APIs): **suppliers** (products: Reloadly, VTpass, DIDWW and the rest of the registry) and **payment gateways** for checkout in the reseller's own country or locality (for example a Nigerian, Ghanaian or Kenyan gateway or mobile money). BitoCard finds suppliers and gateways in enabled and anticipated countries, builds their integrations, and then offers them to resellers.
  - **Who can connect what.** Three gates: (1) the `own_integrations` switch for the reseller (off by default; global, country or reseller); (2) the integration is **available to resellers in their country**: per integration, in the admin integrations editor, an admin marks it available to resellers **globally** or in **selected countries** (`PUT /v1/admin/integrations/:code/reseller-availability`), and SHQ lists only what is available for the reseller's country; (3) the connection is approved: per integration the admin chooses automatic approval or review (review is recommended for payment gateways and for the first resellers on any integration).
  - **The seller of record follows the product's source, not the payment route.** **The reseller is the seller of record** for every sale fulfilled by their own supplier: they own the customer, the sale, its tax, receipts (in their name), refunds and support, and the data (BitoCard processes it for them under a data processing agreement); BitoCard sells its platform to the reseller and invoices its fees and subscription. BitoCard-sourced products keep today's rule (BitoCard is seller of record, in every channel), whichever gateway the customer pays through. BitoCard never collects money for a sale it is not the seller of, so a product from the reseller's own supplier is never sold through BitoCard's checkout: on a hosted store it needs the reseller's own gateway, and through the API the reseller collects payment themselves.
  - **The reseller funds their own integrations.** They fund their supplier accounts as they choose and receive customer payments straight into their own gateway account; BitoCard never holds, forwards or pays those funds. The reseller funds their BitoCard wallet only for BitoCard's fees, their subscription and any BitoCard-sourced products.
  - **Pricing: one more source behind the existing pricing.** A product from their supplier is priced like any BitoCard source: supplier cost (from the supplier's API, never typed by the reseller) + BitoCard's fee = wholesale price, + the reseller's markup = customer price. Quotes, the Markup Protection Scheme and order states work unchanged. Their offers are visible to and routed for that reseller only.
  - **Fees can be infinitesimally small.** Rates are stored in **parts per billion** of the base: from 0.0000001% up to 10% (1 to 100,000,000 ppb), or zero. Fee rules are set by admins per fee kind (`supplier_order` on own-supplier orders; `gateway_payment` on payments through the reseller's gateway, zero unless an admin sets it), category, country and plan, the most specific winning; plans can carry lower rates. The base is the category's pricing basis for orders (supplier cost converted at BitoCard's rate for cost-priced products, face value for local face-value products) and the amount paid for gateway payments. An optional minimum fee per transaction defaults to none.
  - **Exact fees, never rounded up.** With the rate in parts per billion, a fee in billionths of a minor unit is exactly `base × rate`, a whole number. Each transaction is charged the whole minor units of its fee plus the reseller's carried remainder; the fraction left over is carried to their next transaction (per reseller, currency and mode). So the reseller pays exactly the agreed rate over time, however small, instead of a cent per transaction.
  - **Collecting fees from the wallet.** Before BitoCard places an order with the reseller's supplier (or starts a checkout on their gateway), it holds the most the fee could be (the exact fee plus carry, rounded up) from the wallet; on delivery (or confirmed payment) it works out the charge, updates the carry with the carry row locked, takes the charge and releases the rest; a failed order or payment releases the whole hold and never touches the carry. So nothing goes through BitoCard without its fee covered, and failures cost nothing. When the wallet cannot cover a hold, the order or checkout is refused; resellers are warned when their balance will not cover their usual fees for long.
  - **Subscription plans.** Own integrations come with the plans admins choose (a plan feature, `own_integrations`); the subscription is charged monthly from the wallet as now, and a plan can set its own lower fee rates.
  - **A clear ledger.** Each fee is its own journal entry (`fee:order:<id>`, `fee:payment:<id>`, refunds `fee:refund:<id>`) from the reseller's wallet to a new `platform_fees` revenue account, kept apart from `platform_revenue` and from subscription revenue. A transaction charged nothing (its fee carried) posts no entry but still records its fee line: rate, base, exact fee, amount charged, carry before and after. Resellers see each fee in their wallet history (type `platform_fee`, linked to its order or payment) and get a monthly statement of fees and subscription; admins see fee revenue per reseller, fee kind, category, country and plan. A reconciliation check proves that fees charged plus carried remainders equal the sum of exact fees.
  - **Isolation and credentials.** Credentials are stored like BitoCard's (encrypted, write-only, audited, checked on save with a harmless call, test and live kept apart, rotation and disconnection) and used only for that reseller's orders and payments. Payments are confirmed by re-reading them from the reseller's gateway with the reseller's credentials, never from a webhook body; each connection has its own webhook address and secret. The reseller sees their own supplier's and gateway's names, costs and errors; customers never see supplier details.
  - **No switching between sources at first:** a definite failure at the reseller's supplier fails the order (an unclear answer stays pending, as everywhere). Falling back to a BitoCard supplier comes later, with its own quote, because it holds the full wholesale price instead of the fee and makes BitoCard the seller for that sale.
  - **Refunds:** the reseller handles refunds with their customer and supplier; BitoCard's fee is refunded only when nothing was delivered (or the payment did not complete).
  - **Before launch:** reseller terms for own integrations (seller of record, data processing agreement, fees and their exact calculation, subscription), and tax advice on BitoCard's fees and subscriptions (a business-to-business service in each country).
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
- **Who gets live reserved accounts (Decided):** the country must offer them and an admin switches them on per reseller (or per country, or globally; off by default). In Nigeria the business owner's **BVN is checked** with Flutterwave first and its name must match the owner's verified identity; BitoCard holds the BVN encrypted only until the accounts are opened, then erases it. Bank transfers into the accounts are listed with top-ups.
- **Refunds for failed orders** go to the customer's wallet if they have one, otherwise back to the original payment method.
- **Reseller profit belongs to the reseller** and can be withdrawn to their verified bank account. Each sale's profit becomes withdrawable **15 days** after the sale, and withdrawals need a minimum balance (for example $10 or its local equivalent). Admins set both.
- Payment providers: Flutterwave (Nigeria, Ghana, Kenya, including M-Pesa), Monnify (Nigeria), Stripe (cards) and pawaPay (mobile money), chosen by the payer's country and currency. Reserved accounts through Flutterwave and Monnify.
- **Payment methods are gated per market by admins (Decided, built):** for each country an admin switches each gateway on for reseller wallet top-ups and, separately, for customer checkout, and orders them (Settings > Markets). A method takes live payments only while its gateway is also set up (credentials saved, not in its sandbox). Flutterwave top-ups stay on in Nigeria, Ghana and Kenya; checkout methods start off everywhere. Resellers can also connect their own Stripe account (with Flutterwave and Monnify) once an admin gives it reseller access; their hosted store's customers then pay into that account (phase 4, built): BitoCard holds its `gateway_payment` fee and the order's cost from the reseller's wallet before the payment page opens, never touches the customer's money, and refunds go back through the reseller's account.
- Provider fees on checkout payments are BitoCard's cost, like top-ups (**To confirm** with the accountant whether to pass them on).
- **Exchange rates** come from **Open Exchange Rates** (hourly reference rates, covering NGN, GHS and KES), checked against the rates Flutterwave actually offers. BitoCard uses the less favourable of the two plus a conversion margin set by admins per currency, so rate movements between quote and settlement never cause a loss; the margin is disclosed. If the two sources differ by more than an admin-set threshold, conversions pause and admins are alerted.

- **Starting values (admins can change them):** conversion margin 1.5% per currency; conversions pause when the two rate sources differ by more than 3%; rates older than 3 hours are not used.
- **Topped-up money pays for orders but is never withdrawn;** only earnings past the payout hold can be withdrawn.
- **Payouts to a newly added bank account start 24 hours later**, and the owner is emailed whenever one is added. The account name always comes from the bank.
- **Premium renewals:** if the wallet cannot cover a renewal, the owner is warned and Premium continues for a 7-day grace period, then moves to Standard. Cancelling keeps Premium to the end of the paid month.

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
  - **Built:** granted once (US$500, its own restricted ledger account against the promotions expense) when a verified reseller has the switch on, or by a finance admin; finance can revoke what remains; shown in the SHQ wallet. Spending it on customer-paid orders arrives with hosted checkout (M10), together with the outstanding-exposure tracking.
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

- Starting rates, unconfirmed until a finance admin confirms each after tax advice (live sales are blocked until then): Nigeria VAT 7.5%, Ghana 20% (VAT 15% plus NHIL 2.5% and GETFund 2.5%), Kenya VAT 16%, with customer prices including tax.

- Calculate and record VAT, GST or sales tax on digital sales by the customer's location, kept separate in the ledger, with compliant receipts. **Decided**
- **BitoCard is the seller of record** for every customer sale of its own products, in every channel (sales fulfilled by a reseller's own supplier are the reseller's; see Reseller's own integrations), so BitoCard (through the Golojan entity for the region) registers for, collects and pays the tax, and issues the receipts under the reseller's store brand. The reseller's profit is their earnings from the sale. **Decided** Confirm registrations and the reseller's tax position with a tax adviser per country.

## 7. API, docs and webhooks (Decided)

- One unified REST API at `https://api.bitocard.com/v1`, described by OpenAPI. No GraphQL. Sandbox and live share the address; the key decides the mode.
- Admin-only endpoints live in the same API behind admin roles.
- Idempotency keys on every POST; versioned with a changelog.
- **Docs** at `https://docs.bitocard.com`, public and indexed. The reference is generated from the OpenAPI document. "Try it" requires reseller sign-in and runs against the reseller's own sandbox or live account using a short-lived token; live mode is clearly marked and asks for confirmation before anything that spends money.
- **Outbound webhooks:** transactional outbox plus Vercel Queues (Postgres keeps the delivery record); signed (HMAC with timestamp); delivered at least once with unique event IDs; retries for up to 3 days; per-endpoint isolation; auto-disable with alerts; delivery log, resend and test events; `GET /v1/events` catch-up; HTTPS only with internal IPs blocked.
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
| M2 | Sign-in and access: accounts, roles, Google, email and mobile sign-in, admin 2-step, API keys, staff invitations | **Done** (needs Google, Resend, MailerSend and Termii keys, and `ENCRYPTION_KEY`, on Vercel) |
| M3 | Stores, countries, settings chain, admin switches, plans | **Done** |
| M4 | Money core: ledger, wallets, FX, Flutterwave checkout and reserved accounts, payouts, tax | **Done** (needs Flutterwave, Monnify and Open Exchange Rates keys, `CRON_SECRET`, and Vercel Pro for hourly jobs) |
| M5 | Supplier adapters and registry, catalogue, pricing rules, quotes; Reloadly and VTpass | **Done** (needs Reloadly and VTpass credentials, and the agreed VTpass commission entered per product) |
| M6 | Orders and fulfilment, requery and exception queue, receipts, refunds | **Done** |
| M7 | Webhooks: outbox, delivery, retries, events API | **Done** (Vercel Queues transport; needs Vercel Pro for the 5-minute backstop job) |
| M8 | Identity checks: Didit, BVN, bank validation, gating | **Done** (needs Didit API key, workflow and webhook secret, and Flutterwave BVN access; privacy notice update before live) |
| M9 | Admin app | **Done** (needs the `bitocard-admin` Vercel project on admin.bitocard.com with `NEXT_PUBLIC_API_URL`, and the API's `ALLOWED_ORIGINS` to include it) |
| M10 | Own-brand storefront: BitoCard's parent store on the main site (`bitocard.com`, catalogue at `/catalogs`) for retail customers | **M10a built**: public catalogue API, search, trending and top selling, brand presentation, image uploads to DigitalOcean Spaces (brands, gift-card art, products, suppliers, categories, storefront and reseller store images, with a media library), the Storefront Manager (drag-and-drop home page grid, versions, previews, publishing), the store's home, catalogue, search and product pages, the shopper's market (asked on the first visit and kept in a cookie: their country's products plus those usable anywhere, or everything when they stay global), and the reseller landing page at `/resellers`. **M10b built**: customer accounts and sign-in on bitocard.com, payment methods per market (Stripe, Flutterwave, Monnify, pawaPay, for wallet top-ups and checkout), checkout with payment first and the order placed once paid, delivery to the customer's account and email, refunds through the gateway, customer notifications, and the identity check where a market requires it. **Built since**: the customer account app (mobile-first, Home with real figures and category entries, Catalog carousels, Orders and Account tabs; bottom bar on phones and tablets, side rail or bottom bar on desktop as admins set and resellers override), finance refunds of delivered checkout orders (the sale reversed, the store's margin taken back, the customer refunded through how they paid), and resellers' hosted stores on `<subdomain>.bitocard.com` (their listed products under their name and logo, customer accounts per store, checkout in the sandbox until they go live, through BitoCard's gateways or their own). **Still to build**: customer push notifications and inbox on the store, the store's colours across the page, per-connection webhooks for own gateways, the startup allowance on customer-paid orders, and terms of sale (Legals) before any checkout method is switched on |
| M11 | Pilot launch: Nigeria, then Ghana and Kenya | |

Phase 2, reseller launch: M12 docs app, M13 SHQ reseller dashboard (**in progress**: sign-in, overview, orders, catalogue and pricing, wallet and withdrawals, store, developers, team and settings built; needs the `bitocard-shq` Vercel project on shq.bitocard.com), M13b reseller's own integrations (suppliers and payment gateways, admin-gated per integration and country, fees from the wallet; **phase 1 built**: availability per country, gates, encrypted and checked connections, admin review, SHQ Integrations; **phase 2 built**: fee rules in parts per billion, exact fees with the carry, wallet holds, `platform_fees` ledger, statements, reports and reconciliation; **phase 3 built**: own catalogues synced with the reseller's credentials, routing, quotes and orders charging only the fee, sandbox simulation; **built**: per-connection supplier notifications (Reloadly and DIDWW), in-app notifications for every role in SHQ and the admin app, and browser push to each person's registered devices; **phase 4 built**: customers of the reseller's hosted store pay into their own gateway, with BitoCard's fee and the order's cost from their wallet), M13c supplier registry and directory (planned: one searchable registry for admins and resellers, coverage per country, channel rules per country and reseller; see section 4), M14 domains, M15 promotions, M16 reseller launch. Phase 3 onwards: gift-card selling, more bills countries, Microsoft licences, virtual numbers, virtual cards.

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

None for the MVP.

Supplier registry (M13c): approve the proposed data model and the Hubtel hold before R1; before R3, legal check on naming and linking third-party suppliers in SHQ.

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
