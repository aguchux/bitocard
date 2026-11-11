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
  - `pos_collection_accounts` (shop, till or one sale, provider, reference, account number, bank, name, kind `static` or `sale`, amount and expiry for `sale`, status);
  - `pos_collections` (account, provider transaction, amount, sender's name, sale, status `matched`, `unmatched`, `refunded`, fee);
  - `pos_settlements` (account, day, amount, fees, bank account, transfer reference, status `pending`, `paid`, `failed` or `held`);
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
- the public site in `app/(site)`, on the POS's own header and footer: `/` (`PosLanding`: hero with the till as a labelled illustration, three steps, features with those not built yet marked Coming soon, the apps band, plans, questions), `/pricing`, `/download` (each app's button Coming soon until its store link is set; Windows only ever the Microsoft Store), `/signin` (two doors: Continue with Udozo, `/signin/udozo`; staff marked Coming soon until milestone 5), `/signup` (connect, then the shop with its VAT, the plan, and what is due today from the wallet, Pay blocked with Add funds on udozo.com when short; Free and trials take nothing); robots and the sitemap keep only `/`, `/pricing` and `/download` indexed;
- the owner's `/app`, behind Continue with Udozo and sign-up: home (where the plan stands, limits, what to do next), `/app/setup` (shop details and tills within the plan's limit, counted across shops), `/app/billing` (the wallet, changing plan confirmed in Udozo POS's own dialog with what it does, the charges);
- Udozo's icons (`scripts/brand-assets.py` lists `udozo-pos`), the theme above as `pos-*` colours;
- tests: `apps/udozo-pos/test` (31: the words and figures, signing in and the handoff, every action's route and body, the public reads, robots, the sign-up wizard, plan changes, tills and the public pieces); every public page checked at 320, 360, 390 and 1280 px with no sideways scrolling.

**Milestone 1: still to do, in order:**
1. **pos.udozo.com is deployed (11 November 2026):** Vercel project `udozo-pos` in the De-Golojan Team (root `apps/udozo-pos`, skip-unchanged, `VERCEL_DEEP_CLONE`), `pos.udozo.com` a DNS-only CNAME in udozo.com's Cloudflare zone, its certificate issued by hand (`vercel certs issue`) as connect's was. Still owed: `STORE_SERVER_SECRET` on the project, the same value as `udozo-api`'s.
2. **Windows:** `apps/udozo-pos-windows`, a Tauri 2 shell with `src-tauri` (`tauri.conf.json`, `Cargo.toml`, `main.rs`): it opens pos.udozo.com in its own window for now (bundled screens and offline come in milestone 9), allows one copy at a time, builds an MSIX for the Microsoft Store, and works on Windows 10 or later. Rust is not installed on the owner's machine, so build it in CI (`windows-latest`, `tauri-apps/tauri-action`). Test the config with a Node test.
3. **admin.udozo.com > POS is built (11 November 2026):** the POS section (`apps/udozo-admin/app/(console)/pos/`, words in `components/pos.tsx`): **Accounts** (`/pos/accounts`: found by shop, shop code, owner's name or email, by market and plan, each with where its plan stands; `/pos/accounts/<id>`: the plan, its limits and month, the owner linking to their customer page, each shop with its code, VAT and tills, and the charges), **Plans and prices** (`/pos/plans`: each plan's prices per market currency, limits, trial and whether it is offered; finance changes them in one dialog after step-up, an empty price leaving that currency unpriced and an empty limit unlimited, Free always limited and offered, checked before sending by `planChange`) and **App links** (`/pos/apps`: each store page, operations set or clear it, the API's refusal shown in words; others read). Hooks in `@bitocard/api-client/admin` (`udozo-pos.ts`; tags `PosAccounts`, `PosPlans`). Tests: `apps/udozo-admin/test/pos.test.tsx`.
4. **AGENTS.md:** the Udozo POS entry says what is built (done for the API and the web app); add the deployment once it is live.
5. **Legal:** POS terms (`/legal/pos` on udozo.com) before the switch goes on.

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
