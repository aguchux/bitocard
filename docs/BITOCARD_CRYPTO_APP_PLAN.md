# BitoCard Crypto (`crypto.bitocard.com`): plan

**Status:** planned 27 October 2026; the owner's decisions recorded the same day (below). Built so far: `crypto` reserved as a subdomain no store can take. Everything else is to build.

BitoCard Crypto is a public crypto market app in the style of BitoCard Shop: `apps/crypto` at `https://crypto.bitocard.com`, with the **global market** at `/` (US dollars, traded across BitoCard's African markets) and a **country market** at `/<cc>` (`/ng` in naira, `/ke` in shillings, `/gh` in cedis). It is built on what already exists: the P2P order books, ads, instant trades, crypto wallets, deposits and withdrawals, cash-out and the sign-in handoff BitoCard Shop uses. What is new is the global book, the app itself, and **global money rails**: ways to pay USD in and take USD out that admins integrate and switch on.

## What exists today (27 October 2026)

- **Order books** are keyed by mode, country, currency, asset and side (`P2pService.book`, `apps/api/src/crypto/p2p.service.ts`; `p2p_ads.country`, `p2p_ads.currency`). A customer trades only in their own country's book (the seller's country, `CryptoWalletsService.context`), in their local currency or USD (`tradeCurrency`). So each country already has a small USD book of its own. There is no global book.
- **Fiat** for a trade comes from P2P money (`customer_withdrawable`) first, then the spend-only wallet (`customer_wallet`), in the trade's currency. Sale money goes to `customer_withdrawable[currency]`, except USD sales outside a USD country, which go to the spend-only `customer_wallet[USD]` because nothing can pay USD out.
- **Cash-out** (`CustomerPayoutsService`) pays only local currency, only through Flutterwave transfers (NG, GH, KE). A pawaPay mobile money payout path exists for resellers but not for customers. There is no USD or international payout rail (no PayPal, Wise, Payoneer or Stripe payouts).
- **Payment methods** are per country and purpose (`wallet_top_up`, `checkout`); each market works in its own currency. Stripe already falls back to USD when it refuses a currency.
- **BitoCard Shop's pattern**, to copy: `apps/shop` with `app/(global)` and `app/[cc]` (open markets from a public API, `notFound()` otherwise), server-only API reads, its own host-only `bc_customer` cookie with no store named (bitocard.com accounts), the sign-in handoff (`/handoff`, `/handoff/go`, `bc_signed_in`), and the handoff allowlist in `HandoffService.target` (`apps/api/src/customers/handoff.service.ts`) and `isHouseOrigin` (`packages/ui/src/handoff.ts`), which names the storefront, the Shop and country stores only.
- **Storefront crypto screens** (`apps/storefront/app/(app)/account/crypto/*`, `components/app/p2p-market.tsx`, `crypto.tsx`, `crypto-forms.tsx`, `p2p-dialogs.tsx`, `lib/crypto-actions.ts`, `lib/p2p-market.ts`). Every page fetches through the storefront's `customerApi`, which names the store (`BitoCard-Store`), so they cannot be imported by another app as they are. `lib/p2p-market.ts` is pure and portable.
- **Switches:** `crypto_wallets`, `p2p_trading`, `crypto_exchange` (global, country, reseller; off by default).
- **`crypto` is reserved** (`apps/api/src/stores/reserved.ts`, 27 October 2026; before launch, so no store held it), so no reseller can take `crypto.bitocard.com`.

## Decisions (the owner, 27 October 2026)

1. **African markets only, for now.** The global market and every country market serve residents of BitoCard's African markets that admins open. Nobody else can trade.
2. **Three ways to trade**, all paid from and to BitoCard wallets (no money changes hands off the platform; sale money is withdrawable and cashed out):
   - **Same country, local:** buyer and seller in the same country trade in that country's market, **in its local currency or in US dollars** (the existing local and USD books stay).
   - **Across borders, global:** residents of different open countries trade on the **global market** (`/`), in US dollars. For example, a Nigerian and a Ghanaian trade USDT for USD.
   - **Across borders, local:** a resident of one open country may trade in **another country's local-currency book**. For example, a Nigerian sells USDT on `/gh` to a Ghanaian and receives cedis. Cross-border trading is switched on per market by admins and held to its own lower limits. Another country's USD book stays for its residents (the global market is the cross-border USD market).
3. **A customer holds a balance per currency they trade in:** their own currency, US dollars, and any other open market's currency they have sold into (a Nigerian holding cedis). Each is cashed out only through that currency's rails, to an account in the customer's **verified name** (cedis to a Ghanaian bank or mobile money account). Without one they can still spend it in that market, for example buying USDT on `/gh` with the cedis; money is never trapped.
4. **Who may sign up:** with the terms, every new account confirms they are **not a citizen of the United States or the United Kingdom**, recorded by version like the Shop terms. Existing accounts confirm before their first trade. The identity check is strict and required for every live trade, and a US or UK document is refused for crypto. *(Recommended: also "not resident", and refuse every OFAC-sanctioned country's documents.)*
5. **Operated by BitoCard.** In the legal documents, BitoCard's African entity (De-Golojan Technologies Ltd, `packages/ui/src/legal.ts`), to confirm with counsel.
6. **Fraud:** admin gates and fraud tracking are strengthened before launch. **Maximum amounts start low** (per trade, per day and per customer, per market, with tighter cross-border limits) and are raised only once operations prove trustworthy. Plus the controls in Legal and risk below.
7. **Payout rails:** **Flutterwave, Payoneer and Paystack** first; **Wise and PayPal** later. Each is an integration admins switch on per currency and country.
8. **Search engines from day one:** market and trader pages are public and indexed (nicknames, prices, limits and trade counts only; never customer IDs).
9. **BitoCard's own sites point to it:** the header's Crypto link and the account app's Crypto tab on bitocard.com and the country stores open crypto.bitocard.com (through the handoff when signed in). Resellers' stores keep their own Crypto tab, trading in the same books.
10. **One address per market, no content by cookie or address.** `/` is always the global market and `/<cc>` always that country's. Signed-in customers get **Your market** first in the switcher, never a silent redirect.
11. **Accounts are bitocard.com's.** Anyone with a bitocard.com account signs in through the Shop's handoff (Continue as ...); new customers sign up on bitocard.com. A customer's country stays fixed and is their home market.
12. **The global market does not need the local market.** Residents of a country whose own market is off (local crypto or P2P switched off there) may still trade on the global market, while global trading is open for their country (`crypto_global`). Their wallets, deposits, withdrawals and USD cash-out then serve the global market only.

## Legal and risk (before anything goes live)

- **Licensing per country** for every open market and for every country whose residents trade on the global market (decision 12 serves them even where their own market is closed) (SEC Nigeria, Ghana's VASP regime, Kenya's VASP Act 2025), and for the **cross-border** trades: one company settling trades between residents of two countries, in either country's currency, is the point counsel must clear first. AML/CFT, and the travel rule for on-chain withdrawals and possibly P2P transfers between users.
- **US and UK:** the citizenship declaration and refusing US and UK documents keep the market for Africans as decided. The sites stay reachable from anywhere, so the terms and pages also need wording that makes no offer to US or UK persons.
- **Sanctions:** refuse sanctioned countries' documents at the identity check, and screen payout accounts through the payout providers.
- **Fraud** (decision 6). `PLANS.md` 6b item 5 becomes a launch blocker: a card top-up spent in P2P becomes the counterparty's withdrawable money after the payout hold, which is shorter than chargeback windows. So:
  - longer holds on money from cross-border trades;
  - review of payouts funded by recent reversible top-ups;
  - a 24-hour total for withdrawal review;
  - alerts for patterns: many counterparties, round trips between the same people, new accounts trading at once;
  - one-click freezes, already built.
- **Documents:**
  - crypto terms: the global market and cross-border trading, holding other currencies, payout methods, holds, limits and fees, and the US and UK declaration;
  - privacy notice: each payout provider (Flutterwave, Payoneer, Paystack, later Wise and PayPal) and what it receives;
  - cookie notice: the crypto host for `bc_customer` and `bc_signed_in`.

## Design

### API

- **Markets.** `P2pMarket = 'WW' | <country code>`. The book stays `(mode, country, currency, asset, side)`:
  - `WW` books are in USD only;
  - a country has its local-currency book and its USD book.

  `CryptoWalletsService.context(customer, market, currency)` decides what the customer may do there:
  - **home market:** local and USD;
  - **another open country:** its local currency only, while that market's cross-border switch and the customer's own country's allow it;
  - **`WW`:** while global trading is open for their country, whether or not their own market is (decision 12);
  - anything else: `market_unavailable`.

  `trade` looks ads up by market, not by the customer's own country. Add the missing index on `currency`.
- **Switches** (all off by default):
  - `crypto_app`: global or country. The country market appears on crypto.bitocard.com.
  - `crypto_global`: global or country. Global is the market itself; country is whose residents may trade in it. It does **not** need the country's `crypto_wallets` or `p2p_trading` (decision 12): with only `crypto_global` on, a resident's crypto wallet, deposits, withdrawals and USD cash-out work for the global market, and their country's market stays closed to them. `CryptoWalletsService.require` takes the market it is asked for.
  - `crypto_cross_border`: country. Residents of other open countries may trade in this market's local book.
  - `crypto_install_prompt`: as the other install prompts.
- **Eligibility record:** `crypto_declarations` (customer, version, citizenship declaration, time), required for live trading. The identity check's document country is checked against a refused list (US, GB and sanctioned countries) for crypto.
- **Limits per market** (`crypto_market_limits`: market, asset or fiat, per trade, per day and per customer, cross-border, mode): checked under the same locks as today's daily limits, starting low (decision 6), changed by finance and operations with step-up, audited.
- **Public reads** (no session, cached a minute, left out of the public OpenAPI document like the Shop's):
  - `GET /v1/crypto/markets`: the global market and each open country, with currency, assets on sale, ad counts and `install_prompt`.
  - `GET /v1/crypto/markets/:market/ads?asset&side&amount&q&sort`: ads as on today's market, nicknames only.
  - `GET /v1/crypto/traders/:nickname`: a trader's public card (trades in 30 days and in all, markets traded).
- **Trading** reuses the customer routes (`/v1/store/p2p/*`) with a `market` parameter (default: the customer's country) beside `currency`. Quotes, trades and ads behave as now, in that market and currency.
- **All sale money is withdrawable**, in its currency: USD sales (local and global) credit `customer_withdrawable[USD]` instead of the spend-only wallet, and a cedi sale by a Nigerian credits their `customer_withdrawable[GHS]`, each inside its market's payout hold (longer for cross-border trades). Paying for a trade takes P2P money then the wallet in that currency, as now. `GET /v1/store/crypto` lists every currency held.
- **Payout methods.**
  - A new purpose `payout` on `payment_methods`, per currency and country, switched on and ordered by admins (Settings > Markets, and a new **Global** entry for `WW`/USD).
  - A `PayoutProvider` interface beside `TransferProvider` (create recipient, verify holder where the rail can, send, status, fee), with Flutterwave transfers adapted to it first and each new rail an adapter with its own integration card, Sandbox switch and Test connection.
  - `customer_bank_accounts` become **payout accounts** with a `kind` (`bank`, `mobile_money`, `paypal`, `wise`, …) and a currency. The 24-hour wait and the verified-name match stay where the rail returns a holder's name. Rails that give no name (PayPal) need a passed identity check and get lower limits.
  - `CustomerPayoutsService` pays from `customer_withdrawable[currency]` through the method chosen. Customers' mobile money payouts reuse the pawaPay path built for resellers.
  - Rails, in order: **Flutterwave** (transfers built: NG, GH, KE; then its USD domiciliary transfers), **Paystack** (transfers in NG, GH, KE, ZA), **Payoneer** (USD to the customer's Payoneer account); later **Wise** and **PayPal**. Ask each about coverage, fees, limits, the holder's name, and terms for paying out P2P proceeds before building its adapter.
- **Handoff.** `CRYPTO_URL` (config, integration setting, `appUrl("crypto")`, local port 3008) is added to `HandoffService.target` and `isHouseOrigin`. The handoff stays bitocard.com accounts only.
- **Reserved name.** Done: `crypto` is in `reservedSubdomains` (no store held it before launch), which also lets `https://*.bitocard.com` in `ALLOWED_ORIGINS` admit the app as one of BitoCard's own.

### Shared code

Move the market's presentation into a package rather than copy it:

- `@bitocard/crypto-ui` (TypeScript source, like the others) holds the pure helpers (today's `lib/p2p-market.ts`, coin badges and marks) and the presentational components (`MarketAds`, `MarketFilters`, ad cards and rows, `CoinPicker`, trade and ad forms, wallet and trade lists). They take the market's base path and **server actions as props**, since each app has its own `customerApi` (the storefront names a store, the crypto app does not).
- The storefront's crypto pages become thin wrappers passing their own actions. Its behaviour and tests stay unchanged, and are checked so.

### `apps/crypto`

Built like `apps/shop` (Next.js App Router, server components reading the API on the server only, never throwing; server actions; host-only `bc_customer`; shoppers' addresses signed with `STORE_SERVER_SECRET`):

- **Header:** the Bitocard lockup with **Crypto**; the market switcher (Global plus every open country with its flag and currency, Your market first when signed in, and on other countries whether you may trade there); links to Market, Wallets and My ads; Sign in, or the account; and **Post ad**.
- **Market pages:** `/` (global) and `/<cc>` (`[cc]/layout.tsx` only for open countries): the full-width market with grid or list, buy or sell, coin, amount, trader, experienced and order (today's market, from `@bitocard/crypto-ui`), and a strip of the other markets.
- **Other public pages:** `/trader/<nickname>`; `/how-it-works` (how instant P2P works, fees, holds, safety).
- **Account pages** (signed in; a market's pages act in that market):
  - `/wallets`: coins, P2P money per currency, USD and local;
  - `/ads` and `/ads/post`;
  - `/confirm`: the US and UK declaration, asked once before the first trade;
  - `/trades(/<id>)`;
  - `/deposit`, `/withdraw(/confirm)`, `/withdrawals/<id>`;
  - `/cash-out`: per currency, with the payout methods open to the customer;
  - `/payout-methods`;
  - `/top-up`: USD and local, through the gateways switched on.

  They reuse the components and the API routes built for the storefront.
- **Sign-in:** `/signin` (Continue as, else email and password), `/verify`, `/handoff`, `/handoff/go`, as in the Shop.
- **Search engines** (decision 8): canonical tags, hreflang between markets, a sitemap of markets and trader pages, Open Graph cards per market, nothing per customer.
- **Install as an app:** as the Shop, behind `crypto_install_prompt`.
- **Hosting:** a Vercel project `bitocard-crypto` (Root Directory `apps/crypto`, skip unaffected deployments, `VERCEL_DEEP_CLONE`, `STORE_SERVER_SECRET`, `API_URL`), and a DNS-only CNAME `crypto` on Cloudflare to Vercel.

### Admin

- **Crypto > Markets:** the global market and every country, each with:
  - open on the app (`crypto_app`);
  - global trading for its residents (`crypto_global`);
  - cross-border trading into its local book (`crypto_cross_border`);
  - the P2P fee and the limits per asset and currency;
  - the payout holds (local and cross-border);
  - its payout and top-up methods.

  Ads and trades are filterable by market and by cross-border.
- **Fraud:** the fraud queue: flagged patterns, payouts held for review with why, the declaration and document country on each customer, and freezes from there.
- **Settings > Integrations:** each payout rail's card.
- **Crypto > P2P payouts:** shows the method and currency.

## Stages

0. **Decisions and protection.** Done: the decisions above, and `crypto` reserved. Still to do: legal intake (licensing per market, the cross-border model, the entity). Ask Flutterwave, Paystack and Payoneer the payout questions.
1. **Markets in the API.**
   - The `market` parameter, home, cross-border and global access, the three switches, and the `WW` book.
   - All sale money withdrawable by currency; holdings in other markets' currencies.
   - Per-market limits and holds; the citizenship declaration and the refused document countries; public reads.
   - Tests on PGlite and Docker: races across books, refusals by market, currency and country, cross-border limits, and money never trapped when a switch goes off.
2. **`@bitocard/crypto-ui`.** Extract the market and crypto components; the storefront switches to them with its tests unchanged.
3. **`apps/crypto`, public.** Scaffold, header and market switcher, global and country market pages, trader pages, sign-in and handoff, SEO, install prompt, Vercel project and DNS. Trading opens in the sandbox only.
4. **`apps/crypto`, account.** Wallets by currency, ads, trades, deposit, withdraw, top-up, the declaration. BitoCard's own sites' Crypto links point here.
5. **Payout rails.** The `payout` purpose, `PayoutProvider`, payout accounts by kind, then Flutterwave (customers' transfers moved onto it, then USD), Paystack and Payoneer. Customers' mobile money payouts; USD top-ups. Admin cards and Crypto > Markets.
6. **Hardening.** The fraud controls and queue, the security review, the legal documents, browser checks at phone width.
7. **Pilot.** One country (Nigeria) live, with low limits; then a second (Ghana), with global and cross-border trading between them; then country by country, raising limits as operations prove trustworthy.

## Open questions for the owner

1. Should the declaration also say "not resident in" the US or UK, and refuse sanctioned countries' documents? (Recommended: yes.)
2. Which country pilots first? (Recommended: Nigeria, then Ghana for the first cross-border trades.)
