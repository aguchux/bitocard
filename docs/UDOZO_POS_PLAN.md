# Udozo POS plan

## Context

The owner's POS brief (Claude Docs, "Udozo POS — Build plan", 19-artboard canvas S1–S19) describes a paid point-of-sale product at pos.udozo.com. It uses udozo.com's listings and stock as its single source of truth, and it serves web, Android, iOS and Windows.

The brief assumes the POS is a **separate system** that talks to udozo.com over OAuth, a listings API, a stock-movements endpoint and signed webhooks, built with pnpm, Fastify, Expo and Tauri. In this repo the POS can live **inside Udozo**:

- the same API (`apps/udozo-api`), database and account;
- signing in through udozo.com's handoff, as connect.udozo.com already does.

That removes the OAuth app, the webhooks, the 15-minute reconcile and the mock Udozo server. Their job (the POS seeing listing, price and stock changes within seconds) is met by reading the same rows. Everything else in the brief stays: screens, the role matrix, receipts and milestones.

## How the brief maps to the repo

| Brief | Here |
|---|---|
| pnpm, Fastify, separate API | npm workspaces; NestJS module `apps/udozo-api/src/pos/` (`@ProductOnly('udozo')`) |
| Web app at pos.udozo.com | New Next.js app **`apps/udozo-pos`** (`@udozo/pos`, port 3014), a Vercel project like `udozo-connect` |
| Owner "Sign in with Udozo" (OAuth) | udozo.com's sign-in handoff, as Connect does (`app/signin/route.ts`, `/handoff`), with its own host-only `udz_pos` cookie |
| UdozoConnection tokens | Not needed. Same account, so no tokens to store or leak |
| Listings API, webhooks, reconcile | Direct reads of `classified_listings` and `classified_categories` |
| `POST /seller/stock-movements` | `PosStockService` writing movements and the listing's `stock` in one transaction (beside `takeStock`) |
| Product / Category mirror tables | None. A POS product **is** a listing; POS-only fields go on the listing or a side table |
| packages/core (kobo, VAT) | `apps/udozo-api/src/pos/money.ts` plus shared types and totals in `@bitocard/api-client/pos`. BigInt minor units, as the ledger uses |
| packages/permissions | `src/pos/permissions.ts` (the matrix as data), mirrored in the client for hiding controls; the API decides |
| Managed queue | `waitUntil` plus a Udozo cron job `pos` in `vercel.json` and `jobOwners` |
| Subscription provider (Paystack/Flutterwave) | Paid from the owner's **Udozo wallet** (`customer_wallet`), topped up by card, bank or mobile money through Udozo's own gateways. See pos.udozo.com: the public site and sign-up |
| WhatsApp receipt bot | The existing WhatsApp channel (`src/whatsapp/`): add a `document` message type and PDF media upload to `cloud-api.ts`, and a `RECEIPT` keyword in the bot |
| PDFs | pdfkit, as `src/reports/statement-pdf.ts` uses, stored in the private bucket (`KycStorage`) behind signed, short-lived links |
| Expo and Tauri apps | Last milestone. Before them, the web app installs as a PWA (`@bitocard/ui/install`) |

## Decisions the codebase already answers (the brief's open questions)

1. **Stack and separation:** inside udozo-api and Udozo's database. No separate service.
2. **Who builds the udozo.com side:** this work. The "Sell at POS" tick goes on Post an ad's Where to sell step.
3. **Wallet payment for the plan:** yes. The wallet ledger exists, and no new gateway is needed.
4. **WhatsApp:** Udozo's number and the Cloud API already exist. One new utility template, `udozo_pos_receipt`, plus the document message type.
5. **Currency:** not only NGN. Each shop uses its owner's country currency (the account's fixed country), and VAT is the shop's own rate in basis points (default 0; 750 offered for Nigeria). The shop, not Udozo, is the seller at its till.

## Defaults I will use unless told otherwise

- **Switches** (Udozo's, off by default):
  - `pos` (global or country) opens sign-up and the product in a market. Where it is off, the public pages still show, and sign-up says POS is coming to that country.
  - POS has **its own three plans** (below): Free, Premium and Multi-shop. They do not follow `paid_plans`, which keeps Seller HQ free.
- **Who owns a POS account:** a udozo.com customer who sells. One account per customer, holding one or more shops.
- **Payments at the till:** see How buyers pay at the till.
- **Offline:** online-first at launch. Every sale still carries a client-made UUID (`client_sale_id`, unique) from the first milestone, so offline replay can come later without changing the API.
- **Native apps:** part of the product (Android, iOS, Windows, called Udozo POS), wrapping the same web app's screens, built once the web app works. Before that, the web app installs from the browser.

## How the owner uses it (the owner's own words, 10 November 2026)

0. **pos.udozo.com is a public page of its own**: a POS marketing site with app download buttons, pricing and **Sign up**. Sign-up takes a monthly fee and connects the shop to the owner's udozo.com account.
1. The shop's owner lists products on udozo.com as today (category, price, quantity in stock) and ticks **Sell at POS** on the ones the shop sells.
2. In the real shop, they open **pos.udozo.com**, sign in with their Udozo account, and get admin rights over the POS.
3. They invite sales staff, managers, accountants and the rest.
4. Staff sign in at the same place, or download **Udozo POS** for Android, iOS or Windows, and start selling.
5. Stock is tracked from udozo.com: the same categories, the same inventory.

## Stock: one inventory, udozo.com's (decided)

The listing's own `stock` is the shop's inventory. There is no second count and no per-shop split. A till sale and an online sale take from the same number, so they can never drift.

- **A till sale** takes its units through the same rules as an online sale. A new `takeStockAtTill` beside `takeStock` in `stock.ts` locks the listing's row and lowers `stock`, then runs `stockChange` (out of stock at 0, the 90 days, the seller told), all in the sale's transaction.
- **Online holds still count.** A till may not sell units held for UdozoPay, buy orders or resale (`heldUnits`). Selling into them is refused with `stock_held`, and the cashier sees how many are free.
- **Offline replay** (milestone 8) may sell below what is free, because the item was physically there. The sale stands, stock goes no lower than 0, and the listing is flagged `oversold` for the owner or a manager.
- **`pos_stock_movements`**: an append-only history of every change made from the POS or by sales (listing, delta, reason `sale`, `return`, `restock`, `count`, `damage`, `online_sale`, plus the reference, the staff member and a client id). It feeds the inventory screen's history (S3) and the reports. udozo.com's own edits to stock are logged there too, as `edited_online`.
- **Restocking and counts** from the POS set the same `stock` (`PATCH` through `ListingsService`, so the rules for live, sold-out and expired ads all apply).
- **Several shops (the Multi-shop plan):** the stock is still the listing's one number, but it is split between the owner's shops:
  - `pos_stock_levels` (listing, shop) holds how many each shop has. The levels always add up to the listing's `stock`; the part not in any shop is the `online` level.
  - Till sales, counts, damage and transfers between shops move a shop's level and the listing's `stock` in one transaction.
  - Online sales (`takeStock`) take from `online` first, then from the shop the owner marks **Fulfils online orders**.
  - On Free and Premium there is one shop, so its level is simply the listing's `stock` and no split is kept.

## Data (one migration per milestone, in `apps/udozo-api/prisma/migrations/`)

- **Listings**: `pos_enabled` (Sell at POS), `barcode` (unique per seller), `reorder_level`. A **shop-only** listing (never on udozo.com) widens the `on_shop`/`resale` check to allow `pos_enabled` as the third channel.
- **Accounts and shops**:
  - `pos_accounts` (customer, plan, trial ends, status);
  - `pos_shops` (account, name, address, phone, TIN, `shop_code` like `ADA-4821`, `vat_bps`, fulfils online, receipt footer);
  - `pos_tills` (shop, name, printer width, auto-print).
- **Stock**: the listing's own `stock`, plus `pos_stock_movements` and an `oversold_at` flag on the listing (above).
- **Staff and devices**:
  - `pos_roles` (account, name, permissions[], discount limit in bps, system or custom);
  - `pos_staff` (account, first and last name, phone, email, role, `pin_hash` (Argon2), status, failed tries, locked until);
  - `pos_staff_access` (staff, shop, tills, mobile allowed);
  - `pos_invites` (token hash, channel `whatsapp` or `sms`, expires in 48 hours);
  - `pos_devices` (shop, till, platform, link code hash, last seen, revoked);
  - `pos_sessions` (staff or owner, device, expires, ended by shift).
- **Sales**:
  - `pos_sales` (shop, till, staff, `POS-000123` numbered per shop, client sale id, subtotal, discount, VAT, total, currency, status `completed`, `voided` or `refunded`, client created at);
  - `pos_sale_lines` (listing, quantity, unit price and discount copied at sale);
  - `pos_payments` (method `cash`, `transfer`, `card`, `wallet` or `other`, amount, cash handed and change, reference, the buyer's customer for `wallet`);
  - `pos_wallet_requests` (sale, amount, code hash, buyer, status `waiting`, `paid`, `declined` or `expired`, expires in 5 minutes);
  - `pos_shops` also keeps the shop's bank details for transfers (shown, never used to move money);
  - `pos_customers` (optional, the shop's own).
- **Receipts and shifts**:
  - `pos_receipts` (sale, kind `receipt` or `invoice`, storage key, QR token hash expiring in 10 minutes, delivered via and to);
  - `pos_shifts` (till, staff, opened and closed, expected and counted cash).
- **Audit**: through the existing `AuditService` (`pos.*` actions), not a new table.

## Sign-in and sessions (security first)

- **Owner:** the udozo.com handoff gives `udz_pos` an owner session (`pos_sessions` kind `owner`, from the customer's account). A new device needs a code texted or sent on WhatsApp to the owner's confirmed mobile (`SmsService.sendCode`).
- **Staff:** shop code, phone and 4-digit PIN on the web, or name tile and PIN on a linked till. Five wrong tries lock for 15 minutes, claimed atomically as sign-in codes are. Sessions end with the shift or after 12 hours idle.
- **The hard rule:** a staff session **never** reaches a customer route. `PosGuard` is its own guard and header (`Udozo-Pos-Session`), and `CustomerGuard` never accepts a POS session. A separation test, like `afrippa-separation.test.mjs`, tries every POS staff caller on every customer, wallet, payout and Connect route.
- **Devices:** a link code or QR (S19) gives a device token scoped to one shop. Unlinking ends its sessions at once.
- **Manager approval:** "With approval" actions take a manager's PIN on the same till, recorded in the audit log.

## pos.udozo.com: the public site and sign-up (decided)

pos.udozo.com's home is **public and indexed**. It is Udozo POS's own marketing site, with its own header and footer and none of udozo.com's marketplace navigation. The POS itself sits behind sign-in.

- **Pages:**
  - `/`:
    - the hero: what it is, with an illustration of the register labelled as one;
    - how it works: list on udozo.com, tick Sell at POS, sell in the shop, and stock follows itself;
    - features: register and barcode, one inventory with udozo.com, staff and roles, receipts by print, WhatsApp and email, reports, offline later;
    - the apps band, pricing, questions and a closing call;
  - `/pricing`: Free, Premium and Multi-shop side by side (monthly, and yearly if admins set it), what each includes, the trial, and that paid plans are paid from the Udozo wallet;
  - `/download`: Android, iOS and Windows, plus Use it in your browser;
  - `/signup` and `/signin`;
  - legal pages: POS terms and privacy link to udozo.com's `/legal/pos` and `/legal/privacy`.
- **App buttons** (Google Play, App Store, Microsoft Store or the Windows installer):
  - each points at its store once that app is live, with the links set in admin (`pos_app_links`);
  - until then the button says **Coming soon** and is not a link, so the site never claims an app that does not exist;
  - Use in browser always works, and offers to install the web app (`@bitocard/ui/install`).
- **Sign-up** (`/signup`, the owner only):
  1. **Connect your Udozo account:** sign in, or create an account on udozo.com, through the handoff (`/signin?next=/signup`), returning signed in. An account without a confirmed email or country finishes udozo.com's onboarding first.
  2. **Your shop:** shop name, address, phone and TIN. The shop is in the account's own country (fixed, with its currency), and `pos` must be on there.
  3. **Choose a plan:** Free, Premium or Multi-shop, with the price in the account's currency and what each includes. Free goes straight to step 5.
  4. **Pay:**
     - the first month comes from the Udozo wallet, shown with the balance;
     - if the balance is short, **Add funds** opens udozo.com's own wallet top-up (card, bank or mobile money, `POST /v1/store/wallet/top-ups`) and returns here;
     - with a trial, nothing is charged until it ends, but the wallet is checked and the date is shown.
  5. **Done:** into first-run setup: tills, then the import of the listings ticked Sell at POS (S18). If none are ticked, setup links to udozo.com's My listings to tick some.
- **Sign-in** (`/signin`) has two doors on one page:
  - **Shop owner:** Continue with Udozo (the handoff);
  - **Staff:** shop code, phone and PIN.
  - Someone already signed in who goes to `/` sees the public page, with **Open POS** in the header.
- **The monthly fee** (`PosBillingService`):
  - **Plans** (`pos_plans`) are set in admin.udozo.com > POS > Plans: name, monthly price per market currency, an optional yearly price, the limits (tills, staff, shops), trial days (14 by default), and whether the plan is shown. Finance changes them after step-up, and every change is audited.
  - **Charging:** the fee is taken from the owner's `customer_wallet` into `pos_revenue` (a new revenue ledger account). This happens at sign-up, or when the trial ends, then each month. Each period is one entry (`pos:<account>:<period>`), so a retry never charges twice.
  - **Changing plan:** moving up is charged at once, less the unused part of what was paid; moving down takes effect at the end of the month.
  - **A failed renewal:** 7 days' grace with notices (inbox, push and email) 3 days before renewal, on failure, and the day before it drops to Free. After that the account is held to Free's limits (see The three plans) until the owner pays. Nothing is deleted.
  - **Cancelling:** the plan runs to the end of the paid month.
  - **Invoices:** one for every charge, on Billing (PDF).
  - The `pos` cron job runs renewals.

## How buyers pay at the till (decided, 10 November 2026)

A sale can be paid by **cash**, **bank transfer**, **card**, **Udozo wallet** or **other** (the shop names it, such as a cheque or a POS terminal's own slip). It can also be **split** across methods, the payments adding up to the total, with change worked out for cash.

- **Cash:** the amount handed over, with the change shown. It counts towards the shift's expected cash at cash-up.
- **Bank transfer:** to the shop's own account, shown on the till and the receipt (the shop's bank details, set on the shop). The cashier records the sender's name or reference once the money shows in the shop's bank.
- **Card:** recorded only, with the terminal's reference. Udozo integrates no card terminal in version one.
- **Other:** recorded with its name and reference.
- **Udozo wallet:** the only method where money moves through Udozo.
  - The till shows a QR code for the amount (`udozo.com/pay/<code>`, valid 5 minutes, one sale). Alternatively, the cashier types the buyer's Udozo phone number, and the buyer is asked on udozo.com (push and inbox) or on WhatsApp.
  - The buyer, signed in on udozo.com, sees the shop's name, the amount and the items, then confirms with **Pay** (`useConfirm`), so nothing is ever taken without them.
  - The till sees it paid within seconds (polled) and completes the sale.
  - **The money:** one ledger entry (`pos_wallet:<payment>`) moves it from the buyer's `customer_wallet` to the owner's `customer_withdrawable`, less Udozo's wallet-payment fee, if admins set one (`pos_wallet_fee_bps` per market, default 0), which goes to `pos_revenue`. The owner withdraws it to a bank from udozo.com's Payouts as UdozoPay sales are paid.
  - **The payout hold:** the money is paid out only after the market's payout hold, and after the check of reversible card top-ups, as UdozoPay's money is.
  - **Refunds:** a refunded or voided wallet sale returns the money from the owner's withdrawable to the buyer's wallet (`pos_wallet_refund:<payment>`). Where the owner has already withdrawn it, the refund waits until enough has come in, and the owner is told.
  - **Limits:** the buyer needs a confirmed mobile, and never pays their own shop (`same_person`). It is off unless the market's `pos_wallet_payments` switch is on (global or country, off by default), pending the licensing advice below.
- **Every other method's money is the shop's own and never enters Udozo's ledger.** The POS only records it, for receipts, cash-up and reports.

## The three plans (decided, 10 November 2026)

| | **Free** | **Premium** | **Multi-shop** |
|---|---|---|---|
| Monthly fee | none | yes | yes, more than Premium |
| Products at POS (listings ticked Sell at POS) | limited (50 by default) | unlimited | unlimited |
| Shops | 1 | 1 | several (10 by default) |
| Tills and staff | admin-set (2 tills, 3 staff by default) | unlimited | unlimited |
| Stock | the listing's stock | the listing's stock | split between shops (above) |

- **Limits are admin-set** (`pos_plans.limits`, null for unlimited). The defaults above are mine until the owner sets them. Lowering a limit never removes anything: it only stops the next addition (`pos_limit_reached`, naming the plan).
- **Free needs no payment.** Sign-up on Free skips the Pay step, so a shop can start selling the same day.
- **Free's product limit counts listings ticked Sell at POS.** Ticking one more is refused on Post an ad, saying why, with Upgrade.
- **Premium and Multi-shop** are paid monthly (yearly where set) from the wallet, with an optional trial. Moving from Free to a paid plan is charged at once.
- **A paid plan that lapses** after its grace drops to Free's limits rather than stopping the POS: the till keeps selling the first 50 products, and the rest stay listed but cannot be sold at the till until the owner pays. A Multi-shop account that lapses keeps its main shop selling, and its other shops pause.

## Milestones (each a commit or a few, tested, deployable)

0. **Plan:** this document saved and linked.
1. **Foundation, public site and sign-up (S15–S18):**
   - the `pos` switch, and the schema for accounts, shops, tills and plans;
   - the three plans (Free, Premium, Multi-shop) seeded, with their limits checked by one `posLimit`;
   - `money.ts` (totals, discounts, VAT, rounding; the S9 sample sale totals ₦38,700);
   - `apps/udozo-pos` skeleton on the shared console UI with handoff sign-in;
   - the public site (`/`, `/pricing`, `/download`), with each app's button saying Coming soon until its link is set;
   - sign-up: connect the Udozo account, set up the shop, choose the plan, then pay the first month from the wallet (or start the trial), with Add funds through udozo.com's wallet top-up;
   - the monthly fee: renewals, grace, notices and invoices (the `pos` cron job);
   - first-run setup (S18): shop, tills;
   - admin.udozo.com **POS** section: accounts, shops, plans and prices, app links (support reads, finance sets prices).
2. **Catalogue (S4, S18):**
   - Sell at POS, shop only, barcode and reorder level on Post an ad;
   - the POS catalogue reads listings live;
   - unticking removes an item from the register.
3. **Register and inventory (S1, S3):**
   - product grid, categories, search, barcode (camera through `BarcodeDetector` or zxing, and keyboard-wedge scanners), cart, sale complete;
   - payments: cash with change, bank transfer, card and other (recorded), split payments, and Udozo wallet by QR or phone with the buyer confirming on udozo.com, refunds included;
   - till sales taking the listing's stock (`takeStockAtTill`), never what online orders hold;
   - inventory with adjust, count, history and low stock, all on the listing's own stock.
4. **Staff, roles, tills (S6–S8):**
   - matrix and custom roles, invites by WhatsApp or SMS, PIN set-up;
   - till sign-in, lockout, manager approval, device linking (S19);
   - a role test for every cell of the matrix.
5. **Receipts (S9–S13):**
   - 80 mm and 58 mm receipts and A4 invoice (pdfkit, plus print CSS for browser printing);
   - share screen with a QR (`wa.me/<Udozo number>?text=RECEIPT POS-…-<token>`), the bot replying with the PDF;
   - email with the PDF attached;
   - resend from history.
6. **Overview and reports (S2):**
   - totals, an hourly POS-versus-online chart, payment mix, top sellers, restock list;
   - shifts and cash-up, end of day;
   - CSV and PDF exports for the accountant.
7. **Multi-shop:** several shops, the stock split between them with transfers, online orders fulfilled from the chosen shop, and reports per shop. Also upgrading and downgrading between the three plans, and yearly billing. (The plan limits themselves, `posLimit`, come in milestone 1.)
8. **Offline and apps (S5, S19):**
   - an IndexedDB catalogue and outbox in the web app first;
   - then Expo (camera, Bluetooth ESC/POS) and Tauri (USB printers, cash drawer);
   - setting each app's store link in admin turns its Coming soon button on pos.udozo.com into a download.

## Legal owed before `pos` goes on anywhere

- POS terms: the shop is the seller at its till, Udozo provides the software, and the shop handles its own tax and VAT on receipts.
- **Udozo wallet payments at the till:** lawyers' advice per market before `pos_wallet_payments` goes on. Money moves from one customer's wallet to another's withdrawable balance, held through Udozo's licensed payment partners as for UdozoPay. The buyer and shop terms must cover it (confirming, refunds, the payout hold), and the privacy notice must say the shop sees the buyer's name.
- Privacy notice: staff names and phones, the shop's customers on receipts, WhatsApp delivery of receipts, retention.
- Plan and fee terms, before sign-up opens: the monthly fee from the wallet, the trial, renewal, grace, cancelling, and what happens to the shop's data after the POS stops.

## Verification

- **API tests** (`apps/udozo-api/test/pos-*.test.mjs`, PGlite and Docker):
  - money and VAT;
  - stock: till and online sales racing in parallel on one listing, held units refused, oversold;
  - every role against every route;
  - staff sessions refused on every customer route;
  - PIN lockout;
  - device unlink;
  - client sale id idempotency;
  - receipt QR expiry;
  - plus `vercel-crons` and `udozo-scope` updated.
- **App tests:** `apps/udozo-pos/test` (Vitest, jsdom) and `apps/udozo/test` for the Post an ad fields.
- Targeted tests only, per milestone. Check at 320, 360 and 390 px.

## Still needed from the owner

1. **The design canvas** (S1–S19). The doc link reaches only the written brief, so I need the canvas link or an export to match the screens.
2. **Premium's and Multi-shop's monthly price per market, the trial length, any yearly discount, and Free's limits** (products, tills, staff) if not my defaults. Needed for milestone 1 now; admins can change them later.
3. **Store accounts:** Apple, Google Play and a Windows code-signing certificate under Udozo's name (needed by milestone 8 only).
