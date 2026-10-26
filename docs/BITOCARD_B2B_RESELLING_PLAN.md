# B2B reselling: plan

**Status:** plan, 26 October 2026; the owner's decisions recorded the same day, including the security rules and proposals A, B and C (see Decisions). **Stage 1 built 26 October 2026** (commits `354016c`, `3bddb55` and the terms and docs after them; see its section). Where this plan and `AGENTS.md` differ, `AGENTS.md` wins until this plan is built and merged back into it.

## The idea in one paragraph

A BitoCard Shop seller (a bitocard.com customer) can open a listing to resellers, on BitoCard Shop as well or not, as they choose: they set their price, the discount resellers earn and how far above their price a reseller may sell, inside limits BitoCard sets. A reseller opens a store on the new **Resale shop** template, browses the resale listings of suppliers in their own country, adds the ones they want at their own price and sells them on their store, with its own domain, design and home page. Suppliers and resellers know each other: the supplier's **My Resellers** tab lists every reseller carrying their listings, with a chat and open phone numbers between them, and the special deals they agree there. A store customer buys from their store wallet: the money is locked, the supplier accepts, then it goes to BitoCard's Safe pay escrow, never to the reseller; the supplier hands the item to the buyer directly (meet-up with a release code, or delivery); once released, the supplier, the reseller and BitoCard are each paid automatically.

**Security first.** A reseller can never pose as the item's owner: nothing they write reaches a listing unless the supplier approves it, every listing on their store names its supplier, and the buyer can open the supplier's own page right on the reseller's store. During an order the buyer talks to the store: supplier and reseller both write in the order chat, every message reaching the buyer as from the reseller's store, and both see all of it; supplier and reseller also talk in the order's trade thread, which the buyer does not see. The supplier has the buyer's details to deliver, and the item travels by tracked shipping or is handed over in person, so it arrives in one piece and everyone gets paid.

## What exists today (facts this plan builds on)

- **A listing is one item.** `ClassifiedListing` has no quantity or stock; one paid Safe pay order sells the listing (a partial unique index allows one holding order per listing, and release marks it `sold`).
- **Safe pay** (`safe-pay.service.ts`): `requested` → `awaiting_payment` → `paid` → (`released` by release code at a meet-up | `sent` → `received`/auto-released) or `refunded`, `partly_refunded`, `disputed`, `lapsed`, `cancelled`. Deadlines run in the `classifieds` job every 15 minutes. Money: buyer's `customer_wallet` → `classified_escrow` (price + buyer fee) → on release the seller's `customer_withdrawable` (price − seller fee) and `classifieds_revenue` (both fees); refunds go back to the buyer's wallet. Fees, timers, the new-seller limit and the strike limit are per country in `ClassifiedSafePaySettings`. Guards: same person (KYC fingerprint, name and birth date, bank account), strikes, new-seller order limit, payout review of reversible top-ups, the payout hold before withdrawal.
- **Shop is closed to reseller stores on purpose**: `ListingsService.sellerCountry` accepts only bitocard.com accounts, and Safe pay's buyers and sellers are bitocard.com customers.
- **The `b2b` category flag** exists (Business and industrial, "for businesses (wholesale)") but nothing depends on it. `docs/BITOCARD_CLASSIFIEDS_PLAN.md` Phase 2 sketches wholesale buying on Shop (minimum quantities, price tiers, request for quote); that stays separate (see "Not in this plan").
- **Reseller stores**: templates in `src/stores/templates.ts` (what a store sells, its sections, variants, themes, a `store_template_<key>` switch each); store customers are per store; per-store domains, plans and the home page editor (`StoreHomeService`, `HomeEditor`) are template-aware. A reseller's margin reaches them through `WalletService.creditEarnings` into `reseller_earnings_held`, released after the country's payout hold. The Markup Protection Scheme caps resellers' markups per country (`markupCapPercent`), enforced in the API.

## Who does what

| Party | Account | Does | Gets |
|---|---|---|---|
| **Supplier** (seller of record) | bitocard.com customer, identity checked, payout account set | Opens a listing to resellers (Shop too or not); sets price, reseller discount and markup limit; agrees deals with resellers; approves resellers' notes; accepts orders; sees the buyer's details; ships with tracking and dispatch photos, or hands the item over in person; enters the release code or marks it shipped; writes to the buyer as the store and to the reseller in the trade thread | Their price less the reseller's discount, less BitoCard's supplier fee, into `customer_withdrawable` (withdrawable after the payout hold) |
| **Reseller** | SHQ reseller, verified (KYB), on a store with the Resale shop template, any plan | Picks listings, sets their price within the limits, runs the store (design, domain, marketing, first-line support), is the buyer's only contact during an order and relays between buyer and supplier | Their price less the supplier's net, less BitoCard's capped reseller fee, into `reseller_earnings_held` → `reseller_earnings` after the payout hold |
| **Buyer** | Customer of the reseller's store | Buys from their store wallet, can open the supplier's page before buying, talks to the reseller, meets the supplier or receives the delivery, releases | The item, or their money back to their store wallet |
| **BitoCard** | Payment holder | Locks and holds the money, enforces the rules, runs deadlines, decides disputes | Buyer fee, supplier fee and reseller fee (each capped) into `classifieds_revenue` |

## Prices

The supplier sets, per listing: **price P**, **reseller discount D** and **markup limit M**. BitoCard's guards per country (optionally per category; admin Shop > Settings > Resale): D from a minimum (so reselling is worth it, e.g. 5%) to a maximum (e.g. 50%); M from 0 to a maximum, never above the country's Markup Protection Scheme cap.

- **The reseller's price S runs from P to P × (1 + M).** P is the floor: no reseller undercuts the supplier's own price.
- **Deals.** In the My Resellers chat the supplier can offer one reseller better terms: a bigger discount (up to BitoCard's maximum), and with it a lower floor (down to P × (1 − their discount), so the reseller may pass some of their discount on). A deal is an offer the reseller accepts in the chat, recorded on the platform (`ResaleDeal`: supplier, reseller, all listings or one, discount, floor, from and until); it applies to new orders only and either side can end it.
- **The reseller's price follows P.** It is stored as a markup over P (basis points), so a price change at the supplier carries through; a fixed price is allowed and is checked against the limits again whenever P or a deal changes (outside them, the store listing pauses until repriced and the reseller is told).
- The API enforces every limit when a price is set and again at checkout (`resale_price_out_of_range`).

**Worked example.** P = ₦100,000, D = 10%, M = 30%: the supplier's net before fees is ₦90,000 and the reseller may sell at ₦100,000 to ₦130,000. The reseller sells at **₦115,000**: their margin is ₦25,000, less the reseller fee; the supplier receives ₦90,000, less the supplier fee; the buyer pays ₦115,000 plus the buyer fee. With a deal at 15% (floor ₦85,000), the same sale gives the supplier ₦85,000 and the reseller ₦30,000.

## Buying: lock, accept, then debit

Resale orders are paid only from the buyer's store wallet (topped up through BitoCard's gateways; the reseller's own gateway is never offered on a Resale shop).

| Step | Status | Money (ledger reference `classified_order:<id>:<step>`) |
|---|---|---|
| Buyer buys (instant: no request or negotiation) | `locked` | `customer_wallet` → `customer_wallet_locked` (still the buyer's, shown as locked in their wallet): S + buyer fee. Stock is held. |
| Supplier accepts (within the accept window); the buyer's details open to them | `paid` | `customer_wallet_locked` → `classified_escrow`; the hand-over deadline starts; for a meet-up the buyer gets the release code |
| Supplier declines, or the accept window passes | `declined` / `lapsed` | locked → back to `customer_wallet`; stock freed; a lapse counts towards the supplier's strikes |
| Buyer cancels before acceptance | `cancelled` | locked → back to `customer_wallet` |
| Released (code, received, or the confirm window passes) | `released` | escrow → supplier's `customer_withdrawable` (net − supplier fee), reseller's `reseller_earnings_held` (margin − reseller fee, an earnings lot), `classifieds_revenue` (all fees) |
| Refunded (not handed over in time, cancelled after acceptance, dispute) | `refunded` | escrow → `customer_wallet`, everything |
| Partly refunded (dispute) | `partly_refunded` | the refund to the buyer first; the rest split between supplier and reseller in proportion to their shares, each paying their fee on what they receive |

## Fulfilment: delivered in one piece, so everyone gets paid

The goal is that the buyer receives the item safely and whole; only then is anyone paid. The supplier, as seller of record, is responsible for the item until the buyer has it. The same fulfilment serves every Safe pay order, BitoCard Shop's and resale.

**Two ways, chosen by the supplier per listing (one or both), the buyer picking one at checkout:**

1. **Shipping with tracking** (a solid option, not a note):
   - The supplier ships by courier within the hand-over deadline and marks it shipped with the **courier** (from the country's list, or Other with its name), the **tracking number** (required) and the tracking link (https, checked against the courier's own site where known).
   - **Before shipping**, the supplier adds **dispatch photos**: the item and the sealed parcel (at least two). They show what was sent and in what state, for any dispute about damage.
   - **Tracking timeline** on everyone's order page: shipped, in transit, out for delivery, delivered, each with its time. The supplier updates it by hand; where BitoCard has a courier integration, the courier's own updates come in automatically (couriers behind one `CourierAdapter` interface, as suppliers are; which couriers per country to confirm with each, API and terms, before building).
   - **Delivered:** the buyer checks the item and confirms it arrived in good condition (releasing the money), or reports a problem with photos within the confirm window, which opens a dispute. With neither, the money is released when the window ends. A parcel not delivered within the country's longest transit time lets the buyer open a dispute.
   - **Lost or damaged in transit** is the supplier's to put right (they chose and paid the courier); the dispatch photos, the tracking and the buyer's photos decide the dispute.
2. **Pickup or hand delivery:** the supplier and the buyer meet, at a place they agree or the buyer's address, and the supplier hands the item over in person. The buyer checks it there and gives the supplier their **release code** only when satisfied, which releases the money, as in Safe pay today.

**The supplier sees the buyer's details.** From acceptance, the supplier sees the buyer's full name, confirmed phone number, email and the delivery address, so they can call, ship and meet. The buyer gives a confirmed phone number at checkout. They are shown on the order only while it is open and for 30 days after it ends, each view is logged, and the terms forbid using them for anything but that order (no marketing, no selling to the buyer outside the reseller's store: a strike, and suspension if repeated). The reseller sees them too, as the store the buyer bought from.

**Delivery fee (proposal D below):** the supplier sets their shipping charge per listing (free, within their state, nationwide); the buyer pays it on top of the item, it goes to the supplier in full on release (never part of a reseller's discount or margin), and it is refunded with the order if the item is not delivered.

The order records every figure when the buyer buys (S, P, D or the deal, the supplier's net, the reseller's margin, each fee, its rate and cap), so later price, deal or rule changes never alter it. **Auto-accept** (proposed): a supplier may choose to accept resale orders automatically while the listing has stock, for a business on full autopilot; off by default.

## Trust and safety: security first

**The threat:** a reseller posing as the real owner or maker of the products, saying things about them the supplier never said, or taking the buyer off the platform. Every rule below is enforced by the API (never only hidden in an app), tested, and audited.

1. **The reseller never holds the buyer's money.** It is locked in the buyer's wallet, then held by BitoCard; the reseller is paid only on release. Resale orders are paid only from the store wallet; there is no other way to pay on a Resale shop.
2. **Nothing the reseller writes reaches a listing unless the supplier approves it.** There is no API or screen through which a reseller can set or change a listing's title, photos, video, condition, features, description, category, stock, location or delivery: a store listing has no such fields, and the store pages read them from the supplier's listing every time. The reseller's only words on a listing are one short **note** (at most 140 characters, plain text, no phone numbers, links or contact details, checked as Shop's listing text is): it shows only once the supplier approves that exact text; any edit goes back to the supplier; the supplier can withdraw an approval at any time. Each order keeps a snapshot of the listing and note the buyer saw.
3. **Every listing names its supplier, and the supplier's page is on the reseller's store.** Each listing card and page on a Resale shop carries "Supplied by <supplier>" (first name and initial, or their verified business name, with their badges), which no template, design, section or plan (white label included) can remove or restyle out of view. It links to the **supplier's page on the reseller's own store** (`/suppliers/<id>` there, rendered by the store, not a redirect): who the supplier is (verified identity or business, area, member since, completed sales, ratings, strikes standing), and this listing exactly as the supplier wrote it, so the buyer can check the reseller added nothing. The receipt and order pages name the supplier as the seller and the store as where it was bought.
4. **The store cannot claim the products as its own.** The Resale shop's free-text sections (about, features, FAQ, promos) are the reseller's own words about their store; the reseller terms forbid claiming to own, make or stock the items, and those texts are checked when saved for claims of ownership (an admin word list, as for Shop's prohibited words), refused or sent to review. Buyers and suppliers can report a store; an upheld report is a strike.
5. **Who talks to whom during an order.** Two threads per order, kept inside BitoCard:
   - **Order chat**, the buyer and the store. On the store's side **both the supplier and the reseller write**, and **every message reaches the buyer as from the store** (the store's name and logo; never who on its side wrote it). The supplier and the reseller each see the whole chat, with who wrote each store message. No links or payment details (bank accounts, card numbers, "pay me directly"), so nobody is asked to pay outside BitoCard; the buyer is told their order is already paid and never to pay anyone else.
   - **Trade thread**, supplier and reseller, about that order. The buyer does not see it.
   - Calls and meetings between the supplier and the buyer happen with the buyer's details above. BitoCard's support and dispute staff read both threads.
6. **Nothing sells that is not there.** Stock is shared by Shop and every reseller store; a listing that sells out, expires, is paused or removed leaves every store at once.
7. **BitoCard decides disputes**, not the reseller (the money is in escrow); supplier and reseller both add notes and evidence, and BitoCard reads both threads and the order's snapshot.
8. **Three-way same-person check**: supplier, reseller (its owner and team) and buyer must all be different people (KYC fingerprint, name and birth date, bank accounts), so nobody farms margins or fees with their own accounts.
9. **Strikes for resellers too**: disputes upheld because of the store's note or its claims, upheld reports, and resale orders the reseller's store cancels count towards a reseller strike limit; reaching it pauses the store's resale checkout until operations clear it.
10. **Supplier and reseller outside orders**: open, as decided: the My Resellers chat and each other's phone numbers, shown through the platform (both are verified and work together).
11. **The reseller's buyer stays the reseller's.** The supplier gets the buyer's details to deliver, not to sell to them: soliciting a reseller's buyer outside the store is a strike, and repeated, a suspension.
12. **Existing guards carry over**: the new-seller order limit, the payout review of reversible top-ups, the payout hold, the supplier's strikes and readiness (identity and payout account) before their listings can be resold.

## Autopilot

- **Listings stay in step by themselves**: store listings read the supplier's listing, never a copy; sold out, expired, paused or repriced listings change every store at once.
- **Deadlines and payments** run in the existing `classifieds` job: accept windows, hand-over and confirm deadlines, automatic refunds and strikes; earnings released after the hold by the existing `earnings` job.
- **Auto-listing rules** for resellers: "add every resale listing in Phones from verified suppliers at +15%", applied as new listings open; resellers can exclude suppliers or listings.
- **Auto-accept** for suppliers who want it (above).
- **Everyone is told**: supplier (new order to accept, hand-over due, a message in the trade thread, released, paid out, a reseller's note to approve, a deal offered), reseller (sale, accepted, a message from the buyer or the supplier, released, dispute, listing gone or paused, note approved or refused, deal offered or ended), buyer (locked, accepted, a message from the store, shipped with its tracking, each tracking update, out for delivery, delivered and asked to confirm, released, refunded), by inbox, push and email; the supplier also when the buyer writes, and both supplier and reseller at each tracking update.
- **API-first**: resellers can do all of it from their own systems (`/v1/resale/...`: browse, add and price, notes, deals, orders, webhooks `resale_order.*`), in the public OpenAPI document.

## Stages

Each stage ships behind switches that are off by default, with its tests (PGlite and Docker), docs and `AGENTS.md` lines in the same change.

### Stage 1: resale listings (API and the Shop tab): built 26 October 2026

**As built:** listing fields `on_shop`, `resale`, `resale_discount_bps`, `resale_markup_max_bps`, `resale_paused_at` and `stock` (migration `20270120000000_classified_resale_listings`: at least one channel, terms present when resale is on, stock 0 to 100,000, the one-holding-order index dropped); `ClassifiedResaleSettings` per country, defaults where unset (discount 5% to 50%, markup limit 30% never above the market's markup cap, reseller fee and cap unset, accept 24 hours, reseller strikes 3); `ResaleService` (`src/classifieds/resale.service.ts`: limits, availability, terms, supplier readiness); `GET /v1/classifieds/me/resale`; admin `GET/PUT /v1/admin/classifieds/resale-settings/:country` (finance, step-up, audited `classifieds.resale_settings_changed`) and Shop > Resale settings; `onShopWhere`/`isOnShop` in `rules.ts` on every Shop surface; Safe pay pays by locking the listing, claiming the order, then counting other paid orders against stock, and each release takes one unit (the last sells it); the Shop tab's Where to sell (`components/app/shop/resale-fields.tsx`) and My listings tags; the Shop terms section 9, Selling through resellers, with their version raised to 2026-10-26. Per-category limits are left for later. Tests: `apps/api/test/classifieds-resale.test.mjs` (PGlite and Docker's Postgres), `apps/storefront/test/shop.test.ts`.

- Listing fields: `channels` (`shop`, `resale`, or both), `resale_discount_bps`, `resale_markup_max_bps`, `resale_paused_at`, and `stock` (units; 1 for today's listings). A resale-only listing is never shown on BitoCard Shop: search, category pages, sitemap, showcase, category covers, the assistant's tools and Show phone leave it out. A listing on both sells from one stock.
- Stock for Shop orders too: the one-holding-order index becomes "held units never exceed stock" (checked with the listing row locked), and release marks the listing sold only when none is left.
- Guards: `ClassifiedResaleSettings` per country (discount min and max, markup max, reseller fee and cap, accept window, reseller strike limit), optional per category; admin endpoints and Shop > Settings > Resale.
- Who can open listings to resellers: switch `classifieds_resale` (global, country), identity-checked suppliers with a payout account, the Shop terms' new resale section accepted.
- Shop tab, Post an ad: "Sell on BitoCard Shop" and "Let resellers sell this", stock, the discount and markup limit (within the country's limits, with the worked sum shown live); My listings shows how many stores carry each listing and their sales.

### Stage 2: resellers, suppliers and My Resellers
- `ResaleListing` (store, listing, markup bps or fixed price, status `active` | `paused` | `gone`), per store, with no field for anything about the item itself; `ResaleNote` (the store listing's one note: text, status `pending` | `approved` | `refused` | `withdrawn`, who decided and when; only an approved note is ever served); `ResaleRule` for auto-listing.
- `ResaleRelationship` (supplier, reseller): made when a reseller first adds one of the supplier's listings; carries the chat (`ResaleMessage`: text, photos, deal offers) and each side's phone, shown to the other; either side can block.
- `ResaleDeal` (above): offered in the chat by the supplier, accepted by the reseller, ended by either.
- Reseller endpoints `/v1/resale/catalogue` (resale listings of verified suppliers in their country: category, words, price, supplier rating, condition, delivery), `/v1/resale/listings` (add, price, note, pause, remove), `/v1/resale/rules`, `/v1/resale/suppliers` (chat, deals); SHQ **Resale** section (Browse, My listings, Rules, Suppliers with their chats and deals, a price preview showing the margin).
- Supplier endpoints and the Shop tab's **My Resellers** (each reseller and store carrying their listings, their sales, the chat with phone numbers, deals offered and running, notes waiting for approval with Approve, Refuse and Withdraw, and Stop this store reselling my listings).
- Gates: switch `reseller_resale` (global, country, reseller), a verified (KYB) reseller with a Resale shop store. Every plan, Startup included; the existing plan features and limits (stores, domains, custom domains, AI and the rest) apply as they do today.

### Stage 3: the Resale shop template and its storefront
- Template `resale_shop` (three variants and their themes, `store_template_resale_shop` switch) selling resale listings instead of catalogue products: `StorefrontService.availability` and checkout learn a second kind of item.
- New sections: `listing_rail`, `listing_grid`, `resale_categories`, plus `features` and `faq`; the home editor, starter pages and previews as for every template.
- Pages on the reseller's store: category, search, listing (`/l/<ref>-<slug>`: the supplier's photos and facts, the reseller's price and approved note, "Supplied by <supplier>", how payment is protected, delivery or meet-up area), and the **supplier's page** (`/suppliers/<id>`: the supplier and this listing exactly as they wrote it), with the store's own SEO.
- The supplier line is part of the listing component itself, not a section: no template, variant, theme, home page layout or plan (white label included) can hide it; a test renders every variant and checks it.
- The store's free-text sections are checked when saved for claims of owning, making or stocking the items (admin word list; refused or sent to review).
- The store's wallets must be on and collected by BitoCard (`payment_collector` cannot be `own` on a Resale shop).

### Stage 4: buying, fulfilment and payouts
- Safe pay orders gain `kind` (`direct` | `resale`), `store_id`, `reseller_id`, the price figures, the deal used and `quantity`; the buyer of a resale order may be any store's customer. New status `locked`; new ledger account `customer_wallet_locked` (a customer account, never below zero).
- Lock, accept, then debit (above); auto-accept; fulfilment as in stage 4b; the buyer's details to the supplier from acceptance (logged views, 30 days after the order); the three-way release entry; partial refunds split in proportion; the three-way same-person check; reseller strikes.
- Two threads per order: the **order chat** (the buyer and the store: supplier and reseller both write, every store message shown to the buyer as the store's; both see everything, with who wrote each; links and payment details refused) and the **trade thread** (supplier and reseller; never shown to the buyer). Both kept like Shop chats (12 months after their last message), read by BitoCard's support and dispute staff, with photos as in Shop chats.

### Stage 4b: shipping and tracking (every Safe pay order, BitoCard Shop's too)
- Listing: the ways it is fulfilled (`shipping`, `pickup`, one or both) and the delivery fee (free, within the supplier's state, nationwide; proposal D). Checkout: the buyer chooses one, gives a delivery address for shipping and a confirmed phone number.
- Order: `shipment` (courier, tracking number, tracking link, shipped, delivered), **dispatch photos** required before marking shipped (at least two, kept private like dispute photos), and `classified_shipment_events` (shipped, in transit, out for delivery, delivered, failed attempt, returned; who or what reported each). The confirm window starts at delivered; a parcel not delivered within the country's longest transit time opens the way to a dispute.
- Admin per country: the couriers offered (name, tracking link pattern), the longest transit time, the confirm window after delivery.
- Courier integrations behind one `CourierAdapter` (status by tracking number, webhooks where offered), each courier confirmed per country (API, terms, sandbox) before its adapter is built, as for suppliers; until then the supplier updates the timeline by hand.
- Pickup and hand delivery keep the release code: the buyer gives it only once they have checked the item.
- Order pages: the buyer's in the store's account app; the supplier's in the Shop tab (Orders, marked "Resale through <store>"); the reseller's in SHQ (Resale > Orders) and the API; admin Shop > Safe pay orders with a Resale filter.

### Stage 5: disputes, reports and launch
- Disputes with supplier and reseller both taking part, decided by BitoCard; reseller and supplier strikes; reports (reseller: resale sales and margin in Reports; supplier: sales by reseller; BitoCard: resale fees).
- Legal (below), lawyers' review, then switches on market by market, starting with one pilot market.

## Legal owed before any switch goes on live

- **The supplier is the seller of record**: the reseller is the store that sold it (paid a margin) and BitoCard holds the money. Lawyers to confirm per country (consumer law, Nigeria's FCCPA), whether the reseller acts as the supplier's agent, and what the receipt says.
- **Safe pay licensing** is still owed for BitoCard Shop (holding buyers' money; CBN in Nigeria). Resale adds locking store-wallet money and holding money owed to two parties.
- **Terms**: the Shop terms (suppliers opting in, stock, discounts, deals, approving notes, accepting and handing over to resellers' buyers, phone numbers shared with resellers), the reseller terms (resale stores, price limits, deals, notes, strikes, first-line support, earnings), customer terms on resale stores (who the seller is, locked funds, acceptance), and the privacy notice (the supplier writes in and reads the buyer's chat with the store, which shows their messages as the store's, and sees the buyer's name, phone number, email and delivery address; dispatch and delivery photos; couriers receiving the delivery address and phone; supplier and reseller see each other's phone numbers; the store shows the supplier's public profile). The reseller terms must forbid posing as the owner or maker of the items, with strikes and suspension for it; the Shop terms must forbid suppliers using buyers' details for anything but the order, and set out shipping (who pays, packing, the supplier's responsibility until delivery, damage and loss in transit, dispatch photos, confirming on delivery). Whether a buyer must be told that someone other than the store may write to them as the store is for lawyers to confirm (consumer and data protection law).
- **Tax** on the reseller's margin and BitoCard's fees.

## Decisions (owner, 26 October 2026)

1. **Shop and resale**: a supplier may sell one listing both on BitoCard Shop and through resellers, from shared stock.
2. **Price floor**: the supplier's price, unless the supplier gives a reseller a better deal through the platform's chat with them. Suppliers who supply resellers get **My Resellers**, with chat; phone numbers are open between supplier and reseller through the platform.
3. **Instant buy with protection**: every resale purchase is paid from the wallet; the money is locked first, the supplier accepts, then it is debited.
4. **Seller of record**: the supplier.
5. **BitoCard's fee on the reseller's margin**: yes, capped.
6. **Partial refunds**: split between supplier and reseller in proportion to their shares.
7. **Reseller's note**: allowed, shown only once the supplier approves it.
8. **Plans**: every plan, Startup included; existing plan features and limits apply as usual.
9. **Cross-border**: no; supplier, store and buyer in the same country.

10. **Security first**: resellers may pose as the real owners, so nothing a reseller writes reaches a listing except the note the supplier approves; the supplier's own page can be opened right on the reseller's store.
11. **Order conversations** (revised the same day): the supplier may write to the buyer directly in the order chat; every message reaches the buyer as from the reseller's store, and supplier and reseller both see all of it; supplier and reseller also have the order's trade thread.
12. **Shipping and tracking** are a solid fulfilment option (courier, tracking number and a tracking timeline), beside **pickup**, where the supplier meets the buyer and delivers the item by hand.
13. **The supplier has the buyer's details and contact** (name, phone number, email, delivery address) to deliver.
14. **The goal**: the product reaches the buyer in one piece and safely, so everyone gets paid.

Proposed here and accepted by the owner (26 October 2026):
- **A. Auto-accept** for suppliers (off by default).
- **B. The supplier's page on the store shows no price**: who the supplier is and the listing as they wrote it, but not their price (the store's price is the reseller's business; a listing also on BitoCard Shop shows its price there anyway).
- ~~C. Delivery contact: a phone number for the courier only~~: replaced by decision 13 (the supplier has the buyer's details).

Proposed, not yet decided:
- **D. Delivery fee**: the supplier sets their shipping charge per listing (free, within their state, nationwide); the buyer pays it on top, it goes to the supplier in full on release (outside any reseller discount or margin), and it is refunded with the order if the item is not delivered.
- **E. Dispatch photos are required** before an order can be marked shipped (the item and the sealed parcel), so damage claims can be decided.

## Not in this plan

- Wholesale buying on BitoCard Shop itself (businesses buying in bulk, price tiers, request for quote): `docs/BITOCARD_CLASSIFIEDS_PLAN.md` Phase 2.
- Resellers buying stock outright and reselling it as their own (they never own the item here).
- Cross-border resale and currencies other than the country's.
