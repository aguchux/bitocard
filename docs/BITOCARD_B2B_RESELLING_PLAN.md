# B2B reselling: plan

**Status:** plan, 26 October 2026; the owner's decisions recorded the same day (see Decisions). Nothing built. Where this plan and `AGENTS.md` differ, `AGENTS.md` wins until this plan is built and merged back into it.

## The idea in one paragraph

A BitoCard Shop seller (a bitocard.com customer) can open a listing to resellers, on BitoCard Shop as well or not, as they choose: they set their price, the discount resellers earn and how far above their price a reseller may sell, inside limits BitoCard sets. A reseller opens a store on the new **Resale shop** template, browses the resale listings of suppliers in their own country, adds the ones they want at their own price and sells them on their store, with its own domain, design and home page. Suppliers and resellers know each other: the supplier's **My Resellers** tab lists every reseller carrying their listings, with a chat and open phone numbers between them, and the special deals they agree there. A store customer buys from their store wallet: the money is locked, the supplier accepts, then it goes to BitoCard's Safe pay escrow, never to the reseller; the supplier hands the item to the buyer directly (meet-up with a release code, or delivery); once released, the supplier, the reseller and BitoCard are each paid automatically.

## What exists today (facts this plan builds on)

- **A listing is one item.** `ClassifiedListing` has no quantity or stock; one paid Safe pay order sells the listing (a partial unique index allows one holding order per listing, and release marks it `sold`).
- **Safe pay** (`safe-pay.service.ts`): `requested` → `awaiting_payment` → `paid` → (`released` by release code at a meet-up | `sent` → `received`/auto-released) or `refunded`, `partly_refunded`, `disputed`, `lapsed`, `cancelled`. Deadlines run in the `classifieds` job every 15 minutes. Money: buyer's `customer_wallet` → `classified_escrow` (price + buyer fee) → on release the seller's `customer_withdrawable` (price − seller fee) and `classifieds_revenue` (both fees); refunds go back to the buyer's wallet. Fees, timers, the new-seller limit and the strike limit are per country in `ClassifiedSafePaySettings`. Guards: same person (KYC fingerprint, name and birth date, bank account), strikes, new-seller order limit, payout review of reversible top-ups, the payout hold before withdrawal.
- **Shop is closed to reseller stores on purpose**: `ListingsService.sellerCountry` accepts only bitocard.com accounts, and Safe pay's buyers and sellers are bitocard.com customers.
- **The `b2b` category flag** exists (Business and industrial, "for businesses (wholesale)") but nothing depends on it. `docs/BITOCARD_CLASSIFIEDS_PLAN.md` Phase 2 sketches wholesale buying on Shop (minimum quantities, price tiers, request for quote); that stays separate (see "Not in this plan").
- **Reseller stores**: templates in `src/stores/templates.ts` (what a store sells, its sections, variants, themes, a `store_template_<key>` switch each); store customers are per store; per-store domains, plans and the home page editor (`StoreHomeService`, `HomeEditor`) are template-aware. A reseller's margin reaches them through `WalletService.creditEarnings` into `reseller_earnings_held`, released after the country's payout hold. The Markup Protection Scheme caps resellers' markups per country (`markupCapPercent`), enforced in the API.

## Who does what

| Party | Account | Does | Gets |
|---|---|---|---|
| **Supplier** (seller of record) | bitocard.com customer, identity checked, payout account set | Opens a listing to resellers (Shop too or not); sets price, reseller discount and markup limit; agrees deals with resellers; approves resellers' notes; accepts orders; hands the item to the buyer; enters the release code or marks it sent | Their price less the reseller's discount, less BitoCard's supplier fee, into `customer_withdrawable` (withdrawable after the payout hold) |
| **Reseller** | SHQ reseller, verified (KYB), on a store with the Resale shop template, any plan | Picks listings, sets their price within the limits, runs the store (design, domain, marketing, first-line support) | Their price less the supplier's net, less BitoCard's capped reseller fee, into `reseller_earnings_held` → `reseller_earnings` after the payout hold |
| **Buyer** | Customer of the reseller's store | Buys from their store wallet, meets the supplier or receives the delivery, releases | The item, or their money back to their store wallet |
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
| Supplier accepts (within the accept window) | `paid` | `customer_wallet_locked` → `classified_escrow`; the hand-over deadline starts; for a meet-up the buyer gets the release code |
| Supplier declines, or the accept window passes | `declined` / `lapsed` | locked → back to `customer_wallet`; stock freed; a lapse counts towards the supplier's strikes |
| Buyer cancels before acceptance | `cancelled` | locked → back to `customer_wallet` |
| Released (code, received, or the confirm window passes) | `released` | escrow → supplier's `customer_withdrawable` (net − supplier fee), reseller's `reseller_earnings_held` (margin − reseller fee, an earnings lot), `classifieds_revenue` (all fees) |
| Refunded (not handed over in time, cancelled after acceptance, dispute) | `refunded` | escrow → `customer_wallet`, everything |
| Partly refunded (dispute) | `partly_refunded` | the refund to the buyer first; the rest split between supplier and reseller in proportion to their shares, each paying their fee on what they receive |

The order records every figure when the buyer buys (S, P, D or the deal, the supplier's net, the reseller's margin, each fee, its rate and cap), so later price, deal or rule changes never alter it. **Auto-accept** (proposed): a supplier may choose to accept resale orders automatically while the listing has stock, for a business on full autopilot; off by default.

## Trust and safety ("the reseller cannot defraud the buyer")

1. **The reseller never holds the buyer's money.** It is locked in the buyer's wallet, then held by BitoCard; the reseller is paid only on release.
2. **The reseller cannot change what is sold.** Title, photos, video, condition, features and description come from the supplier's listing as they are. The reseller's only words are an optional short **note** ("Free delivery in Lekki"), shown as the store's only once the supplier approves it; a misleading note counts against the reseller in disputes. Each order keeps a snapshot of what the buyer saw.
3. **Nothing sells that is not there.** Stock is shared by Shop and every reseller store; a listing that sells out, expires, is paused or removed leaves every store at once.
4. **BitoCard decides disputes**, not the reseller (the money is in escrow); supplier and reseller both add notes and evidence.
5. **Three-way same-person check**: supplier, reseller (its owner and team) and buyer must all be different people (KYC fingerprint, name and birth date, bank accounts), so nobody farms margins or fees with their own accounts.
6. **Strikes for resellers too**: disputes upheld because of the store's note, and resale orders the reseller's store cancels, count towards a reseller strike limit; reaching it pauses the store's resale checkout until operations clear it.
7. **Contact.** Between supplier and reseller it is open: chat in My Resellers and phone numbers shown to each other (both are verified businesses or people working together). Between buyer and supplier it stays inside BitoCard: the order's chat (the reseller can read it), under the Shop's chat rules, with the meet-up details shared once accepted; the supplier sees the buyer's first name and, for delivery, the address, never their email or phone.
8. **Existing guards carry over**: the new-seller order limit, the payout review of reversible top-ups, the payout hold, the supplier's strikes and readiness (identity and payout account) before their listings can be resold.

## Autopilot

- **Listings stay in step by themselves**: store listings read the supplier's listing, never a copy; sold out, expired, paused or repriced listings change every store at once.
- **Deadlines and payments** run in the existing `classifieds` job: accept windows, hand-over and confirm deadlines, automatic refunds and strikes; earnings released after the hold by the existing `earnings` job.
- **Auto-listing rules** for resellers: "add every resale listing in Phones from verified suppliers at +15%", applied as new listings open; resellers can exclude suppliers or listings.
- **Auto-accept** for suppliers who want it (above).
- **Everyone is told**: supplier (new order to accept, hand-over due, released, paid out, a reseller's note to approve, a deal offered), reseller (sale, accepted, released, dispute, listing gone or paused, deal offered or ended), buyer (locked, accepted with the code, sent, released, refunded), by inbox, push and email.
- **API-first**: resellers can do all of it from their own systems (`/v1/resale/...`: browse, add and price, notes, deals, orders, webhooks `resale_order.*`), in the public OpenAPI document.

## Stages

Each stage ships behind switches that are off by default, with its tests (PGlite and Docker), docs and `AGENTS.md` lines in the same change.

### Stage 1: resale listings (API and the Shop tab)
- Listing fields: `channels` (`shop`, `resale`, or both), `resale_discount_bps`, `resale_markup_max_bps`, `resale_paused_at`, and `stock` (units; 1 for today's listings). A resale-only listing is never shown on BitoCard Shop: search, category pages, sitemap, showcase, category covers, the assistant's tools and Show phone leave it out. A listing on both sells from one stock.
- Stock for Shop orders too: the one-holding-order index becomes "held units never exceed stock" (checked with the listing row locked), and release marks the listing sold only when none is left.
- Guards: `ClassifiedResaleSettings` per country (discount min and max, markup max, reseller fee and cap, accept window, reseller strike limit), optional per category; admin endpoints and Shop > Settings > Resale.
- Who can open listings to resellers: switch `classifieds_resale` (global, country), identity-checked suppliers with a payout account, the Shop terms' new resale section accepted.
- Shop tab, Post an ad: "Sell on BitoCard Shop" and "Let resellers sell this", stock, the discount and markup limit (within the country's limits, with the worked sum shown live); My listings shows how many stores carry each listing and their sales.

### Stage 2: resellers, suppliers and My Resellers
- `ResaleListing` (store, listing, markup bps or fixed price, note, note status `pending` | `approved` | `refused`, status `active` | `paused` | `gone`), per store; `ResaleRule` for auto-listing.
- `ResaleRelationship` (supplier, reseller): made when a reseller first adds one of the supplier's listings; carries the chat (`ResaleMessage`: text, photos, deal offers) and each side's phone, shown to the other; either side can block.
- `ResaleDeal` (above): offered in the chat by the supplier, accepted by the reseller, ended by either.
- Reseller endpoints `/v1/resale/catalogue` (resale listings of verified suppliers in their country: category, words, price, supplier rating, condition, delivery), `/v1/resale/listings` (add, price, note, pause, remove), `/v1/resale/rules`, `/v1/resale/suppliers` (chat, deals); SHQ **Resale** section (Browse, My listings, Rules, Suppliers with their chats and deals, a price preview showing the margin).
- Supplier endpoints and the Shop tab's **My Resellers** (each reseller and store carrying their listings, their sales, the chat with phone numbers, deals offered and running, notes waiting for approval).
- Gates: switch `reseller_resale` (global, country, reseller), a verified (KYB) reseller with a Resale shop store. Every plan, Startup included; the existing plan features and limits (stores, domains, custom domains, AI and the rest) apply as they do today.

### Stage 3: the Resale shop template and its storefront
- Template `resale_shop` (three variants and their themes, `store_template_resale_shop` switch) selling resale listings instead of catalogue products: `StorefrontService.availability` and checkout learn a second kind of item.
- New sections: `listing_rail`, `listing_grid`, `resale_categories`, plus `features` and `faq`; the home editor, starter pages and previews as for every template.
- Pages on the reseller's store: category, search, listing (`/l/<ref>-<slug>`: the supplier's photos and facts, the reseller's price and approved note, how payment is protected, delivery or meet-up area), with the store's own SEO.
- The store's wallets must be on and collected by BitoCard (`payment_collector` cannot be `own` on a Resale shop).

### Stage 4: buying, fulfilment and payouts
- Safe pay orders gain `kind` (`direct` | `resale`), `store_id`, `reseller_id`, the price figures, the deal used and `quantity`; the buyer of a resale order may be any store's customer. New status `locked`; new ledger account `customer_wallet_locked` (a customer account, never below zero).
- Lock, accept, then debit (above); auto-accept; the order chat (supplier, buyer, the reseller reading); release code and delivery as today; the three-way release entry; partial refunds split in proportion; the three-way same-person check; reseller strikes.
- Order pages: the buyer's in the store's account app; the supplier's in the Shop tab (Orders, marked "Resale through <store>"); the reseller's in SHQ (Resale > Orders) and the API; admin Shop > Safe pay orders with a Resale filter.

### Stage 5: disputes, reports and launch
- Disputes with supplier and reseller both taking part, decided by BitoCard; reseller and supplier strikes; reports (reseller: resale sales and margin in Reports; supplier: sales by reseller; BitoCard: resale fees).
- Legal (below), lawyers' review, then switches on market by market, starting with one pilot market.

## Legal owed before any switch goes on live

- **The supplier is the seller of record**: the reseller is the store that sold it (paid a margin) and BitoCard holds the money. Lawyers to confirm per country (consumer law, Nigeria's FCCPA), whether the reseller acts as the supplier's agent, and what the receipt says.
- **Safe pay licensing** is still owed for BitoCard Shop (holding buyers' money; CBN in Nigeria). Resale adds locking store-wallet money and holding money owed to two parties.
- **Terms**: the Shop terms (suppliers opting in, stock, discounts, deals, approving notes, accepting and handing over to resellers' buyers, phone numbers shared with resellers), the reseller terms (resale stores, price limits, deals, notes, strikes, first-line support, earnings), customer terms on resale stores (who the seller is, locked funds, acceptance), and the privacy notice (the supplier sees the buyer's first name and address; supplier and reseller see each other's phone numbers; the reseller reads the order chat).
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

Proposed here, not yet decided: **auto-accept** for suppliers (off by default).

## Not in this plan

- Wholesale buying on BitoCard Shop itself (businesses buying in bulk, price tiers, request for quote): `docs/BITOCARD_CLASSIFIEDS_PLAN.md` Phase 2.
- Resellers buying stock outright and reselling it as their own (they never own the item here).
- Cross-border resale and currencies other than the country's.
