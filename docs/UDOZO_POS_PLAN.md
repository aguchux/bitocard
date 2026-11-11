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
- **Offline:** see Selling with no internet. It comes in milestone 9, online-first until then. Every sale still carries a client-made UUID (`client_sale_id`, unique) from the first milestone, so offline replay can come later without changing the API.
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
- **Offline replay** (milestone 9) may sell below what is free, because the item was physically there. The sale stands, stock goes no lower than 0, and the listing is flagged `oversold` for the owner or a manager.
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
  - `pos_shops` also keeps the shop's own bank details for transfers (shown, never used to move money);
  - `pos_collection_accounts` (shop, till, provider, reference, account number, bank, name, status; one open per till: per-sale accounts come later) and `pos_transfer_requests` (the basket waiting at the till for a transfer);
  - `pos_collections` (account, provider transaction, amount, payer's name, sale, status `matched`, `unmatched` or `kept`, the gateway's fee and Udozo's);
  - `pos_settlements` (account, day, amount, fees, bank account, transfer reference, status `pending`, `paid`, `failed` or `held`);
  - `pos_customers` (the shop's own, no Udozo account needed; linked to a Udozo account when they pay through Udozo) and `pos_customer_entries` (credit sales, repayments, refunds; built, migration `20270318000000_pos_customers`).
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
  - `/download`: Android, iOS and Windows, plus Use it in your browser; **Download for Windows** opens Udozo POS's Microsoft Store listing (the Store's web page, which offers to open the Store app and install), never a file from pos.udozo.com;
  - `/signup` and `/signin`;
  - legal pages: POS terms and privacy link to udozo.com's `/legal/pos` and `/legal/privacy`.
- **App buttons** (Google Play, App Store and Microsoft Store):
  - each points at its store once that app is live, with the links set in admin (`pos_app_links`; Windows takes only a Microsoft Store address, `apps.microsoft.com/detail/<product id>`, refused otherwise);
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
- **Bank transfer**, in one of two ways, which the owner chooses per shop (both may be on):
  - **To a Udozo collection account** (below): Udozo confirms the money itself, the sale completes on its own, and the money is in the owner's bank the next working day.
  - **To the shop's own bank account**, set on the shop in the POS admin dashboard and shown on the till and the receipt. Udozo cannot see this account, so the cashier records the sender's name or reference once the money shows in the shop's bank.
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
- **Every other method's money** (cash, the shop's own account, card, other) **is the shop's own and never enters Udozo's ledger.** The POS only records it, for receipts, cash-up and reports.

## Udozo collection accounts and next-day settlement (decided, 11 November 2026)

An owner who wants bank transfers confirmed without checking their bank app asks Udozo for **collection accounts** in the POS admin dashboard (Settings > Payments > Collection accounts).

- **What they are:** bank account numbers issued by Udozo's payment gateways in Udozo's name for that shop, the same kind of accounts as udozo.com's reserved accounts (`PaymentsService.openReservedAccounts`, `reserved_account_requests`).
  - Flutterwave first; Monnify as a second in Nigeria; Paystack's dedicated accounts where it has them.
  - Each is opened with its own reference (`udz_pos_<shop>_<till>`) and request row, claimed so that a double click opens one.
- **Two kinds**, the owner choosing which:
  - **A static account per till**, which customers can pay at any time. A transfer is matched to the sale waiting on that till for that exact amount. With no sale waiting, or a different amount, it goes to **Unmatched** for a manager to attach to a sale or refund.
  - **An account for one sale** (dynamic), where the gateway offers them: made for the exact amount when the cashier chooses Bank transfer, expiring in 30 minutes. This matches exactly, even with several tills waiting for the same amount.
- **At the till:** the cashier chooses Bank transfer > Udozo account. The till shows the bank, the account number, the name and the amount (also as a QR for banking apps that read one) and waits.
  - The gateway's notification is re-read from the gateway, never trusted from its body, then credited once (`pos_collection:<provider>:<transaction>`). The sale completes on its own, and the receipt says Paid by transfer with the sender's name.
  - A transfer for less is shown as part payment, and the rest can be paid by any method. A transfer for more completes the sale, and the difference is refunded or attached to the next sale.
- **Who can request them:**
  - the owner, on a paid plan (Premium or Multi-shop; Free shows the shop's own account only), with `pos_collections` on in the market (global or country, off by default);
  - live, the owner's passed identity check (and in Nigeria the BVN check the gateways need), and a settlement bank account in the owner's verified name (`accountNameMatches`);
  - at most one static account per till.
- **The money:**
  - **Collected:** the gateway's money is booked from `provider_balance` to the owner's `pos_collected` (a new customer account, never below zero), less Udozo's collection fee: the gateway's fee plus an admin-set margin per market (`pos_collection_fee_bps`, a minimum and a cap), into `pos_revenue`.
  - **Next-day settlement:** the `pos` job pays each owner's previous day's collections (Lagos time, or the market's zone) to their settlement bank account on the next working day, through Udozo's transfer provider (`PaymentProviders.transfers`).
    - It runs as Safe pay payouts do: moved to `customer_payouts_pending` first (reference `pos_settlement:<account>:<day>`, so it is never paid twice). Paid, the provider's fee is Udozo's. A definite failure returns the money to `pos_collected` and tells the owner; an unclear transfer stays pending and tells finance.
    - Bank transfers are not reversible like cards, so no payout hold applies. Admins can hold an owner's settlement (fraud, a dispute) with a reason, audited.
  - **Statement:** each day's settlement on the POS admin dashboard lists every transfer, its sale, the fee and what was paid, with a PDF.
  - **Refunds** of a sale paid this way are taken from the day's collections before settlement, else they wait for the next collections, and the owner is told.
- **Closing:** the owner can close an account (the gateway's account is deactivated where it allows). A transfer still arriving afterwards is credited and settled, never lost.
- **Admins** (admin.udozo.com > POS > Collections): accounts, collections, unmatched transfers, settlements and failures; hold or release a settlement; set the fee per market.

## Selling with no internet (recommended, 11 November 2026)

**Yes, a till keeps selling with no internet**, within limits that keep stock and money honest. Udozo confirms nothing while the till is offline, so only what the shop handles itself works then. Everything is uploaded in order when the connection returns.

**What works offline and what does not**

| Works offline | Waits for the internet |
|---|---|
| Cash (with change) | Udozo wallet payments (the buyer must confirm online) |
| Card, recorded with the terminal's reference | Udozo collection accounts: the till cannot see the transfer arrive (but see below) |
| Transfer to the shop's own account, recorded | Sending receipts by WhatsApp or email (queued, sent on reconnect) |
| Other methods, recorded | Inviting staff, changing roles, plans or settings |
| Split payments of the above | Stock changes made by another till or online (seen on reconnect) |
| Printing receipts | |
| Refunds and voids of this till's own sales, with a manager's PIN | |
| Opening and closing a shift, cash-up | |

A transfer to the till's **static** collection account can still be accepted offline as **Transfer: to confirm**, with a manager's PIN. The sale completes, its receipt says payment is being confirmed, and on reconnect it is matched to the transfer that arrived (amount, account, time). If none arrived within an hour, it is flagged to the manager as unpaid. This is off by default, a shop setting.

**Before a till can work offline**

- **The device is linked to the shop** (device linking, milestone 5) and has synced while online. A browser that has never been online with the shop cannot sell offline.
- **It keeps a copy of what it needs**, refreshed every few minutes while online and on every sale:
  - the listings ticked Sell at POS, with their price, barcode, category and photo;
  - **how many are free to sell** (stock less what online orders hold);
  - the shop's details, VAT, receipt layout and bank details;
  - the roles and permissions;
  - the staff allowed on this till.
- **Staff sign in offline with their PIN.** The device keeps a PIN check for each staff member who has signed in on it online (an Argon2 hash, sealed with the device's key, never the PIN). Five wrong tries lock that person on that device. A staff member suspended while the till was offline can still sign in there until it reconnects; their sales are flagged for the owner then.
- **Where it is kept:** in the apps, SQLite (Expo and Tauri), encrypted. In the web app, IndexedDB with the browser asked for persistent storage, so it is not cleared. The web app warns when the browser refuses, and recommends the app for shops that go offline often.

**Selling offline**

1. The till shows a clear **Offline** banner, with how many sales are waiting to upload. It turns to **Syncing**, then disappears.
2. The cashier sells as usual. Prices are the copy's prices; stock counts down from the copy's free stock.
3. **Stock:** the till will not sell more than its copy says is free. A manager's PIN can override this for an item physically in hand, and the sale is then marked oversold. The till cannot see other tills' or online sales meanwhile, so two tills could both sell the last unit; that is caught on upload (below).
4. **Each sale gets** its client id (`client_sale_id`, made on the device) and a provisional number naming the till (`T2-0042`), printed on the receipt with a QR to the receipt online. Its final `POS-000123` number comes on upload and is shown in the sales history beside the provisional one.
5. **Receipts:** printing works offline (Bluetooth or USB printers in the apps, the browser's print in the web app). WhatsApp and email receipts are queued and sent on reconnect.

**Limits that keep it safe**

- **72 hours or 500 sales offline** (admin-set per plan), whichever comes first. After that the till stops selling until it syncs, so a lost or stolen till cannot keep trading for weeks. Warnings start at 48 hours.
- **Discounts** are held to the staff member's role limit offline as online. Anything needing a manager needs a manager's PIN on the till.
- **An unlinked device** (lost or stolen) can upload what it sold while it was linked; those sales are held for the owner to accept or reject, never applied automatically. It can sell nothing more.

**Uploading on reconnect**

- **The outbox:** everything done offline (sales, refunds, voids, shift and cash-up events, stock counts) is uploaded **in the order it happened**, in batches, each with its own id, so a retry never doubles anything (the API answers the earlier result for an id it has seen).
- **Each sale is applied as it was made:** the prices it was sold at, the staff member, the time it happened (`client_created_at`, beside when it arrived).
- **Stock** is taken in one transaction per sale, as online (`takeStockAtTill`):
  - if what is free has run out, the sale still stands (the goods have left the shop), stock goes no lower than 0, and the listing is flagged **oversold** for the owner or a manager to resolve (restock, cancel an online order, or correct a count);
  - units held for online orders are never taken. A sale that would need them is flagged instead, so the owner decides.
- **Things that changed meanwhile** never undo a sale: a new price applies only to new sales, an unticked product's sale stands, and a staff member suspended meanwhile has their offline sales flagged.
- **After upload** the till refreshes its copy, shows anything flagged, and the banner clears. The owner's dashboard lists each device's last sync and anything still waiting, and the owner is told when a till has not synced for a day.

**Where the web app lives on the device**

Nothing is installed into a folder the shop chooses. Everything belongs to the browser, kept for the address `https://pos.udozo.com` only, so no other site can read it.

- **Installing** (Install Udozo POS, or the browser's Add to Home screen) adds an icon (Windows Start menu and desktop, an Android home-screen app, an iPhone or iPad Home Screen icon) that opens the POS in its own window without the address bar. It is a shortcut to the same site, with no files of its own.
- **The app itself** (pages, scripts, icons): kept by its **service worker** in the browser's Cache Storage, so it opens with no internet.
  - This is POS's own worker: udozo.com's offline worker caches nothing.
  - A new version downloads in the background, and the till shows **Update ready** and switches between sales, never in the middle of one.
- **The data** (the product copy, staff PIN checks, the outbox of unsent sales): in the browser's **IndexedDB** for pos.udozo.com, sealed with a device key made by the browser (WebCrypto, not extractable) and kept beside it.
- **On disk** it is inside the browser's profile, for example on Windows with Chrome `%LOCALAPPDATA%\Google\Chrome\User Data\Default\IndexedDB\https_pos.udozo.com_0.indexeddb.leveldb`. On Android and iPhone it sits in the browser's private storage, which nobody can open.
- **Each browser keeps its own copy:** Chrome and Edge on the same computer are two devices to link. A private or incognito window keeps nothing, and the POS refuses offline mode there.
- **Clearing it is the risk:** clearing the browser's site data, uninstalling the browser, or (iPhone and iPad) Safari removing data of a site not opened for 7 days unless it is on the Home Screen, deletes the copy and **any sales not yet uploaded**. The plan guards against this:
  - **Persistent storage:** the POS asks the browser for it at linking (`navigator.storage.persist()`), and refuses offline mode if refused, saying why.
  - **Upload at once:** sales go up immediately whenever there is a connection, so the outbox is normally empty, and the count of waiting sales is always on screen.
  - **Export unsent sales:** a file of sales not yet uploaded, sealed and signed by the device, that a manager can save to the computer or a USB stick and upload later from any signed-in device (applied like the outbox, never twice).
  - **Printed receipts** remain the shop's paper record.
  - **Shops that go offline often are steered to the apps,** whose SQLite database sits in the app's own storage and is not cleared with the browser.

**How the offline data is stored**

One local database per linked till (`udozo-pos-<shop>-<till>`), the same layout in the web app (IndexedDB) and the apps (SQLite). Both sit behind one `PosStore` interface in a shared package, so the till's code does not know which it runs on.

| Store | What it holds | Sealed? |
|---|---|---|
| `meta` | device and till ids, schema version, last sync time and cursor, when it went offline, sales count offline, the next provisional number | no |
| `products` | each listing ticked Sell at POS: id, title, price, barcode (indexed for scanning), category, free stock when last synced, units sold here since, updated at | no (nothing secret, and the barcode index must be readable) |
| `photos` | small thumbnails (200 px, the first 1,000 products) in Cache Storage or the app's files | no |
| `staff` | id, name, role, PIN check (Argon2id hash and salt), failed tries, locked until | yes |
| `roles`, `settings` | permissions and discount limits; the shop's details, VAT, receipt layout, bank details | settings yes |
| `sales` | each sale in full: client id, provisional number, lines, payments, staff, time, status (`waiting`, `uploaded`, `flagged`) and, once uploaded, its `POS-` number | yes |
| `outbox` | the queue of things to upload, numbered in the order they happened: sale, refund, void, shift opened or closed, stock count; with attempts and the last error | yes |
| `shifts` | open and closed shifts with their cash | yes |
| `messages` | WhatsApp and email receipts waiting to be sent | yes |

- **Sealed** means the record is encrypted with AES-GCM under the device key, which the browser (WebCrypto, non-extractable) or the phone's keystore holds. The files are useless copied to another machine.
- **A sale is one local transaction:**
  - writing the sale, its outbox entry and the stock change happens all at once or not at all;
  - a crash, a closed tab or a flat battery mid-sale leaves nothing half-written;
  - the sale is never shown as complete before it is saved.
- **Uploading** takes the outbox in its numbered order, a batch at a time. The API answers each entry's client id with its result (the `POS-` number, or a flag); the till marks it uploaded and moves on, and a failed entry is retried without skipping ahead. Uploaded sales stay on the device 30 days for reprinting, then are removed.
- **Refreshing the copy** asks only for what changed since the last sync (the `meta` cursor): prices, stock, products ticked or unticked, staff and roles. Units sold here are kept until the API confirms them, so free stock never counts a sale twice.
- **Size:** a shop of 5,000 products is a few megabytes, plus the thumbnails. The till warns if the browser offers less space than it needs.

**Rollout:** offline comes in milestone 9, but every sale carries its client id from milestone 3, so nothing in the API changes for it.
1. The web app first (IndexedDB, service worker, cash and recorded methods), so shops can use it on any device.
2. The Android, iOS and Windows apps, where storage is reliable and printers and cash drawers connect.

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

## Build progress (pick up here)

**Targets now (11 November 2026, the owner's decision): the web app (pos.udozo.com) and Windows.** Android and iOS come later.

**The design** is saved in `docs/design/pos-ui/` as 22 design-canvas screens (`*.dc.html`, open with `support.js` beside them):
- `PosLanding`, `Signup`, `PosLogin`, `Setup`, `Downloads`: milestone 1;
- `Main` (the register), `Checkout`, `Inventory`, `Dashboard`: milestone 3;
- `PostListing`: milestone 2;
- `Staff`, `StaffLogin`, `AcceptInvite`: milestone 5;
- `ReceiptShare`, `Receipt80mm`, `Invoice`, `CustomerQr`, `WhatsappReceipt`: milestone 6;
- `PaymentsSettings`, `Settlements`: milestone 4;
- `MobileSell`: later;
- `Flow`: the whole journey.

**The theme** to follow, which is the POS's own and not udozo.com's blue:
- colours: primary green `#0B7A5A` (hover `#075C43`, the mark's tile `#19A47A`, a soft tint `#E6F3EE`); a dark green rail and header `#10231C` with panels `#1A3329` and borders `#2A4A3D`, its text `#D6E3DD` and muted `#B9CCC3`;
- surfaces and text: text `#14201B`, secondary `#33413A`, muted `#56635C`; borders `#DCE2DE`; the page `#F4F6F4` on white cards;
- warnings and errors: warning ink `#8A4B08` on `#FDEFD9`; error `#A2251A`;
- type: headings in Space Grotesk 600/700, body in Inter;
- shapes: cards with 18 to 20 px corners, buttons 44 to 56 px tall with 10 to 14 px corners.

The design names its plans Starter, Business and Multi-shop with placeholder prices. **Use the owner's decided plans (Free, Premium, Multi-shop) and the prices finance sets.** The design's owner sign-in is an email and password form; **build it as Continue with Udozo (udozo.com's handoff)**, as decided, since pos.udozo.com never asks for a Udozo password.

**Milestone 1: done so far (uncommitted work may exist; check `git status`):**
- **API, in `apps/udozo-api/src/pos/`:**
  - `money.ts`: sale totals (VAT added on the total after discounts, half-up rounding; the sample sale is ₦38,700), change, `addMonth`, `unusedCredit`;
  - `plans.ts`: the plan codes `free`, `premium` and `multi_shop`, limits, `priceIn`, `offered`, `presentPlan`, shop codes like `ADA-4821`, `PI-000123` invoice numbers;
  - `pos.service.ts`: the owner's status, sign-up (the shop, the first till, the plan; a trial charges nothing; otherwise paid from `customer_wallet` to `pos_revenue`), plan changes (dearer: charged now less unused credit; cheaper or Free: `next_plan` at the month's end; during a trial, swapped), shops and tills within limits (`pos_limit_reached`), charges;
  - `billing.service.ts`: the hourly `pos` job (a reminder 3 days before, the renewal, 7 days' grace with notices, then Free with `lapsed_plan_code`);
  - `pos-admin.service.ts`: accounts, plans (finance, step-up, audited `pos.plan_changed`), app links (store addresses only; Windows only `apps.microsoft.com/detail/<12 characters>`);
  - `pos.controller.ts`: `GET /v1/pos/plans?country=`, `GET /v1/pos/apps` (public); `/v1/pos/owner` (`GET`, `POST signup`, `POST plan`, `GET charges`, `POST shops`, `PATCH shops/:id`, `POST shops/:id/tills`, `PATCH|DELETE tills/:id`; customer session); `/v1/admin/pos/accounts(/:id)`, `plans`, `PATCH plans/:code`, `apps`, `PUT apps/:platform`.
- **Database:** migration `20270313000000_pos_foundation` makes `pos_plans` (seeded without prices), `pos_accounts`, `pos_shops`, `pos_tills`, `pos_charges` and `pos_app_links`, and adds `AccountKind` `pos_revenue`.
- **Settings:** the switch `pos` (Udozo's, global or country, off), the notice type `customer.pos.plan`, `POS_URL` (default `https://pos.udozo.com`) as a handoff target, `AccountNotices.customerAt`, and the `pos` cron job (`jobs.ts`, `vercel.json` at `25 * * * *`).
- **Tests:** `apps/udozo-api/test/pos.test.mjs`; `udozo-scope`, `vercel-crons` and `admin-step-up` updated.

**Milestone 1: the web app is built (11 November 2026)**, `apps/udozo-pos` (`@udozo/pos`, port 3014), copied in structure from `apps/udozo-connect`:
- `lib/site.ts` (`POS_URL`, else pos.udozo.com on Vercel, else localhost:3014; `signInUrl` through udozo.com's `/handoff/go`), `lib/session.ts` (its own `udz_pos` cookie, host-only and httpOnly; the browser never calls the API), `lib/handoff-actions.ts`, `lib/pos.ts` (the API's shapes, money in the market's currency, plan and limit words, `dueToday`, `statusText`, `readVat`), `lib/pos-data.ts` (public plans and app links kept a minute and never throwing, the owner, the charges, `marketFor`), `lib/pos-actions.ts` (sign-up with what was shown due today, plan changes, shop details, tills, sign out);
- the public site in `app/(site)`, on the POS's own header and footer: `/` (`PosLanding`: hero with the till as a labelled illustration, three steps, features with those not built yet marked Coming soon, the apps band, plans, questions), `/pricing`, `/download` (each app's button Coming soon until its store link is set; Windows only ever the Microsoft Store), `/signin` (two doors: Continue with Udozo, `/signin/udozo`; staff sign in with the shop code, their phone number and PIN at `/signin`, or tap their name on a linked till at `/signin/till`, since milestone 5), `/signup` (connect, then the shop with its VAT, the plan, and what is due today from the wallet, Pay blocked with Add funds on udozo.com when short; Free and trials take nothing); robots and the sitemap keep only `/`, `/pricing` and `/download` indexed;
- the owner's `/app`, behind Continue with Udozo and sign-up: home (where the plan stands, limits, what to do next), `/app/setup` (shop details and tills within the plan's limit, counted across shops), `/app/billing` (the wallet, changing plan confirmed in Udozo POS's own dialog with what it does, the charges);
- Udozo's icons (`scripts/brand-assets.py` lists `udozo-pos`), the theme above as `pos-*` colours;
- tests: `apps/udozo-pos/test` (31: the words and figures, signing in and the handoff, every action's route and body, the public reads, robots, the sign-up wizard, plan changes, tills and the public pieces); every public page checked at 320, 360, 390 and 1280 px with no sideways scrolling.

**Milestone 1: still to do, in order:**
1. **pos.udozo.com is deployed (11 November 2026):** Vercel project `udozo-pos` in the De-Golojan Team (root `apps/udozo-pos`, skip-unchanged, `VERCEL_DEEP_CLONE`), `pos.udozo.com` a DNS-only CNAME in udozo.com's Cloudflare zone, its certificate issued by hand (`vercel certs issue`) as connect's was. Still owed: `STORE_SERVER_SECRET` on the project, the same value as `udozo-api`'s.
2. **Windows is built (11 November 2026), not yet built in CI or published:** `apps/udozo-pos-windows` (`@udozo/pos-windows`, its README says how to release it), a Tauri 2 shell (`src-tauri`: `tauri.conf.json`, `Cargo.toml`, `src/main.rs`): one maximised window opening the bundled start page (`start/`), which waits for the internet and then opens `https://pos.udozo.com/app`; only pos.udozo.com and udozo.com stay in the window (`on_navigation`), anything else opens in the browser (`tauri-plugin-opener`); one copy at a time (`tauri-plugin-single-instance`, registered first); no capabilities, so pages cannot call into Windows; a strict CSP on the start page. Tauri's own installers are off (`bundle.active: false`): CI (`.github/workflows/pos-windows.yml`, `windows-latest`) builds `udozo-pos.exe` with `npx @tauri-apps/cli@2 build`, lays out the package (`scripts/msix-layout.mjs`: `msix/AppxManifest.xml`, a full-trust desktop app for Windows 10 1809 or later, its identity from the repository variables `POS_MSIX_IDENTITY_NAME`, `POS_MSIX_PUBLISHER` and `POS_MSIX_PUBLISHER_NAME`, Partner Center's Product identity, else a test identity; the version from `tauri.conf.json` with a fourth part of 0), packs it with the Windows SDK's `makeappx`, and keeps `udozo-pos.msix` unsigned as the run's artifact (the Store signs it). This uses the Tauri CLI directly, not `tauri-apps/tauri-action`, which makes Tauri's installers and releases. Its icons, Store tiles and start page picture come from `scripts/brand-assets.py` (`DESKTOP`). Tests: `apps/udozo-pos-windows/test/windows.test.mjs` (Node, no Rust). Still owed: the first CI run (Rust has never compiled this here), then Partner Center (the name reserved, the identity variables set) and the Store link in admin.
3. **admin.udozo.com > POS is built (11 November 2026):** the POS section (`apps/udozo-admin/app/(console)/pos/`, words in `components/pos.tsx`): **Accounts** (`/pos/accounts`: found by shop, shop code, owner's name or email, by market and plan, each with where its plan stands; `/pos/accounts/<id>`: the plan, its limits and month, the owner linking to their customer page, each shop with its code, VAT and tills, and the charges), **Plans and prices** (`/pos/plans`: each plan's prices per market currency, limits, trial and whether it is offered; finance changes them in one dialog after step-up, an empty price leaving that currency unpriced and an empty limit unlimited, Free always limited and offered, checked before sending by `planChange`) and **App links** (`/pos/apps`: each store page, operations set or clear it, the API's refusal shown in words; others read). Hooks in `@bitocard/api-client/admin` (`udozo-pos.ts`; tags `PosAccounts`, `PosPlans`). Tests: `apps/udozo-admin/test/pos.test.tsx`.
4. **AGENTS.md:** the Udozo POS entry says what is built (done for the API and the web app); add the deployment once it is live.
5. **Legal:** POS terms (`/legal/pos` on udozo.com) before the switch goes on.

**Milestone 2, the catalogue, is built (11 November 2026):**
- **Listings** (migration `20270314000000_pos_catalogue`): `pos_enabled_at` (when Sell at POS was ticked; null: not at the till), `barcode` (unique among the seller's listings that are not deleted, by a partial index) and `reorder_level`; the channel check is now on Udozo, through resellers, or at the shop, so a **shop-only** listing (`on_shop` and `resale` off) never shows on udozo.com (every public reader already filters on `on_shop`). The API (`ListingsService`) takes `pos_enabled`, `barcode` and `reorder_level` and returns them: ticking needs the seller's POS account (`pos_account_required`) and room in its plan's product limit, counting ticked listings not sold, removed or deleted (`posCountedStatuses`; `pos_limit_reached`); a listing already ticked stays; a barcode is 3 to 48 printable characters without spaces, an EAN or UPC with its check digit right (`barcode_invalid`), never the seller's other listing's (`barcode_taken`); auctions are never at the shop. `GET /v1/classifieds/me/pos` says whether the seller has Udozo POS and how many they may tick. Rules in `apps/udozo-api/src/pos/catalogue-rules.ts`.
- **The catalogue** (`PosCatalogueService`, `GET /v1/pos/owner/catalogue?q&category&barcode&show&limit&offset`, the owner's session, and staff's since milestone 5): the ticked listings read live, each with its price, barcode, category, photo, stock, units held for online buyers and what is free to sell, low stock at its reorder level, whether it is also on udozo.com, and `blocked` (`plan_limit`: past the plan's limit, the first ticked keep selling, as a lapsed paid plan needs; `not_live`; `no_price`; `out_of_stock`), with the summary, the top categories and its udozo.com edit link. Unticking takes it off at once.
- **udozo.com:** Post an ad's Where to sell has **Sell at your shop with Udozo POS** (`posOption` in `apps/udozo/components/account/resale-fields.tsx`: closed with a link to set up Udozo POS, or to the plans at the limit, saying how many are used), then the barcode and reorder level; shop-only is enough for the step (`stepProblem`), and My listings tags At your shop or Shop only.
- **pos.udozo.com:** **Products** (`/app/products`): figures, the plan's limit when exceeded, search by name, SKU, barcode or number, views (All, Selling, Low stock, Out of stock, Not selling), categories, pages of 24, each product saying why it does not sell and linking to edit it on udozo.com; with none ticked, how to tick them. Home and Shop and tills count them and link there.
- **Tests:** `apps/udozo-api/test/pos-catalogue.test.mjs`, `apps/udozo/test/pos-sell.test.ts`, `apps/udozo-pos/test/catalogue.test.tsx`.
- **Shop-only selling, shop-only categories and shop kinds (11 November 2026, the owner's request).** A seller may list and sell only in their physical shop, never on public udozo.com:
  - **Shop-only listings** (`isShopOnly`: neither `on_shop` nor `resale`, with Sell at POS) need only a title, category and price (`missingParts(…, true)`; the database's completeness check allows it, migration `20270315000000_pos_shop_only`). Submitting one makes it live at once with no end date (`submitShopOnly`: no photos, area, condition, review, posting limit or marketplace terms); running out never takes it off; finish-posting reminders and the expiry job leave it alone; made public later (`on_shop` or `resale`), it goes back to a draft and is posted through the public checks.
  - **The till sells whatever the shop has**, whether or not its ad is live on udozo.com: any ticked listing with a title and price (`tillBlock`: `incomplete`, `no_price`, `plan_limit`; out of stock apart), drafts, ads in review and expired ads included; sold, removed and deleted ones are not at the till.
  - **Shop-only categories** (`classified_categories.shop_only`): what the public market refuses or reviews but a licensed shop sells. Never opened in a market (no `classified_category_countries` rows), so every public reader leaves them out; offered in Post an ad only to sellers with Udozo POS (`GET /v1/classifieds/me/shop-categories`, shown as "(at your shop only)"); a listing in one is always shop-only (`shop_only_category` refuses Udozo, resellers or unticking; choosing it ticks Sell at POS within the plan's limit). The first: **Pharmacy and medicines** (`pharmacy`) with Prescription medicines (antibiotics among them), Over-the-counter medicines, Herbal medicines, and Vitamins and supplements, each with brand, pack size, registration number, expiry and sealed. The admin's Categories page, per market, does not list them yet.
  - **Shop kinds** (`pos_shops.kind`, `posShopKinds` in `apps/udozo-api/src/pos/shop-kinds.ts`, `GET /v1/pos/shop-kinds`): General shop, Pharmacy or chemist, Auto parts, Phones and electronics, Supermarket or provisions, Fashion and beauty, Building materials and hardware, each with its udozo.com categories. Chosen on pos.udozo.com's Shop and tills; the catalogue (and the till) lead with the kind's categories (`featured`). **Till themes per kind will come** (the owner's word): a kind's own layout and colours, and what a line asks for (a pharmacy's batch and expiry, an auto parts shop's part number and fitment), built on this field.
  - **Legal:** the POS terms must say the shop answers for the licences its goods need (a pharmacy's premises and pharmacist), and that Udozo provides software only; lawyers per market (NAFDAC and the PCN in Nigeria, FDA and the Pharmacy Council in Ghana, PPB in Kenya) before shop-only medicines are promoted.

**Milestone 3, ringing up sales, is built (11 November 2026), all but the Udozo wallet and camera scanning:**
- **Database** (migration `20270316000000_pos_sales`): `pos_sales` (numbered per shop, `POS-000123`, from `pos_shops.sale_next` claimed with one `UPDATE … RETURNING`; unique per account by the till's own `client_sale_id`; subtotal, discount, VAT at the shop's rate, total and change, checked by the database to add up; `completed` or `refunded` with the reason and whether it was restocked; who rang it up), `pos_sale_lines` (title, SKU, barcode and price as sold), `pos_payments` (`cash` with what was handed over and its change, `transfer`, `card`, `other`; a reference) and `pos_stock_movements` (`sale`, `refund`, `restock`, `count`, `damage`, with the stock after it).
- **API** (`PosSalesService` in `apps/udozo-api/src/pos/sales.service.ts`, rules in `sale-rules.ts`; the owner's session, and staff's since milestone 5):
  - `POST /v1/pos/owner/sales { till_id, client_sale_id, lines: [{ listing_id, quantity, discount? }], discount?, payments: [{ method, amount, tendered?, reference? }], expected_total, note?, client_created_at? }`: one of the owner's tills (else 404); the listings locked in id order, each the owner's, ticked and counted (`product_unavailable`), sellable (`tillBlock`: `plan_limit` past the plan's product limit), in the account's currency, and with enough **free** stock, its own less what online buyers hold (`stock_short`, naming how many are left); the totals worked out with `saleTotals` (`price_changed` when the till's total differs); payments adding up to exactly the total, cash alone with change (`payments_mismatch`, `cash_short`). The units come off the listing's own stock in the same transaction (a public listing keeps udozo.com's out-of-stock clock, a shop-only one has none), each with a movement. **Sent twice is one sale:** the same `client_sale_id` answers the first sale, also when two arrive at once. Nothing moves in the ledger: every method is recorded only.
  - `GET /v1/pos/owner/sales?shop&till&status&q&from&to&limit&offset` (newest first, with the filter's sales, takings, refunds and refunded), `GET …/sales/:id`, `POST …/sales/:id/refund { reason, restock? }` (the whole sale, once, `sale_refunded`; its units back unless `restock: false`, never to a listing sold, removed or deleted since).
  - `POST /v1/pos/owner/stock/:listing { kind: restock|count|damage, quantity, note?, shop_id? }` (never below what online buyers hold, `stock_below_held`, nor above 100,000) and `GET …/stock/:listing/movements`.
- **pos.udozo.com:**
  - **Till** (`/app/till`, `?till=` for another; `Register` in `components/register.tsx`): the products with their photos, price and what is free (the shop kind's categories first, as chips), one search box that a keyboard-wedge barcode scanner types into (Enter adds an exact barcode, SKU or number match, or the only match; `findProducts`), the basket with quantities held to what is free, a discount off the sale, VAT and the total worked out as Udozo does (`tillTotals`), then **Take payment** in one or several parts (cash with what was handed over, round notes to tap and the change; transfer or card with a reference; other) and **Complete sale**, which sends the basket's own id as the idempotency key, so pressing it again after a lost connection is never a second sale. The sale's number and the change to give, then New sale. A refusal for stock or price goes back to the basket and reads the shop again. On phones a bar at the bottom shows the basket's total.
  - **Sales** (`/app/sales`: by number, a day in the shop's time (Lagos), completed or refunded, Today; the takings), each sale (`/app/sales/<id>`: its lines, totals, how it was paid, and **Refund this sale** with its reason, putting the items back unless unticked, confirmed in Udozo POS's own dialog).
  - **Products:** **Change stock** on each (`components/stock-adjust.tsx`: new stock in, a shelf count, or damaged or lost, with a note, and the latest changes).
  - **Home:** today's sales and takings with **Open the till**.
- **Tests:** `apps/udozo-api/test/pos-sales.test.mjs`, `apps/udozo-pos/test/till.test.tsx`.
- **The Udozo wallet at the till, camera scanning and every product: built (11 November 2026).** Milestone 3 is complete; receipts are milestone 6, the overview and reports milestone 7.
  - **Udozo wallet** (migration `20270317000000_pos_wallet_payments`, `PosWalletService` in `apps/udozo-api/src/pos/wallet.service.ts`; switch `pos_wallet_payments`, Udozo's, global or country, **off by default** until lawyers clear it; `wallet_payments` on `GET /v1/pos/owner`). The till asks for the rest of its basket (`POST /v1/pos/owner/wallet-requests { …the sale, wallet_amount, phone? }`, `pos_wallet_requests`, `PW-000123`, waiting 5 minutes, one waiting per basket): checked as a sale would be and nothing taken; it answers the link's token once (only its hash kept) and `pay_url`, `https://udozo.com/pay/<token>`. Without `phone` the till shows it as a QR code anyone signed in may pay; with the buyer's confirmed Udozo mobile number in the shop's country (`buyer_unknown`; never the owner, `same_person`) only that buyer sees it, told by a notice (`customer.pos.payment`). The till asks `GET …/wallet-requests/:id` every 2 seconds and may cancel it (`…/cancel`). **The buyer** (`PosPaymentsController`, `/v1/store/account/pos-payments/:token`, customer sessions): `GET` (the shop, the items, the sale's total and the wallet part, `own_shop`), `POST …/pay { expected_amount }` and `POST …/decline`. Paying needs a udozo.com account with a confirmed mobile in the shop's country (`phone_required`, `currency_mismatch`, `same_person`) and claims the request, checks the basket again, makes the sale (its stock taken, a `udozo_wallet` payment with the request's number) and posts `pos_wallet:<request>` (the buyer's `customer_wallet` to the owner's `customer_withdrawable`, type `pos_wallet_payment`) in one transaction: a wallet too low is `wallet_balance_low` (402) and nothing moves; a basket that changed at the shop meanwhile (stock sold, a price changed, the basket sold another way) is `basket_changed`, nothing taken and the request cancelled. The money is held for the market's payout hold like UdozoPay sales (`CustomerPayoutsService.held` counts `pos_wallet_payment`), then paid out from udozo.com's Payouts. **Refunds** return the wallet part from the owner's payouts to the buyer's wallet (`pos_wallet_refund:<request>`) in the refund's own transaction; while the owner's payouts hold less (already paid out), the refund is refused (`refund_funds_short`) and waits. A till can never record `udozo_wallet` itself (`recordedPaymentMethods`). Udozo's wallet-payment fee (`pos_wallet_fee_bps`) is not built: no fee is taken. **udozo.com:** `/pay/<token>` (`app/(account)/pay/[token]/page.tsx`, `PosPay` in `components/account/pos-pay.tsx`, `lib/pos-pay.ts`, `lib/pos-pay-actions.ts`; signed in, `noindex`, kept out of robots): the shop, what is bought, what was paid at the counter and what the wallet pays, **Pay** confirmed in Udozo's own dialog and **Decline**, a wallet too low linking to Add funds and back. **The till:** a **Udozo wallet** method where the switch is on (the rest of the basket), **Show the QR code** or **Send to their phone**, then `WalletWait` (`components/wallet-wait.tsx`: the QR drawn in the browser with `qrcode`, the time left, Cancel; paid, the sale's number and change as for any sale).
  - **Camera scanning** (`CameraScan` in `apps/udozo-pos/components/camera-scan.tsx`): the till's **Camera** button opens the rear camera in a dialog, read by the browser's own `BarcodeDetector` (Chrome, Edge, Android) or else `@zxing/browser`, loaded only when needed (Safari on iPhone, Firefox), for EAN, UPC, Code 128 and 39, ITF and QR; the first code read is added as a scanner's would be, and the camera stops. pos.udozo.com alone allows itself the camera (`Permissions-Policy: camera=(self)` in `apps/udozo-pos/next.config.ts`); a refused camera says how to allow it (`cameraProblem`).
  - **Every product at the till:** the till reads its catalogue page by page, 1,000 a call up to 20,000 (`tillCatalogue` in `lib/pos-data.ts`; the catalogue takes `limit` up to 1,000), and draws the first 120 matching (`tillShown`), saying how many more there are: scanning, search and the categories find the rest.
  - **Tests:** `apps/udozo-api/test/pos-wallet.test.mjs`, `apps/udozo/test/pos-pay.test.ts`, `apps/udozo-pos/test/till-wallet.test.tsx`.
  - **Legal, before `pos_wallet_payments` goes on:** lawyers' advice per market (money moves between two customers' balances, held through Udozo's licensed payment partners as for UdozoPay), the buyer and shop terms (confirming, refunds, the payout hold) and the privacy notice (the shop sees the sale; the buyer's name is not shown to it).
- **The shop's own customers and pay later: built (11 November 2026, the owner's request).** POS customers never need a Udozo account: they are the shop's own records, and Udozo's admins read them under the shop's POS account.
  - **Records** (migration `20270318000000_pos_customers`, `PosCustomersService` in `apps/udozo-api/src/pos/customers.service.ts`): `pos_customers` (`C-000123` per account; name, mobile unique per account when given, email, address, notes, credit limit, what they owe, sales, spent, last sale; `source` `shop` or `udozo`) and `pos_customer_entries` (each credit sale, repayment and refund with what they owed after). Owner routes `GET|POST /v1/pos/owner/customers` (`q` by name, email, mobile digits or number; `owing`), `GET|PATCH|DELETE …/customers/:id` (deleting refused while they have sales or owe, `customer_in_use`; a taken mobile is `customer_phone_taken`), `POST …/customers/:id/repayments { amount, method, reference? }` (never more than owed, `repayment_too_much`).
  - **Linked to sales:** a sale takes `customer_id` (`customer_unknown` for another shop's) and counts towards their sales and spending; its page names them.
  - **Pay later:** the till's payment method `credit` (Pay later; `tillPaymentMethods`), only with a customer chosen (`customer_required`) and within their credit limit when one is set (`credit_limit_reached`, held again in the sale's own transaction, so two tills cannot pass it). A refund lowers what they owe by the credit part still owed.
  - **Udozo customers stay Udozo customers and join the shop's:** when a buyer pays through the Udozo wallet (asked by their mobile, or paying the QR), they are linked to the shop's customer the cashier chose, else to one with the same confirmed mobile, else a new one (`linkUdozo`), copying only their name and confirmed mobile, never their email. A linked customer shows their **Udozo rating**: their seller reviews (`ReviewStatsService`), Anjio's public words (`SellerScoreReader`), since when they are on Udozo and whether their account is in good standing.
  - **Receipts to them:** the record keeps the mobile and email receipts will be sent to (milestone 6).
  - **pos.udozo.com:** **Customers** (`/app/customers`, `/app/customers/new`, `/app/customers/<id>`: the Udozo rating, what they owe with Record a repayment, line by line, sales, details and Remove), and the till's customer picker (`TillCustomer`: find as you type, or add with a name and mobile; it shows what they owe) with Pay later among the payment methods.
  - **admin.udozo.com:** each POS account's **Customers** card (search, those who owe) and each customer's page (`/pos/accounts/<id>/customers/<customer>`: details, the Udozo rating, line by line, sales); `GET /v1/admin/pos/accounts/:id/customers(/:customer)`, read by support, operations and finance.
  - **Tests:** `apps/udozo-api/test/pos-customers.test.mjs`, `apps/udozo-pos/test/customers.test.ts`, `apps/udozo-pos/test/till-customer.test.tsx`, `apps/udozo-admin/test/pos-customers.test.tsx`.
  - **Legal:** the shop is the controller of its customers' records; the privacy notice and the shop terms must say Udozo holds them for the shop and links a Udozo buyer's name and mobile when they pay through Udozo; selling on credit is the shop's own arrangement with its customer.

**Milestone 4, Udozo collection accounts and next-day settlement, is built (11 November 2026)**, behind `pos_collections` (global or country, **off by default** until lawyers and the gateways clear it):
- **Data** (migration `20270319000000_pos_collections`): `pos_collection_accounts` (one open per till, `opening`, `active`, `refused` or `closed`; our reference `bc_rp_<mode>_<id>`), `pos_transfer_requests` (`PT-000123`, the basket waiting at the till, 30 minutes), `pos_collections` (`PC-000123`, one per gateway transaction; `matched`, `unmatched` or `kept`; the gateway's fee, Udozo's whole fee and what the owner gets), `pos_settlements` (`PS-000123`, one per owner and working day), `pos_market_settings` (Udozo's margin per market), the owner's settlement bank account and admins' hold on `pos_accounts`, payment method `udozo_transfer`, and ledger kind `pos_collected` (a customer account, never below zero).
- **Opening** (`PosCollectionsService` in `apps/udozo-api/src/pos/collections.service.ts`, rules in `collection-rules.ts`): an owner on a paid plan (`plan_feature_required`), with a settlement account chosen (`settlement_bank_account_id`, one of their own udozo.com payout bank accounts; `settlement_account_required`) and, live, the checks a payout needs (`CustomerCashService.requireCashOut`) and in Nigeria their BVN (passed on, never kept), asks for a till's account (`POST /v1/pos/owner/tills/:id/collection-account`): Udozo's gateways in turn (`PaymentProviders.reservedAccounts`: Flutterwave, then Monnify in Nigeria; the sandbox in test mode), one reference, claimed for a minute so a double click opens one (`collection_account_in_progress`), a clear refusal trying the next, an unclear answer stopping with the account still opening (`collection_account_pending`; a transfer that still arrives is credited by its reference), all refusing `collection_account_refused`. Closing (`…/collection-accounts/:id/close`) cancels the sale waiting on it; a transfer still arriving is credited and settled.
- **Transfers in:** the gateway's notification or the payments job's sweep (Flutterwave's `reservedReference` now takes `bc_rp_`) is re-read from the gateway by `PaymentsService`, which hands a `bc_rp_` reference to the POS (`usePosDeposits`, so payments never import the POS); the payer's name is read where the gateway gives it (`payerName`: Flutterwave's `meta.originatorname`, Monnify's `paymentSourceInformation`). Credited once per gateway transaction (`pos_collection:<provider>:<transaction>`): `provider_balance` and the gateway's fee (`processing_fees`) against the owner's `pos_collected` and Udozo's fee into `pos_revenue`. Udozo's fee is the gateway's plus the market's margin (`collectionFee`: basis points rounded up, held between a minimum and a cap, never above the transfer). Sandbox money never reaches a live account nor a gateway's a sandbox one (`wrong_mode`); another currency is never credited here.
- **At the till:** Pay by **Udozo account** (`POST /v1/pos/owner/transfer-requests { …sale, transfer_amount }`, `collection_account_missing` without an open account) shows the bank, number and name (`TransferWait`, polled every 3 seconds); the transfer for exactly that amount makes the sale in one transaction, both claimed first (`udozo_transfer` part, its reference `PT-… · <payer>`). A basket that changed at the shop meanwhile fails the request (`failed`, its reason) and leaves the money unmatched, never lost. Another amount, or no sale waiting, waits **unmatched**: the owner is told (`customer.pos.collection`) and, on pos.udozo.com's **Payments**, uses it for the sale it was for (a waiting or timed-out request for that amount, `…/collections/transfers/:id/attach`, `amount_mismatch`) or keeps it for no sale (`…/keep`, settled all the same: paying the sender back is the shop's).
- **Next-day settlement** (the hourly `pos` job, `PosCollectionsService.run`): on each market's working days (Monday to Friday in its own zone; public holidays not yet known), each owner's collections received before the day began are settled once (`pos_settlement:<account>:<day>`, collections claimed in the same transaction): `pos_collected` to their `customer_withdrawable`, then a customer payout to their settlement bank account (`CustomerPayoutsService.create`, chased by the payments job like any payout). Anything stopping the payout (no account chosen, a check, an amount below the market's minimum payout) keeps it in their Udozo payouts with why (`kept`), the owner told (`customer.pos.settlement`) and, live, finance and operations (`admin.pos.settlement_kept`). An admin's hold stops it until released.
- **Not built in this milestone (later):** accounts for one sale (dynamic, where a gateway offers them); part payments and over-payments matched at the till; refunding a transfer-paid sale to the payer (Udozo has no account of theirs: the shop pays it back itself, as for cash); deactivating the account at the gateway on closing; a PDF statement (the statement page prints, or saves as a PDF from the browser); public holidays.
- **pos.udozo.com:** **Payments** (`/app/collections`: collected and when it is paid, where it is paid, each till's account with Get an account number (and the BVN where asked) or Close, and in the sandbox Send a test transfer; transfers not matched with Use for … and Keep it; settlements; recent transfers) and each settlement's statement (`/app/collections/settlements/<id>`, printable); the till's **Udozo account** method where its till has an open account.
- **admin.udozo.com:** POS > **Collections** (`/pos/collections`: every transfer by state with its fee, and finance's fee per market, step-up) and each account's **Collection accounts** card (its tills' accounts with tries and the gateway's last error, what is unsettled, settlements, and Hold settlements (finance or operations) or Release the hold (finance, step-up), audited `pos.settlements_held|released`, `pos.collection_fee_changed`).
- **Tests:** `apps/udozo-api/test/pos-collections.test.mjs`, `apps/udozo-pos/test/collections.test.ts`, `apps/udozo-pos/test/collection-screens.test.tsx`, `apps/udozo-admin/test/pos-collections.test.tsx`.

**Milestone 5, staff, roles and tills, is built (11 November 2026)** (screens S6 to S8 and S19):
- **Data** (migration `20270320000000_pos_staff`): `pos_roles` (the owner's own roles), `pos_staff` (a fixed role's key or an own role; one live member per account and phone), `pos_staff_tills` (where they work, or every till), `pos_invites`, `pos_devices` (a till's linked devices), `pos_sessions` (staff's), `pos_approvals` (managers' approvals); sales, refunds, stock changes, wallet and transfer requests record who did them (`sold_by_staff_id`, `refunded_by_name`, `refunded_by_staff_id`, `by_staff_id`). Only hashes of tokens, codes and PINs are kept (PINs with Argon2id).
- **Roles** (`apps/udozo-api/src/pos/permissions.ts`): fourteen permissions (sell, refund, till, stock_view, stock_adjust, prices, own_sales, all_sales, cash_up, export, customers, transfers, staff, settings), each `yes`, `approval` (with a manager's PIN at the till) or `no` (`staff` is `no` or `cashiers`), and a discount limit. The fixed roles follow the design's matrix: **Manager** (everything but exports, any discount, invites and manages cashiers), **Cashier** (sells, refunds with approval, their own sales, customers; 5% discount), **Stock keeper** (stock, never selling), **Accountant** (every sale, cash-up and exports, never selling or changing stock). The owner makes their own (`POST|PATCH|DELETE /v1/pos/owner/roles`, `role_in_use` while someone has it). The owner is never a member of staff and can do everything.
- **Invites** (`PosStaffService.invite`): the owner, or a manager for cashiers, invites by name, the shop's market's mobile number, role and tills, within the plan's staff limit (`plan_limit_reached`; `staff_exists`): by SMS through the market's provider, or a WhatsApp link to send from their own phone (`whatsapp_url`); the link (`<POS_URL>/invite#t=upi_…`, 48 hours, once) sets a four-digit PIN (`pin_too_easy` for one digit, a run or a year). Resend gives a new link (an active member's PIN is reset); suspend, restore and remove end their sessions at once.
- **Signing in** (`POST /v1/pos/staff/sign-in { shop_code, phone, pin, till_id? }`, on the strict per-address limit): five wrong PINs lock the member for 15 minutes (`pin_locked`; each try claimed before the PIN is compared, so parallel guesses never get more); the session (`ups_`, header `udozo-pos-session`) ends after 12 hours idle, at sign-out, or when they are suspended, removed or their device unlinked. A staff session is never a customer session: `PosGuard` reads only its own header, every staff route names its permissions (`@PosAllows`), a route naming none is refused, and none reaches the wallet, payouts or a customer's account.
- **Devices** (S19): the owner or a manager makes a one-time code for a till (`POST /v1/pos/owner/tills/:id/devices/link-code`, `XXXX-XXXX`, 10 minutes, with a QR opening `/link#c=`); the device sends it (`POST /v1/pos/devices/link`) and keeps its token (`upd_`, header `udozo-pos-device`); on it, the till's staff tap their name and type their PIN (`GET /v1/pos/device`, `POST /v1/pos/device/sign-in`), and it sells only at that till. Unlinking (`POST …/devices/:id/unlink`) signs out whoever is on it.
- **Manager approval:** a refund, a bigger discount or a stock change a role may do only with approval is refused (`approval_required`) until a manager on the shift types their PIN at the till (`approval { staff_id, pin }` in the same request, checked as a sign-in, wrong PINs counting towards their lock); a discount may then go up to the approver's limit. Each is recorded (`pos_approvals`, audited) and listed for the owner (`GET /v1/pos/owner/approvals`).
- **What staff see** (`/v1/pos/staff/*`, the same work as the owner's routes within their role): cashiers only their own sales and their tills, managers their cashiers, accountants every sale; `GET /v1/pos/staff` (`me`) gives their role, tills, permissions and the managers who can approve.
- **pos.udozo.com:** `/signin` takes the shop code, phone and PIN beside Continue with Udozo; `/signin/till` on a linked device (names as tiles, the PIN pad); `/link` and `/invite`; the staff session in `udz_pos_staff` (host-only, httpOnly, 12 hours) and the device in `udz_pos_device` (a year), the browser never calling the API (`posApi` sends shared calls to the owner's or staff's routes). `/app` follows the role (`currentPos`: the menu, Home, the Till at the device's till, Sales, Products, Customers; billing, setup and Payments the owner's only), **Staff** (`/app/staff`: invite, the list with resend, suspend, restore, remove, and the roles matrix with the owner's own roles), Devices on Setup, the approval box on the till, refunds and stock changes, and Switch user on a linked till.
- **admin.udozo.com:** each POS account's **Staff and devices** card (`GET /v1/admin/pos/accounts/:id/staff`: staff with role, tills and status, the owner's own roles, linked devices, managers' approvals; read only, no PIN ever shown).
- **Tests:** `apps/udozo-api/test/pos-staff.test.mjs` (a test for every cell of the matrix per role, invites, lockout, devices, approvals, and that no staff session reaches a customer route), `apps/udozo-pos/test/staff.test.ts`, `apps/udozo-pos/test/staff-screens.test.tsx`, `apps/udozo-admin/test/pos-staff.test.tsx`.
- **Not built in this milestone (later):** signing in offline (milestone 9); the Android and iOS apps. (Shifts and cash-up came with milestone 7.)
- **Legal:** the shop is the employer and controller of its staff's records (name, mobile, what they did); the privacy notice and the POS terms must say Udozo holds them for the shop.

**Milestone 6, receipts, is built (11 November 2026)** (screens S9 to S13):
- **Data** (migration `20270321000000_pos_receipts`): the shop's `email`, its own bank account for later payments (`bank_name`, `bank_account_name`, `bank_account_number`; printed on invoices, never used by Udozo), `receipt_qr` (printed receipts carry the WhatsApp QR code, on by default) and `invoice_next`; a sale's `invoice_number` (`INV-2026-0148`, given the first time its invoice is drawn, the shop's next under the sale's row lock); `pos_receipt_codes` (a code's hash, the sale, kind, `purpose` `screen` 10 minutes, `print` 30 days from the last print, `whatsapp` 7 days, uses and where it went, masked) and `pos_receipt_sends` (WhatsApp, `qr` or email, masked, by whom, the WhatsApp message whose state is read live).
- **PDFs** (`receipt-pdf.ts`, pdfkit, drawn when asked for and never stored): the 80 mm or 58 mm till receipt (one page as tall as it needs, measured then drawn; a gift receipt hides prices and payments; amounts with the currency's code, as the printers' fonts lack ₦) and the A4 invoice (bill to, the invoice and the sale, lines with SKUs, how it was paid, what is still owed on credit, PAID, PART PAID, UNPAID or REFUNDED, the shop's bank account, the QR code, page numbers). The cashier prints as first name and initial; the shop's udozo.com seller page as Shop online.
- **On WhatsApp** (`PosReceiptsService`): the customer sends `RECEIPT POS-000123-<code>` to Udozo's number (the receipt's QR code fills the words in, through `wa.me`), and the bot (`WhatsappReceiptsHub`, which the POS registers with, so WhatsApp never imports the POS) answers with the PDF uploaded to Meta (the `document` message type, never a public link) and a **Send the A4 invoice** button (`rinv:<code>`); sending the words opts the number in; a wrong, expired or overused code (20) is answered in words. To a number the cashier types (the shop's country's mobile; `phone_wrong_country`, `whatsapp_opted_out`): the PDF at once inside WhatsApp's 24-hour window, else the new utility template **`udozo_pos_receipt`** (submitted from Site > WhatsApp) whose **Get receipt** button (`rcpt:<code>`) brings it. Only where WhatsApp is open in the shop's country (`whatsapp_unavailable` otherwise).
- **By email:** the receipt, the invoice or both attached as PDFs (`EmailMessage.attachments`, Resend's and MailerSend's `attachments`), in the shop's name through Udozo's email (`posReceiptEmail`). `save_to_customer` keeps a number or email on the sale's customer who has none (staff need the customers permission). At most 10 sends a sale a day (`receipt_send_limit`).
- **Routes** (owner `/v1/pos/owner/…`, staff `/v1/pos/staff/…` for the sales they may see, `own_sales` or `all_sales`): `GET sales/:id/receipts`, `GET sales/:id/receipt.pdf?kind&width&gift`, `POST sales/:id/receipt-codes`, `GET sales/:id/receipt-codes/:code`, `POST sales/:id/receipt/whatsapp`, `POST sales/:id/receipt/email`; the shop's new fields on `PATCH /v1/pos/owner/shops/:id`.
- **pos.udozo.com:** the receipt screen (`/app/sales/<id>/receipt`, `ReceiptShare`): the receipt as it prints beside how the customer wants it: **Scan a QR code** (shown at the till, asked every 3 seconds until delivered), **Send to WhatsApp**, **Email** (receipt, invoice or both) and **Print** (the till's paper or the other, a gift receipt, Download PDF, the A4 invoice), and what was sent; reached from each sale (resending from history) and from the till once a sale is done, which also prints by itself where the till's **Print each receipt** is on (a hidden frame of `/print/<id>?auto=1`). `/print/<id>` is the receipt alone for the browser's print (`@page` at the paper's width); `/app/sales/<id>/pdf` passes Udozo's PDF on with the session at the till, never cached. Setup's shop form takes the email, bank account and the QR code choice.
- **Tests:** `apps/udozo-api/test/pos-receipts.test.mjs`, `apps/udozo-api/test/pos-staff.test.mjs` (staff's receipts), `apps/udozo-api/test/whatsapp.test.mjs` (the template), `apps/udozo-pos/test/receipts.test.ts`, `apps/udozo-pos/test/receipt-screens.test.tsx`.
- **Not built in this milestone (later):** printing straight to Bluetooth or USB printers (the apps, milestone 9); WhatsApp receipts sent offline (queued on reconnect, milestone 9); a template being sent at most once an hour per number, so a second receipt to the same number within the hour is shown as not sent (they scan its code instead); checking a receipt at udozo.com/verify.
- **Legal:** the privacy notice must say the customer's number or email typed at the till is used to send the receipt (by Udozo for the shop, through Meta or the email providers), kept masked on the sale, and the shop is the controller; the POS terms that receipts and invoices are the shop's, which handles its own tax and VAT on them; lawyers to confirm what a valid receipt or invoice must show in each market.

**Milestone 7, the overview, shifts and cash-up, end of day and exports, is built (11 November 2026)** (screen S2 and the shifts the plan names):
- **Data** (migration `20270322000000_pos_shifts`): `pos_shifts` (a till's shift: opened by whom with its float, closed by whom with the cash expected, counted and the difference, and its totals kept as they were; one open a till, a partial unique index) and `pos_shift_cash` (cash paid in or out with why); `pos_sales.shift_id` (the till's open shift when the sale was rung up) and `refund_shift_id` (when its refund was paid out), set in the sale's own transaction (`openShiftOf`, a share lock the close's update lock waits for, so a sale is counted in the shift or left out of it, never lost). Sales need no shift.
- **Shifts** (`PosShiftsService`): open with the cash in the drawer (`shift_open` while one is), cash paid in and out with why, and close with the count: expected is the float plus cash taken less cash refunded plus paid in less paid out; the difference is counted less expected (`shift_closed` after). Staff open, pay in and out and close with `till`; without `cash_up` they count **blind** (never the cash expected, the difference or the cash figures), and the owner and managers see whether it balanced. Staff reach only their tills (a linked device, its own).
- **The overview** (`PosReportsService.overview`, `all_sales`): today so far against the same weekday a week before to the same time, the last 7 or 30 days or two dates against as many days before, in the shop's own day (`periodRange`); the shop's completed sales beside the owner's udozo.com sales (`classified_purchases`, UdozoPay orders and buy orders, in the shop's currency): sales, transactions in the shop and online, the average basket, items, refunds; by the hour (a day) or by the day; the channel split and the shop's payment methods; top sellers across both; the latest eight sales; and what needs restocking (out of stock or at the reorder level, with the last 7 days' sales a day and the days that leaves).
- **End of day** (`cash_up`): a day's takings (gross, discounts, VAT, takings), by payment method, till and member of staff; refunds made that day; the net; items and top products; the shifts opened that day with their count; udozo.com's sales that day; as JSON and as a PDF (`report-pdf.ts`).
- **Exports** (`export`): a period's sales (one row a sale) or every item sold (one a line) as CSV for the bookkeeper (the shop's local time, amounts to two decimals, a byte-order mark for Excel, cells that would run as formulas defused, at most 50,000 rows, `export_too_large`), and its summary as a PDF (takings, by method, by day with VAT, the shifts' cash, top products); at most 366 days (`range_too_long`).
- **Routes** (owner `/v1/pos/owner/…`, staff `/v1/pos/staff/…`): `GET shifts`, `GET shifts/current?till_id`, `POST shifts`, `GET shifts/:id`, `POST shifts/:id/cash`, `POST shifts/:id/close`, `GET reports/overview?period&from&to&shop`, `GET reports/day?date&shop`, `GET reports/day.pdf`, `GET reports/sales.csv?from&to&shop&detail`, `GET reports/summary.pdf?from&to&shop`.
- **pos.udozo.com:** **Overview** (`/app/overview`: Today, 7 days, 30 days or two dates; the four figures with how they moved in words; sales by the hour or day, the shop's and online in each bar, every figure in a table for screen readers; channel and payment; top sellers; recent sales; needs restocking), **Shifts** (`/app/shifts`: each till's shift to open, pay in and out, count and close, asking first; the closed shifts with how each counted; `/app/shifts/<id>` its report, printable), **Reports** (`/app/reports`: end of day with its PDF, and the accountant's exports), a shift bar on the till, and each in the menu as the role allows. Files come through `/app/reports/file`, never cached.
- **Tests:** `apps/udozo-api/test/pos-reports.test.mjs` (the shift's cash, sales racing a close, blind counts and each role, the overview with online sales and last week, end of day, CSV and PDFs, the helpers), `apps/udozo-pos/test/reports.test.ts`, `apps/udozo-pos/test/shift-screens.test.tsx`.
- **Not built in this milestone (later):** counting by notes and coins; a manager signing off a short count; shifts offline (milestone 9); reports per shop beyond the `shop` filter (milestone 8); scheduled emails of the end of day.
- **Legal:** the shop's records of its sales, shifts and staff are the shop's; the POS terms must say the reports are an aid for the shop's own books and tax, not accounts prepared by Udozo.

**Milestone 8, several shops and yearly billing, is built (11 November 2026):**
- **Data** (migration `20270323000000_pos_multi_shop`): `pos_stock_levels` (a listing's level in each shop), `pos_stock_transfers` (`ST-000123`, from and to a shop or online, the lines as moved), `pos_shops.fulfils_online` (one an account, a partial unique index; the first shop to begin), movements `transfer_in` and `transfer_out` with their transfer; `pos_plans.yearly_prices`, `pos_accounts.billing_interval` and `next_interval`, `pos_charges.interval`; and the trigger `pos_clamp_stock_levels` on `classified_listings`.
- **The split** (`stock-levels.ts`): from a second shop (`addShop` runs `startSplit`: every product at the till has its stock in the first shop, so nothing changes there) each listing's stock is split: each shop's level, the rest online. A till sells only its own shop's level, less what online buyers hold beyond the online level when it is the shop fulfilling online orders (`freeAtShop`; `stock_short` "at this shop"); sales, refunds, restocks, counts and damage move the shop's level with the stock in one transaction (`shop_id` required, `shop_required`), the level first when stock goes down. **Stock going down anywhere else** (an online sale, the seller lowering it on udozo.com) is taken by the database trigger from the online level, then the shop that fulfils online orders, then the others, so the levels never pass the stock.
- **Transfers** (`PosStockTransfersService`, `POST|GET /v1/pos/owner/stock-transfers`, staff with `stock_adjust`, reading with `stock_view`): between shops or a shop and online, the listings locked, no more than the place leaving can spare (`stock_short`), the stock itself unchanged; only with several shops (`single_shop`).
- **Shops on a plan:** the owner makes a shop main (first) or the one fulfilling online orders (`PATCH /v1/pos/owner/shops/:id { main | fulfils_online }`, never staff); shops past the plan's shop limit **pause** (`paused`; their tills refuse sales, `shop_paused`), so a Multi-shop account that drops to a one-shop plan keeps its main shop selling, nothing deleted.
- **Yearly billing:** finance sets yearly prices per currency beside the monthly ones (admin POS > Plans and prices; a yearly price needs the monthly one); owners sign up and change plan monthly or yearly (`interval`; `interval_unavailable` where there is no yearly price). A dearer plan (by its monthly price) or monthly to yearly is charged now less what is unused; a cheaper plan or yearly to monthly takes over when the paid period ends; renewals follow `next_interval`, falling back to monthly where a yearly price was taken away.
- **Reports per shop:** the overview's `by_shop` and its shop filter (the API already took `shop`).
- **pos.udozo.com:** Shop and tills' **Your shops** (`ShopsPanel`: Main shop, Fulfils online orders and Paused badges, Make main, Fulfil online orders, Open a shop with what the split means), the till's own shop's stock and a paused notice, Products' levels per shop, Change stock for one shop, **Move stock** (`/app/products/move`, `MoveStock`) with the latest moves, Monthly or Yearly on sign-up and Billing (the saving on twelve months), and the overview's shops.
- **Tests:** `apps/udozo-api/test/pos-multi-shop.test.mjs` (yearly sign-up, changes and renewals; the split, transfers, refunds and counts; the trigger; paused and main shops; staff; per-shop takings), `apps/udozo-pos/test/multi-shop.test.tsx`, `apps/udozo-pos/test/multi-shop-actions.test.ts`, `apps/udozo-admin/test/pos.test.tsx` (yearly prices).
- **Not built in this milestone (later):** closing a shop; transfers in transit (a shop sending and the other receiving later); per-shop prices; offline (milestone 9).

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
4. **Udozo collection accounts and next-day settlement:**
   - the POS admin dashboard's Collection accounts page: request, see and close each till's account, and choose the settlement bank account;
   - per-sale accounts where the gateway offers them, and per-till static accounts otherwise, opened through `PaymentsService` as reserved accounts are;
   - the gateway's notifications, re-read and credited once, paying the waiting sale at the till automatically; Unmatched transfers to attach or refund;
   - the daily settlement job and its statement, the collection fee, and Collections in admin.udozo.com.
5. **Staff, roles, tills (S6–S8):**
   - matrix and custom roles, invites by WhatsApp or SMS, PIN set-up;
   - till sign-in, lockout, manager approval, device linking (S19);
   - a role test for every cell of the matrix.
6. **Receipts (S9–S13):**
   - 80 mm and 58 mm receipts and A4 invoice (pdfkit, plus print CSS for browser printing);
   - share screen with a QR (`wa.me/<Udozo number>?text=RECEIPT POS-…-<token>`), the bot replying with the PDF;
   - email with the PDF attached;
   - resend from history.
7. **Overview and reports (S2):**
   - totals, an hourly POS-versus-online chart, payment mix, top sellers, restock list;
   - shifts and cash-up, end of day;
   - CSV and PDF exports for the accountant.
8. **Multi-shop:** several shops, the stock split between them with transfers, online orders fulfilled from the chosen shop, and reports per shop. Also upgrading and downgrading between the three plans, and yearly billing. (The plan limits themselves, `posLimit`, come in milestone 1.)
9. **Offline and apps (S5, S19):**
   - selling with no internet, as above: the device's copy, offline PIN sign-in, the outbox and in-order upload, oversold and flagged sales, the 72-hour or 500-sale limit, in the web app first (IndexedDB, service worker);
   - then Expo (camera, Bluetooth ESC/POS) and Tauri (USB printers, cash drawer);
   - **Windows (decided 11 November 2026): Tauri 2, published only through the Microsoft Store, at no cost.**
     - The app carries the till's screens inside it (a client-only build), so it starts with no internet; it runs on WebView2, built into Windows 10 and 11 (Windows 10 is the minimum).
     - Its Rust side keeps the encrypted SQLite store, prints raw ESC/POS through the Windows print spooler (USB thermal printers installed as Windows printers, COM ports, network printers on port 9100) with no print dialog, opens the cash drawer with the printer's kick command, and runs one copy at a time, full screen and starting with Windows. USB barcode scanners type like a keyboard and need nothing.
     - **Distribution is the Microsoft Store only, as an MSIX package.** Registering Udozo's company developer account is free (since May 2026; individuals since September 2025), and the Store signs the package, so no code-signing certificate is bought and there is no SmartScreen warning. There is no direct installer download from pos.udozo.com: an unsigned one would be warned off by Windows.
     - The app is free in the Store with no in-app purchase through Microsoft. The POS plan is paid from the Udozo wallet on pos.udozo.com, which the Store allows for non-game apps, so Microsoft takes no commission. Updates come through the Store and are applied between sales.
   - setting each app's store link in admin turns its Coming soon button on pos.udozo.com into a download.

## Legal owed before `pos` goes on anywhere

- POS terms: the shop is the seller at its till, Udozo provides the software, and the shop handles its own tax and VAT on receipts.
- **Udozo collection accounts:** lawyers' advice per market before `pos_collections` goes on. Udozo collects money in its gateway accounts on a shop's behalf and pays it out the next day, which may be payment facilitation or collection needing a licence or the gateway's sub-merchant approval. The gateways' written approval of the model is also needed, and the shop terms must cover collection, the fee, next-day settlement, holds and refunds.
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
3. **Store accounts:** Apple, Google Play and a free Microsoft Store company developer account under Udozo's name (verified with its business documents; no code-signing certificate needed), all by milestone 9 only.
