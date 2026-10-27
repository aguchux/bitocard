# BitoCard Crypto (`crypto.bitocard.com`): plan

**Status:** planned 27 October 2026, nothing built. Where this plan differs from `AGENTS.md` or `PLANS.md`, those win until the decisions below are signed off and merged back.

BitoCard Crypto is a public crypto market app in the style of BitoCard Shop: `apps/crypto` at `https://crypto.bitocard.com`, with the **global market** at `/` (US dollars, open to traders from every country where it is cleared) and a **country market** at `/<cc>` (`/ng` in naira, `/ke` in shillings, `/gh` in cedis). It is built on what already exists: the P2P order books, ads, instant trades, crypto wallets, deposits and withdrawals, cash-out and the sign-in handoff BitoCard Shop uses. What is new is the global book, the app itself, and **global money rails**: ways to pay USD in and take USD out that admins integrate and switch on.

## What exists today (27 October 2026)

- **Order books** are keyed by mode, country, currency, asset and side (`P2pService.book`, `apps/api/src/crypto/p2p.service.ts`; `p2p_ads.country`, `p2p_ads.currency`). A customer trades only in their own country's book (the seller's country, `CryptoWalletsService.context`), in their local currency or USD (`tradeCurrency`). So each country already has a small USD book of its own. There is no global book.
- **Fiat** for a trade comes from P2P money (`customer_withdrawable`) first, then the spend-only wallet (`customer_wallet`), in the trade's currency. Sale money goes to `customer_withdrawable[currency]`, except USD sales outside a USD country, which go to the spend-only `customer_wallet[USD]` because nothing can pay USD out.
- **Cash-out** (`CustomerPayoutsService`) pays only local currency, only through Flutterwave transfers (NG, GH, KE). A pawaPay mobile money payout path exists for resellers but not for customers. There is no USD or international payout rail (no PayPal, Wise, Payoneer or Stripe payouts).
- **Payment methods** are per country and purpose (`wallet_top_up`, `checkout`); each market works in its own currency. Stripe already falls back to USD when it refuses a currency.
- **BitoCard Shop's pattern**, to copy: `apps/shop` with `app/(global)` and `app/[cc]` (open markets from a public API, `notFound()` otherwise), server-only API reads, its own host-only `bc_customer` cookie with no store named (bitocard.com accounts), the sign-in handoff (`/handoff`, `/handoff/go`, `bc_signed_in`), and the handoff allowlist in `HandoffService.target` (`apps/api/src/customers/handoff.service.ts`) and `isHouseOrigin` (`packages/ui/src/handoff.ts`), which names the storefront, the Shop and country stores only.
- **Storefront crypto screens** (`apps/storefront/app/(app)/account/crypto/*`, `components/app/p2p-market.tsx`, `crypto.tsx`, `crypto-forms.tsx`, `p2p-dialogs.tsx`, `lib/crypto-actions.ts`, `lib/p2p-market.ts`). Every page fetches through the storefront's `customerApi`, which names the store (`BitoCard-Store`), so they cannot be imported by another app as they are. `lib/p2p-market.ts` is pure and portable.
- **Switches:** `crypto_wallets`, `p2p_trading`, `crypto_exchange` (global, country, reseller; off by default).
- **`crypto` is not a reserved subdomain** (`apps/api/src/stores/reserved.ts`): today a reseller could name a store `crypto` and take `crypto.bitocard.com`.

## Product decisions (proposed, for the owner to sign off)

1. **Two kinds of market.**
   - **Global market** (`/`): one order book per mode and asset in **USD**, stored as country `WW` (as worldwide products are). Any verified customer whose country is cleared for it may trade there, from their USD balances.
   - **Country markets** (`/<cc>`): the existing country books, **in the local currency only**. The per-country USD books are retired: USD trading moves to the global market (existing USD ads are moved to `WW` by migration; only sandbox ads exist today).
2. **"Trades are managed in the local area"**, read as: a customer posts and takes ads only in **their own country's market** (as today) **and the global market**. Other countries' markets can be browsed (`/ke` from Nigeria) but not traded in. Each country market keeps its own fees, limits, payout hold, payment and payout methods and admins' controls. *(Confirm this reading.)*
3. **Accounts are bitocard.com's.** Anyone with a bitocard.com account signs in, through the same handoff as the Shop (Continue as …). New customers sign up on bitocard.com and come back. A customer's country stays fixed, and decides their country market. Customers of resellers' stores (separate accounts per store) keep trading in their store's Crypto tab, in the same books.
4. **Global money rails.** The global market needs USD in and out:
   - **In:** USD top-ups of the customer wallet through the gateways admins switch on for USD (Stripe card first; Flutterwave USD card where offered), plus on-chain deposits (already built: selling deposited USDT is the cheapest way in).
   - **Out:** USD sale money becomes **withdrawable** (`customer_withdrawable[USD]`, no longer the spend-only wallet) and is paid out through **payout methods admins integrate and switch on per currency and country**. The candidates are all to confirm: Flutterwave USD transfers to Nigerian domiciliary accounts, Wise Platform, PayPal Payouts, Payoneer, and Stripe Connect cross-border payouts. Withdrawing USDT on chain (built) is always the other way out.
5. **Fees and limits per market.** BitoCard's P2P fee (`crypto_assets.p2p_fee_bps`) gains per-market overrides (`WW` and each country), and so do the daily limits. Global trades carry a longer payout hold on USD sale money than local ones (card top-ups are reversible for months).
6. **One address per market, no content by cookie or address.** As in the Shop: `/` is always the global market and `/<cc>` always that country's. Signed-in customers get **Your market** in the switcher and a "Trade in <country>" prompt on `/`, never a silent redirect.
7. **Public browsing.** Market pages are public and indexed (nicknames, prices, limits and trade counts only, never customer IDs). Taking or posting an ad needs signing in. *(Confirm: some regulators treat public crypto ads as promotion. The safer default is `noindex` until each market is cleared.)*
8. **BitoCard's own sites point to it.** On bitocard.com and the country stores, the header's Crypto link and the account app's Crypto tab open crypto.bitocard.com (through the handoff when signed in). Resellers' stores keep their own Crypto tab. *(Confirm: redirect, or keep both.)*

## Legal and risk (must be cleared before anything goes live)

- **The global market is new regulated ground.** A USD P2P market with USD cash-out is a virtual asset service and very likely money transmission. Who operates it matters: by `legal.ts`, "anywhere unlisted" is Golojan Technologies LLC (Delaware), and serving US persons would need FinCEN MSB registration, state money transmitter licences and New York's BitLicense. **Recommendation:** exclude US persons (and every OFAC-sanctioned country) from the global market at the identity check, decide the operating entity per region, and keep `crypto_global` in the sandbox until counsel clears it.
- **Country markets** keep the existing per-country advice (SEC Nigeria, Ghana's VASP regime, Kenya's VASP Act 2025), AML/CFT and the travel rule, which applies to on-chain withdrawals and possibly to P2P transfers between users.
- **Sanctions:** block sign-in to trading and payouts by the identity check's document country and by the verified country, not by IP alone. Payout accounts are screened by the payout providers.
- **Fraud:** item 5 of `PLANS.md` 6b becomes a launch blocker for the global market. A card top-up spent in P2P becomes the counterparty's withdrawable USD after the payout hold, which is shorter than chargeback windows. So: a longer USD hold, review of payouts funded by recent reversible top-ups, and a 24-hour total for withdrawal review.
- **Documents:** crypto terms gain a Global market section (USD, who may trade, payout methods, holds, fees); the privacy notice names each payout provider and what it receives; the cookie notice gets nothing new (`bc_customer` and `bc_signed_in` on the new host are already listed; add the host).

## Design

### API

- **Markets.** `P2pMarket = 'WW' | <country code>`. The book stays `(mode, country, currency, asset, side)`: `WW` with `USD`, a country with its own currency. `CryptoWalletsService.context(customer, market)` resolves which market a request is for and refuses a market the customer cannot trade in (`market_unavailable`: another country's, or global where it is not cleared). A migration moves non-USD-country USD ads to `WW` and adds the missing index on `currency`.
- **Switches.**
  - `crypto_app`: global or country, off by default. The country market (and the global market's listing of that country) appears on crypto.bitocard.com.
  - `crypto_global`: global or country, off by default. Global is the market itself; country is whose residents may trade in it. It needs `crypto_wallets` and `p2p_trading` for the customer's country, as today.
  - `crypto_install_prompt`: as the other install prompts.
- **Public reads** (no session, cached a minute, left out of the public OpenAPI document like the Shop's):
  - `GET /v1/crypto/markets`: the global market and each open country, with currency, assets on sale, ad counts and `install_prompt`.
  - `GET /v1/crypto/markets/:market/ads?asset&side&amount&q&sort`: ads as on today's market, nicknames only.
  - `GET /v1/crypto/traders/:nickname`: a trader's public card (trades in 30 days and in all, markets traded).
- **Trading** reuses the customer routes (`/v1/store/p2p/*`) with a `market` parameter (default: the customer's country) in place of `currency`. Quotes, trades and ads behave as now, in that market's currency.
- **USD sale money is withdrawable.** Global trades credit `customer_withdrawable[USD]`, inside the global payout hold. The existing USD-to-wallet exception is removed with the per-country USD books.
- **Payout methods.**
  - A new purpose `payout` on `payment_methods`, per currency and country, switched on and ordered by admins (Settings > Markets, and a new **Global** entry for `WW`/USD).
  - A `PayoutProvider` interface beside `TransferProvider` (create recipient, verify holder where the rail can, send, status, fee), with Flutterwave transfers adapted to it first and each new rail an adapter with its own integration card, Sandbox switch and Test connection.
  - `customer_bank_accounts` become **payout accounts** with a `kind` (`bank`, `mobile_money`, `paypal`, `wise`, …) and a currency. The 24-hour wait and the verified-name match stay where the rail returns a holder's name. Rails that give no name (PayPal) need a passed identity check and get lower limits.
  - `CustomerPayoutsService` pays from `customer_withdrawable[currency]` through the method chosen. Customers' mobile money payouts reuse the pawaPay path built for resellers.
- **Handoff.** `CRYPTO_URL` (config, integration setting, `appUrl("crypto")`, local port 3008) is added to `HandoffService.target` and `isHouseOrigin`. The handoff stays bitocard.com accounts only.
- **Reserved name.** `crypto` goes in `reservedSubdomains`, with a check that no store already uses it (any that does is renamed with operations, before DNS is pointed).

### Shared code

Move the market's presentation into a package rather than copy it:

- `@bitocard/crypto-ui` (TypeScript source, like the others) holds the pure helpers (today's `lib/p2p-market.ts`, coin badges and marks) and the presentational components (`MarketAds`, `MarketFilters`, ad cards and rows, `CoinPicker`, trade and ad forms, wallet and trade lists). They take the market's base path and **server actions as props**, since each app has its own `customerApi` (the storefront names a store, the crypto app does not).
- The storefront's crypto pages become thin wrappers passing their own actions. Its behaviour and tests stay unchanged, and are checked so.

### `apps/crypto`

Built like `apps/shop` (Next.js App Router, server components reading the API on the server only, never throwing; server actions; host-only `bc_customer`; shoppers' addresses signed with `STORE_SERVER_SECRET`):

- **Header:** the Bitocard lockup with **Crypto**; the market switcher (Global plus every open country with its flag and currency, Your market first when signed in); links to Market, Wallets and My ads; Sign in, or the account; and **Post ad**.
- **Market pages:** `/` (global) and `/<cc>` (`[cc]/layout.tsx` only for open countries): the full-width market with grid or list, buy or sell, coin, amount, trader, experienced and order (today's market, from `@bitocard/crypto-ui`), and a strip of the other markets.
- **Other public pages:** `/trader/<nickname>`; `/how-it-works` (how instant P2P works, fees, holds, safety).
- **Account pages** (signed in; a market's pages act in that market):
  - `/wallets`: coins, P2P money per currency, USD and local;
  - `/ads` and `/ads/post`;
  - `/trades(/<id>)`;
  - `/deposit`, `/withdraw(/confirm)`, `/withdrawals/<id>`;
  - `/cash-out`: per currency, with the payout methods open to the customer;
  - `/payout-methods`;
  - `/top-up`: USD and local, through the gateways switched on.

  They reuse the components and the API routes built for the storefront.
- **Sign-in:** `/signin` (Continue as, else email and password), `/verify`, `/handoff`, `/handoff/go`, as in the Shop.
- **Search engines** (if decision 7 holds): canonical tags, hreflang between markets, a sitemap of markets and trader pages, Open Graph cards per market, nothing per customer.
- **Install as an app:** as the Shop, behind `crypto_install_prompt`.
- **Hosting:** a Vercel project `bitocard-crypto` (Root Directory `apps/crypto`, skip unaffected deployments, `VERCEL_DEEP_CLONE`, `STORE_SERVER_SECRET`, `API_URL`), and a DNS-only CNAME `crypto` on Cloudflare to Vercel.

### Admin

- **Crypto > Markets:** the global market and every country, each with open on the app (`crypto_app`), global trading for its residents (`crypto_global`), the P2P fee and limits per asset, the payout hold, and its payout and top-up methods; ads and trades filterable by market.
- **Settings > Integrations:** each payout rail's card.
- **Crypto > P2P payouts:** shows the method and currency.

## Stages

0. **Decisions and protection.** The owner signs off the decisions above. Reserve `crypto` and check no store holds it. Legal intake for the global market (entity, US exclusion, licences). Choose the first global payout rail with finance, after asking the candidates for coverage, fees, limits, holder-name checks and terms for paying out P2P proceeds.
1. **Markets in the API.** `WW` market, `market` parameter, the USD-ads migration, `crypto_app` and `crypto_global`, USD sale money withdrawable, per-market fees, limits and holds, public reads. Tests on PGlite and Docker: races across the global book, refusal of other countries' markets, US and sanctioned exclusion, and money never trapped when a switch goes off.
2. **`@bitocard/crypto-ui`.** Extract the market and crypto components; the storefront switches to them with its tests unchanged.
3. **`apps/crypto`, public.** Scaffold, header and market switcher, global and country market pages, trader pages, sign-in and handoff, SEO, install prompt, Vercel project and DNS. Trading opens in the sandbox only.
4. **`apps/crypto`, account.** Wallets, ads, trades, deposit, withdraw and top-up, reusing the components. BitoCard's own sites' Crypto links point here (decision 8).
5. **Global money rails.** The `payout` purpose, `PayoutProvider`, payout accounts by kind, the first global rail, customers' mobile money payouts, USD top-ups per market. Admin cards and Crypto > Markets.
6. **Hardening.** The fraud controls above, the security review, legal documents, browser checks at phone width.
7. **Pilot.** One country market plus the global market for that country's residents, live, then country by country.

## Open questions for the owner

1. Is decision 2 the right reading of "trades are managed in the local area"?
2. Which entity runs the global market, and may US persons use it? (The recommendation is no.)
3. Which global payout rail comes first? (The recommendation is Flutterwave USD domiciliary transfers for Nigeria, plus one international rail such as Wise or PayPal after their answers.)
4. Should market pages be indexed from day one, or `noindex` until each market is cleared?
5. On BitoCard's own sites, does the Crypto tab move to crypto.bitocard.com, or stay as well?
6. Should a country whose local crypto is off still let its residents trade in the global market?
