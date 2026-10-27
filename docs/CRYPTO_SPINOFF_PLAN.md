# Crypto spin-off: plan

Decided by the owner on 27 October 2026. This plan replaces `docs/BITOCARD_CRYPTO_APP_PLAN.md` (crypto.bitocard.com), whose stages 5 to 7 are cancelled. The brand and domain are to come: below they are **<Brand>** and **<domain>**.

## The decision

1. **Crypto leaves BitoCard.** It is no longer a bitocard.com subdomain, no longer part of the BitoCard product, and no longer reachable by BitoCard's customers (bitocard.com, its country stores, resellers' stores), by resellers (SHQ, the reseller API) or through the API docs.
2. **It becomes its own product** on its own site and domain: a full peer-to-peer crypto market.
3. **People pay people.** Fiat never touches the platform: no payment gateways (no Paystack, Flutterwave, Stripe, pawaPay), no fiat wallets, no top-ups, no cash-out. The buyer pays the seller directly (bank transfer, mobile money and the like) and the platform only holds crypto.
4. **The platform holds only crypto wallets and escrow.** Customers' custodial wallets (deposits and withdrawals on chain) and an escrow that holds the seller's coins during each order.
5. **The database and the API stay**: the same NestJS API and Postgres database serve <Brand>, but crypto is closed to everything BitoCard (resellers, store customers, the public OpenAPI document and the docs).

## What changes in the model

| | Today (built, never live) | <Brand> |
|---|---|---|
| Accounts | bitocard.com and store accounts, sign-in handoff | <Brand>'s own accounts, signed up on <domain> |
| Fiat | Store wallets and P2P money in BitoCard's ledger, top-ups, bank cash-out | None on the platform: the buyer pays the seller directly |
| A trade | Instant: coins and fiat move in one ledger entry | An **order**: coins to escrow, buyer pays off-platform, seller confirms, escrow releases |
| Buy ads | Lock the buyer's fiat | Lock nothing (the seller's coins go to escrow when an order opens) |
| Payment details | None (wallet to wallet) | Each trader's own payment methods, shown to the counterparty only during an order |
| Disputes | Not needed (atomic) | Appeals with evidence, decided by operations |
| Fees | In crypto, plus fiat flows | In crypto only |
| Instant exchange (desks, reserves) | Built | Not carried over (a dealer activity, not P2P) |
| Resellers | Doors into the markets, desks, on-chain coins | None |

## What is reused

Built and tested, kept for <Brand>:

- **Custody:** customer coin wallets (`crypto_wallet`, `crypto_locked`, `crypto_frozen`, `crypto_custody`, `crypto_fees`), deposit addresses from xpubs, the chain providers and routing, deposit scanning and crediting, withdrawals with saved addresses, the emailed code, review and sanctions screening, the signer (Turnkey), the custody check.
- **Market rules:** coins and networks, the allow-list of countries (account and document), the US/UK declaration, per-market limits, nicknames, the ad book, freezes and the account freeze.
- **The site:** `apps/crypto` (market and trader pages, small cached server components, SEO, install prompt) and `@bitocard/crypto-ui` (market views, coin badges, the switcher, the trading forms and the money views), rebranded.
- **Infrastructure:** sessions, codes and passwords (the customer account code), chat with file attachments (for the order room), notifications and push, the audit log.

## What is retired

- **Instant trades settled from fiat wallets** (`p2p_trade` entries moving fiat), the fiat lock of buy ads (`p2p_fiat_locked`), P2P money (`customer_withdrawable` from P2P), the cross-border cash-out hold.
- **Instant exchange:** desks, reserves, markups, reseller exchange (`src/crypto/exchange`).
- **Resellers' crypto:** on-chain coins (Premium), desks, the share of the P2P fee (stage 5b), the `crypto_desk` store template, the `crypto_quote` and `p2p_market` sections, `crypto_trade_abroad`, reseller-level `crypto_global`.
- **Stage 5, payout rails:** cancelled. Nothing is paid out in fiat.
- **Spin and win** pays its rewards in crypto (BNB, USDT, USDC) inside BitoCard: it is either ended or changed to pay store credit (an owner decision; see Questions).

Retired code is switched off and closed first (step 1), then removed once <Brand>'s engine replaces it (step 3); no table is dropped until the data is confirmed empty or archived.

## Careful: what BitoCard keeps

- **Bank payouts of customer money** (`CustomerPayoutsService`, `customer_bank_accounts`, `customer_payouts`, `customer_withdrawable`) also pay **BitoCard Shop's Safe pay** sellers (and resale suppliers). They stay in BitoCard. Today the cash-out page is the Crypto tab's (`/account/crypto/cash-out`): it moves to the Shop tab (or the Wallet tab) before the Crypto tab goes.
- **The top-up forms and status** moved into `@bitocard/crypto-ui` (`top-up-*`) this week are used by the storefront's Wallet tab: they move back to the storefront (or `@bitocard/ui`) before the package goes to <Brand>.
- `CryptoPricesService` (CoinGecko) is used by Spin and win's valuation; it goes with whichever side keeps it.

## Architecture (recommended)

**One API and database, two separate products inside it.**

1. **Its own front door.** <Brand>'s site calls the API at `api.<domain>` (a second hostname on the same droplet, its own Cloudflare zone and Caddy site). Crypto routes move under their own prefix (`/v1/x/…`, named once the brand is chosen) and answer **only** <Brand>'s server: a dedicated shared secret (like `STORE_SERVER_SECRET`, its own `<BRAND>_SERVER_SECRET`) signs every request, and the routes refuse API keys, reseller and admin BitoCard sessions, store customers and any other host. They are left out of the public OpenAPI document and the docs.
2. **Its own accounts.** <Brand> gets its own account space: a dedicated store row owned by a dedicated operator account (the customer code already scopes accounts per store), so an email at bitocard.com and at <Brand> are two unrelated accounts, with no handoff and no shared cookie (`bc_signed_in` never set). Emails come from <domain> under <Brand>'s name.
3. **Its own books.** Every ledger account and entry belongs to <Brand>'s operator account, so BitoCard's reports, P&L and reconciliation never include it, and <Brand>'s can be produced alone.
4. **One central admin platform for every brand** (the owner, 27 October 2026). The admin app stays the single place where Golojan's team runs everything, like multi-domain management: BitoCard and <Brand> (and any later brand) are **brands** in it, each with its own domains, settings, members, books and queues. Nothing about <Brand> is run from a separate console.
   - **Brands as a first-class idea:** a `brands` table (BitoCard, <Brand>; name, domains, logo, sending address, support email, legal entity), and every brand-owned record (the operator account, its store row, accounts, ledger accounts, settings, notifications) tied to one. BitoCard's existing data is brand `bitocard` by migration.
   - **A brand switcher** in the admin shell's top bar, kept in the address (`?brand=`): each brand shows only its own sections (BitoCard: stores, resellers, catalogue, orders, Shop; <Brand>: markets, ads, orders and appeals, traders, custody, limits, fees), and a brand-wide overview shows each brand side by side.
   - **Membership managed centrally:** admins are one team with one sign-in, two-step and step-up, but their roles are **per brand** (`admin_brand_roles`: an admin may be operations on <Brand> and support on BitoCard, or nothing on one of them). Super admins add and remove admins, give and take brand roles, and every change is audited. The API checks the brand role on every admin route (`@AdminRoles(...)` gains the brand), so a BitoCard-only admin can never see a <Brand> trader, and the reverse.
   - **<Brand>'s members** (its traders) are managed there too: search, profile, identity check, limits, freezes, appeals, sessions and devices, sign-out everywhere, suspension, all audited per brand.
   - **Settings per brand:** feature switches, integrations (each brand its own email sender, identity provider, chain providers and signer), legal documents and markets, so a <Brand> change never touches BitoCard.
   - **Where it lives:** admin.bitocard.com for now. If <Brand> must not be seen as part of BitoCard (a separate company), the same admin app can be served on a neutral operator address (for example `admin.golojan.<tld>`) with both brands inside it; its cookies, origins and two-step stay as today.
5. **Ready to leave.** Nothing in <Brand> reads BitoCard tables except the shared infrastructure above, so it can later move to its own database and service (needed if a separate company or a licence requires it) as a deployment change, not a rewrite.

## The escrow P2P engine (new)

- **Payment methods:** each trader saves theirs (bank account, mobile money wallet, and named methods such as Wise, Payoneer or PayPal as labels only, never integrations), in their own verified name, per currency. Encrypted at rest, shown to the counterparty only inside an open order.
- **Ads:** side, coin, currency, price (fixed, later floating against a reference price), amount, limits per order, the payment methods accepted, a payment window (15, 30 or 60 minutes) and terms. A sell ad locks its coins (`crypto_locked`) as today; a buy ad locks nothing.
- **Orders** (`p2p_orders`):
  1. **Opened** by the taker: the seller's coins for the order move to escrow (`crypto_escrow`, one ledger account per order owner, never below zero), inside one transaction with the ad's row locked, as trades are today.
  2. **Buyer pays** the seller off-platform within the window, using the payment details shown in the order, then marks it **paid** (optionally with a receipt photo).
  3. **Seller confirms** the money arrived: the escrow **releases** the coins to the buyer, less the fee (to `crypto_fees`). Released coins can never be taken back.
  4. **Cancelled** by the buyer before paying, or automatically when the window runs out unpaid: the coins go back to the ad (or the seller's wallet).
  5. **Appeal** by either side once marked paid (the seller says no money came, or does not release): the order is frozen, both upload evidence in the order's chat, operations decide **release to buyer** or **return to seller**, audited.
- **The order room:** a chat per order with photos and PDFs (the chat attachment code), timers, the payment details, Mark as paid, Release, Cancel and Appeal; notifications at every step.
- **Trust:** completion rate, average release and payment times, trades in 30 days, feedback after each order, verified badges and merchant status; block and report.
- **Fraud controls** (more important now money moves off-platform): the payer's name must match the buyer's verified name, third-party payments are refused (the seller is told to release only for a payment from the buyer's own account), reversible payments are warned about, low limits for new accounts, cool-offs after appeals lost, velocity and device checks, repeated cancellations limited, and every release by the seller only (or by an appeal decision).
- **Fees:** in crypto only, per coin and market (maker, taker or both), shown before an order opens.

## Steps

### 0. Owner inputs
1. The brand, the domain, and its Cloudflare zone.
2. **The operating entity:** a separate company is recommended (it is the data controller and, where needed, the licensed virtual asset service provider), not Golojan's BitoCard entities.
3. **Licensing:** custodial wallets and an escrowed P2P market are virtual asset services in Nigeria (SEC), Ghana and Kenya (VASP Act 2025); take advice per market before going live.
4. **Identity checks:** Didit (independent of BitoCard) or BitoCard Verify white-labelled on <domain>.
5. The first markets, coins and fee rates.
6. **Spin and win:** end it, or pay its rewards as BitoCard store credit.

### 1. Unhook crypto from BitoCard (now, before anything else)
1. Every crypto switch hard off for BitoCard's stores and resellers, then removed from BitoCard's switch list and admin screens: `crypto_wallets`, `p2p_trading`, `crypto_exchange`, `reseller_exchange`, `reseller_desks`, `crypto_app`, `crypto_global`, `crypto_cross_border`, `crypto_trade_abroad`, `crypto_install_prompt`, `store_template_crypto_desk`.
2. The API refuses every crypto route for store customers, resellers, API keys and docs tokens (`/v1/store/crypto*`, `/v1/store/p2p*`, `/v1/store/exchange*`, `/v1/crypto*`, `/v1/exchange*`), and the Crypto tag, its schemas and examples leave the OpenAPI document and the docs.
3. **Storefront:** the Crypto tab, the header's Crypto link and drawer tile, the Wallet tab's Crypto wallet and crypto activity, Quick buy or sell, the exchange page, the hand-over to crypto.bitocard.com, and the store sections (`crypto_quote`, `p2p_market`) go. The cash-out page moves to the Shop tab for Safe pay sellers first.
4. **SHQ:** the Exchange section (trade with BitoCard, coins, desk, trades) goes; the plan features `onchain_crypto` and `reseller_desks` are removed (a migration takes them off every plan); the `crypto_desk` template goes (no store uses it live).
5. **Spin and win:** as decided in step 0.
6. **Legal documents:** the crypto, P2P and spin sections leave BitoCard's terms of use, reseller terms and privacy notice (`legalUpdated` bumped); <Brand> gets its own documents on <domain>.
7. **Data:** confirm there are no live crypto balances, ads or withdrawals (crypto was never switched on live). If any exist, the holders are told and can withdraw on chain for a set period; sandbox data is archived.
8. `crypto.bitocard.com` is never created: drop the plan's Vercel and DNS steps and remove `crypto` from the handoff targets and `isHouseOrigin`.
9. Docs: `AGENTS.md`, `PLANS.md` and this plan updated; the old plan marked superseded.

### 2. <Brand>'s own surface in the API
1. Brands in the API: the `brands` table, BitoCard's data tagged `bitocard` by migration, per-brand admin roles (`admin_brand_roles`) checked on every admin route, super admins managing admins and their brand roles in the admin app, the brand switcher.
2. The operator account and <Brand>'s store row, tied to its brand; `<BRAND>_URL` and `<BRAND>_SERVER_SECRET`.
3. The crypto routes under their own prefix, signed by <Brand>'s server only, left out of OpenAPI.
4. <Brand>'s accounts: sign-up, sign-in, email confirmation, password reset, two-step sign-in (recommended for every trader), sessions, emails from <domain>.
5. The identity check chosen in step 0.
6. Ledger accounts and reports under the operator account.
7. Tests on PGlite and Docker: no BitoCard caller can reach any <Brand> route, and no <Brand> caller any BitoCard route.

### 3. The escrow engine
1. Payment methods (saved, encrypted, name-checked).
2. Ads with payment methods and windows; buy ads lock nothing.
3. Orders: open with escrow, mark paid, release, cancel, expire (a job), appeal and decide; every step once, under row locks, tested with parallel requests.
4. Fees in crypto.
5. Trust figures, feedback, blocks and reports.
6. The fraud controls above.
7. Retire the fiat code paths (instant fiat trades, buy-ad fiat locks, P2P money, exchange desks and reserves), then drop their tables once empty or archived.

### 4. The <Brand> site
1. Rename `apps/crypto` and `@bitocard/crypto-ui` to the brand; its own Vercel project, domain, brand assets, manifest and icons.
2. Pages: markets and ads (as built), sign-up and sign-in, the order room, wallets with deposit and withdraw (as built), payment methods, profile and trader page, appeals, notifications.
3. SEO from day one (as built: market and trader pages indexed).
4. <Brand> in the central admin platform (see Architecture 4): the brand switcher, per-brand admin roles, and <Brand>'s sections: orders and appeals queue, traders (members), ads, deposits and withdrawals, custody, limits, fees, markets.

### 5. Hardening
1. A security review of escrow, release and appeals.
2. The legal documents on <domain> (terms, privacy, P2P rules, fees, risk warnings), reviewed by lawyers per market.
3. Browser checks at phone width; the operations runbook for appeals.

### 6. Pilot
Nigeria, Ghana and Kenya with low limits, stablecoins first, then other coins and markets as operations prove trustworthy.

### 7. Later
Move <Brand> to its own database and service when the entity or a licence requires it.

## Questions for the owner

1. Will <Brand> be operated by a separate company? (Recommended.) If so, should the central admin platform move to a neutral operator address rather than admin.bitocard.com?
2. Didit, or BitoCard Verify under the <Brand> name?
3. Spin and win: end it, or pay its rewards as store credit?
4. Keep a global US dollar market (traders paying through Wise, Payoneer or PayPal between themselves), or country markets only at first?
5. Which coins at launch: stablecoins only (USDT, USDC), or all nine?
6. Fees: seller only, buyer only, or both, and the starting rates.
