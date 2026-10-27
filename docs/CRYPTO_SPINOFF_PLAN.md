# Crypto spin-off: plan

Decided by the owner on 27 October 2026. This plan replaces `docs/BITOCARD_CRYPTO_APP_PLAN.md` (crypto.bitocard.com), whose stages 5 to 7 are cancelled. The brand is **Afrippa**, at **afrippa.com** (chosen by the owner on 27 October 2026; the name stands on its own, its origin is not spelled out in copy). On 27 October 2026 afrippa.com was unregistered (no match in Verisign's WHOIS and RDAP), as were afrippa.net, afrippa.africa and afrippa.io: register it, and the defensive names wanted, before announcing the brand.

## The decision

1. **Crypto leaves BitoCard.** It is no longer a bitocard.com subdomain, no longer part of the BitoCard product, and no longer reachable by BitoCard's customers (bitocard.com, its country stores, resellers' stores), by resellers (SHQ, the reseller API) or through the API docs.
2. **It becomes its own product** on its own site and domain: a full peer-to-peer crypto market.
3. **People pay people.** Fiat never touches the platform: no payment gateways (no Paystack, Flutterwave, Stripe, pawaPay), no fiat wallets, no top-ups, no cash-out. The buyer pays the seller directly (bank transfer, mobile money and the like) and the platform only holds crypto.
4. **The platform holds only crypto wallets and escrow.** Customers' custodial wallets (deposits and withdrawals on chain) and an escrow that holds the seller's coins during each order.
5. **The database and the API stay**: the same NestJS API and Postgres database serve Afrippa, but crypto is closed to everything BitoCard (resellers, store customers, the public OpenAPI document and the docs).

## The owner's answers (27 October 2026)

1. **Spin and win stays in BitoCard and moves to fiat:** wins are US dollars (no coins), and the customer moves them into their own country's wallet (at BitoCard's rate) or their US dollar wallet. See step 1.
2. **Afrippa's admin is 100% separate:** its own admin app on **admin.afrippa.com**, its own admins and sign-in. BitoCard's admin app never shows Afrippa, and Afrippa's never shows BitoCard. This replaces the earlier idea of one central admin with a brand switcher.
3. **verify.afrippa.com:** Afrippa's identity checks are BitoCard Verify recreated for Afrippa (the same capture, liveness, documents and human review), under Afrippa's name and domain, reviewed in Afrippa's admin only.
4. **Markets as today:** the global market for everyone, plus a market per African country. Addresses: see Market addresses below (recommended `afrippa.com/ng`).
5. **All nine coins,** each switched on by admins (per coin and per market; off until switched on).
6. **Both sides pay a fee, the seller more,** at rates admins set per coin and market.
7. **BitoCard keeps no crypto at all: no signing keys, no signer, no custody.** Everything crypto that was built (the signer `apps/signer` and its Turnkey wallet, the account xpubs, the chain providers, sanctions screening, the custody check, the coin wallets and their ledger accounts, `apps/crypto` and `@bitocard/crypto-ui`) is rebranded to serve Afrippa and belongs to it alone.

**Afrippa's addresses:** `afrippa.com` (the site and its markets), `admin.afrippa.com` (its admin), `verify.afrippa.com` (identity checks), `api.afrippa.com` (its door to the API).

## Market addresses (advice)

**Recommended: paths, `afrippa.com/ng`, `afrippa.com/gh`, `afrippa.com/ke`, with the global market at `afrippa.com`** (as BitoCard Crypto was built), for these reasons:

- **Search engines treat subdomains as separate sites:** every link to one country's page builds the reputation of `afrippa.com` as a whole under paths, while `ng.afrippa.com` would start from nothing in each country. A young brand needs that reputation in one place.
- **One sign-in:** with paths, one host-only session cookie works on every market. Subdomains need a cookie shared across `*.afrippa.com`, which every subdomain (including `admin.` and `verify.`) would then receive, or a handoff between them.
- **One app, one certificate, one address per page:** no DNS record or certificate per country, and hreflang and canonical tags stay simple.
- **Still easy to say:** `ng.afrippa.com` can be kept as a short marketing address that sends people to `afrippa.com/ng` for good (a permanent redirect), so adverts and posters get the short form without splitting the site.

Choose subdomains only if a country's market must one day run as a separate legal business or on its own servers.

## What changes in the model

| | Today (built, never live) | Afrippa |
|---|---|---|
| Accounts | bitocard.com and store accounts, sign-in handoff | Afrippa's own accounts, signed up on afrippa.com |
| Fiat | Store wallets and P2P money in BitoCard's ledger, top-ups, bank cash-out | None on the platform: the buyer pays the seller directly |
| A trade | Instant: coins and fiat move in one ledger entry | An **order**: coins to escrow, buyer pays off-platform, seller confirms, escrow releases |
| Buy ads | Lock the buyer's fiat | Lock nothing (the seller's coins go to escrow when an order opens) |
| Payment details | None (wallet to wallet) | Each trader's own payment methods, shown to the counterparty only during an order |
| Disputes | Not needed (atomic) | Appeals with evidence, decided by operations |
| Fees | In crypto, plus fiat flows | In crypto only: the buyer and the seller each pay one, the seller's higher |
| Instant exchange (desks, reserves) | Built | Not carried over (a dealer activity, not P2P) |
| Resellers | Doors into the markets, desks, on-chain coins | None |

## What is reused

Built and tested, kept for Afrippa:

- **Custody:** customer coin wallets (`crypto_wallet`, `crypto_locked`, `crypto_frozen`, `crypto_custody`, `crypto_fees`), deposit addresses from xpubs, the chain providers and routing, deposit scanning and crediting, withdrawals with saved addresses, the emailed code, review and sanctions screening, the signer (Turnkey), the custody check.
- **Market rules:** coins and networks, the allow-list of countries (account and document), the US/UK declaration, per-market limits, nicknames, the ad book, freezes and the account freeze.
- **The site:** `apps/crypto` (market and trader pages, small cached server components, SEO, install prompt) and `@bitocard/crypto-ui` (market views, coin badges, the switcher, the trading forms and the money views), rebranded.
- **Infrastructure:** sessions, codes and passwords (the customer account code), notifications and push, the audit log.

## Instruments lifted from BitoCard (the owner, 27 October 2026)

Every instrument BitoCard has built is lifted to serve Afrippa too. **Lifted, not copied:** one codebase, each instrument made **brand-aware** (its records carry the brand; its settings, knowledge, senders and queues are per brand; each brand's admin app shows only its own), so a fix or feature lands in both.

| Instrument (BitoCard) | In Afrippa |
|---|---|
| **Buyer and seller chat** (BitoCard Shop's chats: messages, photos, offers, block, report, unread digests, moderators reading reported chats) | The **order room** (one chat per order: payment details, receipts and evidence as photos and PDFs, system messages at every step) and **chat with a trader before trading** (questions about an ad); block and report |
| **Disputes** (Safe pay disputes with evidence, BitoCard's decision, whose fault, strikes; the `D-` disputes queue) | **Appeals** on orders: evidence from both sides, deadlines to respond, operations decide release to buyer or return to seller with whose fault, strikes on the side at fault, audited |
| **Standing and guards** (Safe pay's new-seller limits, strikes, lost disputes, the same-person check) | **Trader standing:** limits for new traders, strikes from lost appeals and cancellations, suspension at a limit, the same-person check between buyer and seller |
| **Deadline reminders** (Safe pay's accept, pay, hand-over and confirm reminders) | Order timers: pay before the window ends, release once paid, respond to an appeal |
| **Support tickets and live chat** (tickets `T-`, live chat with signed-out visitors, files, staff notes, turning a chat into a ticket, engineering escalations to GitHub) | Afrippa's own help desk on afrippa.com: tickets, live chat, files, staff notes, escalations, in its own queue in Afrippa's admin |
| **AI assistants** (support assistants with knowledge, tools, hand-over and redaction; BitoCard Shop's Anjio with tools, per-country knowledge, cards, ratings, reports, evals, monthly budget) | Afrippa's **assistant**: answers about markets, ads, fees, limits, the steps of an order and safety; tools that search ads, explain an order's state and fees and show the safety checks, never acting on money; hands over to a person; knowledge generated per country from live settings |
| **Moderation and reports** (the Shop's queue, reports, refused words) | Ad terms and nicknames checked against refused words (no phone numbers, links or off-platform contact), reports on traders and ads, the moderation queue |
| **Terms accepted by version** (BitoCard Shop terms) | Afrippa's terms and P2P rules accepted by version before trading |
| **Identity** (BitoCard Verify: KYC with human review, liveness, documents sealed in private storage) | **verify.afrippa.com**: the Verify app deployed for Afrippa (its name, colours and domain), cases reviewed in Afrippa's admin only, documents in Afrippa's own private storage; names matched against payment methods |
| **Sign-in security** (two-step sign-in with an app, email or SMS, recovery codes; phone confirmation by SMS) | Two-step for every trader, phone confirmation, new-device and new-payment-method alerts |
| **Notifications** (inbox, browser push, emails from the brand's own domain) | Every order step, deposit, withdrawal and appeal, from afrippa.com |
| **Install as an app** (offline worker, install prompt) | Afrippa's app on phones |
| **Files** (private sealed storage, public media) | Receipts and evidence sealed privately; brand images public |
| **Reports** (P&L, statements, growth) | Afrippa's fee revenue, custody and volume, on its own |

## What is retired

- **Instant trades settled from fiat wallets** (`p2p_trade` entries moving fiat), the fiat lock of buy ads (`p2p_fiat_locked`), P2P money (`customer_withdrawable` from P2P), the cross-border cash-out hold.
- **Instant exchange:** desks, reserves, markups, reseller exchange (`src/crypto/exchange`).
- **Resellers' crypto:** on-chain coins (Premium), desks, the share of the P2P fee (stage 5b), the `crypto_desk` store template, the `crypto_quote` and `p2p_market` sections, `crypto_trade_abroad`, reseller-level `crypto_global`.
- **Stage 5, payout rails:** cancelled. Nothing is paid out in fiat.
- **Spin and win** pays its rewards in crypto (BNB, USDT, USDC) inside BitoCard: it is either ended or changed to pay store credit (an owner decision; see Questions).

Retired code is switched off and closed first (step 1), then removed once Afrippa's engine replaces it (step 3); no table is dropped until the data is confirmed empty or archived.

## Careful: what BitoCard keeps

- **Bank payouts of customer money** (`CustomerPayoutsService`, `customer_bank_accounts`, `customer_payouts`, `customer_withdrawable`) also pay **BitoCard Shop's Safe pay** sellers (and resale suppliers). They stay in BitoCard. Today the cash-out page is the Crypto tab's (`/account/crypto/cash-out`): it moves to the Shop tab (or the Wallet tab) before the Crypto tab goes.
- **The top-up forms and status** moved into `@bitocard/crypto-ui` (`top-up-*`) this week are used by the storefront's Wallet tab: they move back to the storefront (or `@bitocard/ui`) before the package goes to Afrippa.
- `CryptoPricesService` (CoinGecko) is used by Spin and win's valuation; it goes with whichever side keeps it.

## Architecture (recommended)

**One API and database, two separate products inside it.**

1. **Its own front door.** Afrippa's site calls the API at `api.afrippa.com` (a second hostname on the same droplet, its own Cloudflare zone and Caddy site). Crypto routes move under their own prefix (`/v1/afrippa/…`) and answer **only** Afrippa's server: a dedicated shared secret (like `STORE_SERVER_SECRET`, its own `AFRIPPA_SERVER_SECRET`) signs every request, and the routes refuse API keys, reseller and admin BitoCard sessions, store customers and any other host. They are left out of the public OpenAPI document and the docs.
2. **Its own accounts.** Afrippa gets its own account space: a dedicated store row owned by a dedicated operator account (the customer code already scopes accounts per store), so an email at bitocard.com and at Afrippa are two unrelated accounts, with no handoff and no shared cookie (`bc_signed_in` never set). Emails come from afrippa.com under Afrippa's name.
3. **Its own books.** Every ledger account and entry belongs to Afrippa's operator account, so BitoCard's reports, P&L and reconciliation never include it, and Afrippa's can be produced alone.
4. **Its own admin, 100% separate** (the owner, 27 October 2026). Afrippa is run from its own admin app on **admin.afrippa.com**, never from admin.bitocard.com:
   - **Its own app:** `apps/afrippa-admin` (its own Vercel project), built from the shared admin components (`@bitocard/admin-ui`: tables, dialogs, chat panel, Verify case view, assistant screens), so the lifted instruments' screens are shared code, not copies.
   - **Its own admins:** a separate admin realm (`afrippa_admin`), so admin accounts, passwords, two-step, step-up, sessions and the audit log are Afrippa's alone; sign-in limited to Afrippa's own email domain (`@afrippa.com`), set up and reset only from its sign-in page for its own setup list (`AFRIPPA_ADMIN_SETUP_EMAILS`), as BitoCard's admins are. Its session cookie is host-only on admin.afrippa.com, and the API accepts it only from there.
   - **Its own API surface:** admin routes under `/v1/afrippa/admin/…`, which refuse BitoCard admin sessions; BitoCard's `/v1/admin/…` refuse Afrippa's. No admin of one can read the other's data.
   - **Its own sections:** overview, markets, coins and networks (switched on per market), ads, orders and appeals, traders (members: profile, identity check, limits, freezes, standing, sessions, suspension), deposits and withdrawals, custody and the signer, fees, limits, help desk and live chat, the assistant, moderation and reports, notifications, settings and integrations, admins and their roles, the audit log.
   - **Its own settings:** feature switches, legal documents and markets, so an Afrippa change never touches BitoCard.
   - **It owns all its integrations** (the owner, 27 October 2026): Afrippa's admin has its own Settings > Integrations, with **its own account and credentials for every service Afrippa uses**, set, tested and changed only there (super admins of Afrippa, with their authenticator code, audited in Afrippa's log), never visible to BitoCard's admins and never shared with BitoCard's values:
     - **crypto** (moved from BitoCard, which keeps none): wallet keys, chain providers and their routing, the signer, Chainalysis and TRM screening, CoinGecko and the Coinbase check;
     - **email** (Resend, MailerSend) sending from afrippa.com; **SMS** (Termii, Africa's Talking) under Afrippa's sender name;
     - **identity:** Verify's private storage (`KYC_SPACES_*`) and its links on verify.afrippa.com;
     - **AI** (Anthropic, OpenAI) for its assistant, with its own prices and monthly budget;
     - **files** (public media storage), **browser push** (its own VAPID keys), **engineering escalations** (its own GitHub repository and webhook secret), **DNS** (its own Cloudflare zone and token).
   - **How:** integration settings gain a brand (`integration_settings.brand`; BitoCard's existing values are `bitocard` by migration, the crypto ones moved to `afrippa`), the integration groups declare which brands use them (crypto groups Afrippa only; payments, suppliers, domains and store addresses BitoCard only), and every service reads the settings of the brand it is working for (`IntegrationsService.config(brand)`), so an Afrippa email, SMS or AI call can never use BitoCard's keys, nor the reverse.
   - **Brands in the data:** a `brands` table (BitoCard, Afrippa) still tags every brand-owned record, so the shared instruments keep each brand's data apart and either admin reads only its own.
5. **Ready to leave.** **The signer and the keys are Afrippa's** (answer 7): the signer serves only Afrippa's API surface, its xpubs and Turnkey wallet are Afrippa's, and BitoCard has no crypto keys or signing of its own, so custody is Afrippa's from day one. Nothing in Afrippa reads BitoCard tables except the shared infrastructure above, so it can later move to its own database and service (needed if a separate company or a licence requires it) as a deployment change, not a rewrite.

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
- **Coins:** all nine (USDT, USDC, BTC, ETH, BNB, POL, TRX, LTC, DOGE), each switched on by admins per market (and per network for deposits and withdrawals, as today); off until switched on.
- **Fees:** in crypto only, **both sides pay**, the **seller more**: a seller rate and a buyer rate per coin and market, set by admins (the admin screen warns if a seller rate is set below the buyer's). The seller's fee is held in escrow with the order (escrow = amount + seller fee) and taken on release; the buyer's is taken from the coins they receive. Both are shown before an order opens and on its receipt; a cancelled or returned order charges neither.

## Steps

### 0. Owner inputs
1. ~~The brand~~ **Afrippa.** Register afrippa.com (and any defensive names), then its Cloudflare zone with `admin`, `verify` and `api` records.
2. **The operating entity:** a separate company is recommended (it is the data controller and, where needed, the licensed virtual asset service provider), not Golojan's BitoCard entities.
3. **Licensing:** custodial wallets and an escrowed P2P market are virtual asset services in Nigeria (SEC), Ghana and Kenya (VASP Act 2025); take advice per market before going live.
4. ~~Identity checks~~ **verify.afrippa.com** (decided).
5. ~~Markets, coins and fees~~ **decided** (see The owner's answers); the starting fee rates and limits per market are set in Afrippa's admin before the pilot.
6. ~~Spin and win~~ **fiat** (decided).

### 1. Unhook crypto from BitoCard (now, before anything else)
1. Every crypto switch hard off for BitoCard's stores and resellers, then removed from BitoCard's switch list and admin screens: `crypto_wallets`, `p2p_trading`, `crypto_exchange`, `reseller_exchange`, `reseller_desks`, `crypto_app`, `crypto_global`, `crypto_cross_border`, `crypto_trade_abroad`, `crypto_install_prompt`, `store_template_crypto_desk`.
2. The API refuses every crypto route for store customers, resellers, API keys and docs tokens (`/v1/store/crypto*`, `/v1/store/p2p*`, `/v1/store/exchange*`, `/v1/crypto*`, `/v1/exchange*`), and the Crypto tag, its schemas and examples leave the OpenAPI document and the docs.
3. **Storefront:** the Crypto tab, the header's Crypto link and drawer tile, the Wallet tab's Crypto wallet and crypto activity, Quick buy or sell, the exchange page, the hand-over to crypto.bitocard.com, and the store sections (`crypto_quote`, `p2p_market`) go. The cash-out page moves to the Shop tab for Safe pay sellers first.
4. **SHQ:** the Exchange section (trade with BitoCard, coins, desk, trades) goes; the plan features `onchain_crypto` and `reseller_desks` are removed (a migration takes them off every plan); the `crypto_desk` template goes (no store uses it live).
5. **Spin and win moves to fiat** (it stays in BitoCard):
   - Each win is **US cents** (the same US$1 over 50 to 100 spins, the same schedule and daily limits); no coin is won, priced or held, and CoinGecko is no longer needed for it.
   - Wins build up as a **US dollar reward balance** (spend-only, never withdrawn, as rewards are today), and **Move to my wallet** puts them into the customer's own country's wallet at BitoCard's `receive` rate (rounded down, the amount shown first) or into their US dollar wallet as they are, in one ledger entry from `promotions`.
   - The wheel shows dollar values (no coin chips); the rewards panel shows the dollar balance; admin Crypto > Spin rewards moves under Storefront (or Promotions).
   - Spin's crypto ledger accounts (`crypto_promotions`, `crypto_spin_rewards`) are retired: only sandbox balances exist; any left are converted to the dollar balance at the price kept on each spin.
   - The `spin_rewards` switch no longer needs crypto to be on (`CryptoWalletsService.require` comes off it); the terms of use's Spin and win section is rewritten for dollars.
6. **Legal documents:** the crypto, P2P and spin sections leave BitoCard's terms of use, reseller terms and privacy notice (`legalUpdated` bumped); Afrippa gets its own documents on afrippa.com.
7. **Data:** confirm there are no live crypto balances, ads or withdrawals (crypto was never switched on live). If any exist, the holders are told and can withdraw on chain for a set period; sandbox data is archived.
8. **Crypto settings leave BitoCard's admin:** Settings > Integrations > Blockchain (wallet keys `CRYPTO_XPUB_*`/`CRYPTO_TEST_XPUB_*`, the chain providers, the Crypto signer, Chainalysis and TRM screening) and CoinGecko prices go from BitoCard's integrations; their saved values are carried over to Afrippa's settings (step 2), never deleted. BitoCard keeps its own email, SMS, AI, storage, push and GitHub settings for itself; Afrippa gets its own (Architecture 4). BitoCard's admin loses its Crypto section (customers' coins, freezes, deposits, withdrawals, chains, assets, custody check, P2P, exchange); the jobs `crypto`, `chain-health` and `crypto-reconcile` run for Afrippa only.
9. `crypto.bitocard.com` is never created: drop the plan's Vercel and DNS steps and remove `crypto` from the handoff targets and `isHouseOrigin`.
10. Docs: `AGENTS.md`, `PLANS.md` and this plan updated; the old plan marked superseded.

### 2. Afrippa's own surface in the API
1. Brands in the API: the `brands` table, BitoCard's data tagged `bitocard` by migration; the **Afrippa admin realm** (`afrippa_admin`: accounts, two-step, step-up, sessions on admin.afrippa.com, its own setup list and email domain, its own audit log) and its routes under `/v1/afrippa/admin/…`, each realm refusing the other.
2. **The instruments made brand-aware** (see Instruments lifted): chats, disputes, standing, reminders, tickets and live chat, AI assistants and their knowledge, moderation and refused words, terms by version, identity checks, two-step, notifications and email senders, files and reports carry the brand, each brand's settings and queues apart, and each admin realm reading only its own brand.
3. The operator account and Afrippa's store row, tied to its brand; `AFRIPPA_URL` and `AFRIPPA_SERVER_SECRET`.
4. The crypto routes under their own prefix, signed by Afrippa's server only, left out of OpenAPI.
5. Afrippa's accounts: sign-up, sign-in, email confirmation, password reset, two-step sign-in (recommended for every trader), sessions, emails from afrippa.com.
6. **verify.afrippa.com:** the Verify API serves Afrippa's cases under its brand (links on verify.afrippa.com, documents in Afrippa's own private storage, reviewed only through Afrippa's admin realm).
7. Ledger accounts and reports under the operator account; the coin wallets, custody, fees, deposits, withdrawals, addresses and chain records all Afrippa's.
8. **Integrations per brand:** `integration_settings.brand`, groups declaring their brands, services reading their brand's settings; the crypto settings moved to Afrippa (carried over, never deleted), and Afrippa's own email, SMS, identity storage, AI, files, push, GitHub and Cloudflare settings added, all in Afrippa's admin only. Tests: no Afrippa call reads a BitoCard credential, and no BitoCard call an Afrippa one.
9. Tests on PGlite and Docker: no BitoCard caller can reach any Afrippa route, and no Afrippa caller any BitoCard route.

### 3. The escrow engine
1. Payment methods (saved, encrypted, name-checked).
2. Ads with payment methods and windows; buy ads lock nothing.
3. Orders: open with escrow, mark paid, release, cancel, expire (a job), appeal and decide; every step once, under row locks, tested with parallel requests.
4. Fees in crypto.
5. The order room on the lifted chat, appeals on the lifted disputes, trader standing and the deadline reminders.
6. Trust figures, feedback, blocks and reports (on the lifted moderation).
7. The fraud controls above.
8. Retire the fiat code paths (instant fiat trades, buy-ad fiat locks, P2P money, exchange desks and reserves), then drop their tables once empty or archived.

### 4. The Afrippa site
1. Rename `apps/crypto` and `@bitocard/crypto-ui` to the brand; its own Vercel project, domain, brand assets, manifest and icons.
2. Pages: markets and ads (as built), sign-up and sign-in, the order room, wallets with deposit and withdraw (as built), payment methods, profile and trader page, appeals, notifications, help (tickets and live chat) and the assistant.
3. SEO from day one (as built: market and trader pages indexed).
4. **Market addresses:** the global market at `afrippa.com`, each country at `afrippa.com/ng` (as built), and `ng.afrippa.com`-style short addresses redirecting there for good (see Market addresses).
5. **verify.afrippa.com:** the Verify app (`apps/verify`) made brand-configurable (name, colours, logo, domain, the review console's sign-in) and deployed a second time as its own Vercel project for Afrippa.
6. **admin.afrippa.com:** `apps/afrippa-admin`, its own Vercel project, on the shared admin components, with the sections in Architecture 4.
7. **The signer rebranded:** `apps/signer` becomes Afrippa's (`@afrippa/signer`, its Vercel project and team renamed or moved to Afrippa, its address on afrippa.com), `docs/crypto-signer.md` rewritten as Afrippa's protocol, its Turnkey organisation and wallet named for Afrippa; the API asks it only for Afrippa. Its secrets are rotated in the move.

### 5. Hardening
1. A security review of escrow, release and appeals.
2. The legal documents on afrippa.com (terms, privacy, P2P rules, fees, risk warnings), reviewed by lawyers per market.
3. Browser checks at phone width; the operations runbook for appeals.

### 6. Pilot
Nigeria, Ghana and Kenya with low limits and the coins admins switch on for them, plus the global market for their residents; then more coins and countries as operations prove trustworthy.

### 7. Later
Move Afrippa to its own database and service when the entity or a licence requires it.

## Questions for the owner

1. Will Afrippa be operated by a separate company? (Recommended: it is the data controller and the licensed operator where one is needed.)
2. The starting fee rates (buyer and seller) and limits for the pilot markets, to set in Afrippa's admin.
