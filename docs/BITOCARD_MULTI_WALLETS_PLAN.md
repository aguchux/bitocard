# One bitocard.com, many wallets (plan, 15 November 2026)

**Status:** built 15 November 2026 (API, storefront, admin), committed locally, not deployed. Supersedes `docs/BITOCARD_COUNTRY_STORES_PLAN.md`. Lawyers' review of holding and converting foreign currencies for customers is owed before `customer_foreign_wallets` goes on anywhere.

## What the owner asked

1. **Retire the country stores.** No more `ng.bitocard.com`, `gh.bitocard.com` and so on. bitocard.com is the one store.
2. **Wallets.** Every customer has a US dollar wallet by default, plus a wallet in their own country's currency.
3. **Add wallet.** Customers can add (switch on) wallets in the currencies of other markets BitoCard has enabled.

## How it works today (what changes)

**Country stores**
- Each market has a house reseller (`resellers.house`, the seller of record in that market) and a published store at `<cc>.bitocard.com`. Stores are made by checkout (`checkout.service.ts:227`), by `POST /v1/admin/countries/:code/store` and by migration `20270118000000_country_stores_everywhere`. Their address is made by `StoreHostsService`.
- **Who sells** (`StoreSellers.sellerFor`, `store-sellers.ts:115`):
  - on a country store, that store's market, whoever is buying;
  - on bitocard.com, the house reseller of the **customer's own country**.

  The price is always in the seller's currency.
- **Signed-in customers are redirected to their country store** (`(store)/layout.tsx:66`, `(app)/layout.tsx:67`, `market-action.ts`). Sessions there are host-only, so they cross over through the sign-in handoff.
- **"Every 2-letter subdomain is BitoCard's"** is assumed in:
  - `gift-card-sales.service.ts:150`
  - `handoff.service.ts:54`
  - `packages/ui/src/handoff.ts:36`
  - `next.config.ts:15`
  - `customer-session.ts:65` (shared accounts)

**Wallets**
- There is no list of a customer's wallets. They are `customer_wallet` ledger accounts per currency, and `walletCurrencies(local)` (`wallet.service.ts:23`) allows exactly `[local, USD]`.
- `local` is the **seller's** market (`customer-wallets.ts:110`), not always the customer's.
- `FxService.exchange` and `usdCovering` only convert to or from US dollars.
- About 16 places assume exactly two wallets: the API, the buy form, the wallet page, the sub menus, the spin exchange, manual top-ups and the admin customer page.
- These already handle any currency: refunds (`checkout_refund`), crediting top-ups, `balances()` and `transactions()`.

## Recommendations

### A. Who sells and in what currency on one store (the key decision)

Today's rule ("seller = the customer's country") is what made a GB customer buying Nigerian stock fail (`conversion_unavailable`). Country stores worked around it. Without them, I recommend that **the product decides the seller** and **the wallet decides how the customer pays**:

1. **Seller of record:** the house reseller of the market the product is sold in.
   - A local product (airtime, data, bills, pay-TV, mobile money) is sold by its own country's house reseller, in that currency. NG airtime is sold by BitoCard Nigeria in NGN, whoever buys it.
   - A worldwide product (gift cards, software, VPN) is sold by the customer's **home** market, as today.

   This keeps the books, tax and suppliers per market exactly as they are (house resellers stay; only their storefronts go).
2. **Price shown:** in the currency of the wallet the customer has chosen to pay from (default: their home wallet), converted at BitoCard's disclosed rate. The quote still locks the seller's price and the rate.
3. **Paying from any wallet:** `payFromWallet` already books a conversion through `currency_exchange`. It is generalised from "USD ↔ price" to "any wallet currency ↔ price" with a new `FxService.cross(from, to)` via US dollars: one rate and **one** margin, never two. A cross rate that is stale or paused refuses as today.
4. **Tax** stays by the customer's location (their home country) and the product's market, as the seller rules already require.

### B. Wallets

**Applies to every BitoCard customer** (the owner, 15 November 2026): bitocard.com's customers **and every reseller store's customers**.
- Each customer has US dollars plus their signed-up country (on a reseller's store, the reseller's country, as sign-up already fixes it), and can add the currencies an admin has opened.
- **A reseller's store** still sells in the reseller's currency. A customer paying from another wallet is converted at checkout, as on bitocard.com.
- The store's `customer_wallets` switch and own-gateway rule (`CustomerWalletsService.enabled`) still decide whether the store uses wallets at all.
- **Fix as part of this:** the home wallet is the **customer's** country (`customer.country`), never the seller's (`customer-wallets.ts:110` uses the seller's today).

1. **A list of each customer's wallets:** new table `customer_wallet_currencies`.
   - Fields: `customer_id`, `currency`, `added_at`, `removed_at`.
   - US dollars and the home currency are always present (not stored, never removable).
   - Balances stay in the ledger, as now.
2. **Which currencies can be added:** markets where:
   - the `customer_wallets` switch is on;
   - a new country-level switch `customer_foreign_wallets` (off by default; per country) says its currency may be held by customers of other countries;
   - and an exchange rate is fresh.

   `GET /v1/store/wallet/currencies` lists them with why one is closed.
3. **API:**
   - `GET /v1/store/wallet` returns every held wallet (`wallets[]`, `home`, `usd`).
   - `POST /v1/store/wallet/wallets { currency }` adds one.
   - `DELETE /v1/store/wallet/wallets/:currency` removes one, only at a zero balance; US dollars and the home wallet never.
   - `walletCurrencies(local)` becomes `heldCurrencies(customer)` everywhere it gates.
4. **Top-ups per wallet:** the methods of **that currency's market** (a KES wallet uses Kenya's methods: cards and M-Pesa through pawaPay). The payment's `country` is that market, and pawaPay still needs a number of that country.
   - **Bank account numbers** (reserved accounts) stay on the **home** wallet only. NG BVN and GH rules are per country; extending them comes later.
5. **Moving money between wallets:** `POST /v1/store/wallet/conversions { from, to, amount, preview? }`, modelled on the resellers' `WalletService.convert`. It uses the cross rate, rounds down, and writes one `conversion` entry through `currency_exchange`. The rate and amount are shown before confirming.
   - Spend only: never withdrawn, as now.
6. **Every place that pays or credits a wallet:**
   - **Checkout:** `wallet_options` lists every held wallet with `amount`, `balance` and `enough`.
   - **Spin exchange:** into any held wallet.
   - **Manual top-ups (admin):** any held wallet.
   - **Gift card sales:** credit NGN as now; a sale adds the NGN wallet if it is missing.
   - **UdozoPay and resale:** these are Udozo's and are not touched.

### C. Retiring the country stores

1. **Switched off at once (the owner's choice).** `StoreHostsService.retire` removes each house country store's Cloudflare record (only BitoCard's own, by its `bitocard:store:<id>` comment) and its domain on the storefront's Vercel project, run once by operations after deploy and audited.
   - Old links to `<cc>.bitocard.com` stop resolving. That includes bookmarks, shared links and **order page links already emailed** (`/a/<token>` was on the country store's address).
   - Before switching off, new order page links for house stores are made on bitocard.com (`orderStore` → root). The access page finds the order by its token whatever the host, so a customer can be sent a fresh link (SHQ and admin "replace link") on request.
   - Customers who were signed in on a country store sign in again on bitocard.com. The `bc_signed_in` handoff cookie offers "Continue as".
2. **Stop making them:**
   - remove `house.storeFor` from checkout;
   - the admin endpoint answers `gone`;
   - the `country_stores` switch is removed;
   - a migration unpublishes house country stores but **keeps the rows**, because quotes, orders, chats and spins reference their ids.
3. **The store's market on bitocard.com:**
   - The market chooser stays for everyone. Signed out, it uses the `bc_market` cookie; signed in, it defaults to the home country and can be changed.
   - It sets what is shown (local products and prices) and never redirects.
   - Remove `countryStoreFor`, `countryStoreUrl`, `/go-global`, the "Shop globally" link and `store_subdomain` on countries.
4. **Remove the 2-letter rules:**
   - `gift-card-sales` `offersFor` (root only);
   - handoff targets (bitocard.com, shop.bitocard.com only);
   - `isHouseOrigin`;
   - the `next.config` exemption;
   - shared-account store swapping in `customer-session.ts` (once redirects are live, no request reaches a country store's API).
5. **Unchanged:** house reseller accounts (one per market), customer accounts (already bitocard.com's), customers' orders (listed by customer, not store), tickets and chats (already routed by the customer's country).

### D. Storefront

- **Wallet page** (`/account/wallet`):
  - scrollable `UnderlineTabs` of held wallets, the home wallet first, then US dollars, then the rest;
  - **Add wallet** (choose from what is open; Soon shown for closed ones with why);
  - **Move money** (the conversion dialog);
  - **Remove** on an empty extra wallet.
- **Home:** the wallet card shows the home balance, plus "and 2 other wallets".
- **Sub menus:** built from the held wallets, not `customer.currency`.
- **Buy form:**
  - "Pay from" lists every held wallet (scrolling list) with the amount in each, and shows which are short;
  - the price is shown in the chosen wallet;
  - refund copy names the wallet paid from.
- **Transactions:** filter by wallet (`?wallet=`).
- **Admin customer page:** lists every held wallet and offers manual top-ups to any of them.

### E. Legal and docs

- **Terms of use, customer wallets section:** several currencies, adding and removing, conversions at BitoCard's disclosed rate, spend only, and what happens to a removed or closing balance.
- **Legal advice:** holding balances in a foreign currency for a customer, and converting between them, may be foreign exchange dealing in some markets (CBN in Nigeria). The switches stay off until cleared.
- **AGENTS.md:** replace the Country stores and Two wallets entries. `PLANS.md` too.

## Order of work (each step tested, committed locally, pushed only on the owner's go)

1. **FX:** `FxService.cross` and its tests.
2. **API:**
   - the held-wallets table and switch;
   - list, add and remove, conversions;
   - top-ups per currency market;
   - checkout `wallet_options` and paying from any wallet;
   - spins and manual top-ups;
   - tests (`usd-wallets`, `customer-wallets` and a new `multi-wallets.test.mjs`).
3. **API:** seller by product (recommendation A); root-only checkout; stop provisioning; remove the 2-letter rules; migration unpublishing country stores. Rework `country-stores.test.mjs` into `single-store.test.mjs`. Check that a GB customer buying NG airtime from the USD wallet now works.
4. **Storefront:**
   - remove market redirects and country-store helpers;
   - wallet page, Add wallet and Move money;
   - buy form, sub menus, Home and transactions;
   - tests.
5. **Admin:** customer wallets list.
6. **Copy:** legal drafts, AGENTS.md, PLANS.md, and the api-client types (and `mobile/udozo` shared copy sync).
7. **Check on the local copy:** checkout, top-up and conversions in sandbox; that `ng.localhost` no longer serves a store; screenshots at desktop and 390 px.
8. **After the owner's go and deploy:** operations run the retire step (DNS and Vercel domains).

## Decided (15 November 2026)

1. The product decides the seller; customers pay from any wallet (A as recommended).
2. Customers may move money between their own wallets, with the rate shown first (B5).
3. Country subdomains are switched off at once, not redirected (C1).
4. Extra wallets only in currencies an admin opens (`customer_foreign_wallets`, per country, off by default).
5. Wallets are for every customer, resellers' stores included: USD plus the signed-up country, and extra currencies an admin has opened.
6. Still open: the home country stays fixed for good (assumed yes).
