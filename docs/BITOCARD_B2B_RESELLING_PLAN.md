# B2B reselling: plan

**Status:** plan, 26 October 2026. Nothing built. The decisions marked **Decide** below need the owner's answer before Stage 1 starts. Where this plan and `AGENTS.md` differ, `AGENTS.md` wins until this plan is built and merged back into it.

## The idea in one paragraph

A BitoCard Shop seller (a bitocard.com customer) can open a listing to resellers: they set their price, the discount resellers earn and how far above their price a reseller may sell, inside limits BitoCard sets. Those listings do not appear on BitoCard Shop. A reseller opens a store on the new **Resale shop** template, browses the B2B listings of sellers in their own country, adds the ones they want at their own price and sells them on their store, with its own domain, design and home page. A store customer buys with Safe pay: the money goes to BitoCard, never the reseller; the seller hands the item over to the buyer directly (meet-up with a release code, or delivery); once released, the seller, the reseller and BitoCard are each paid automatically. Nobody has to step in for a normal sale.

## What exists today (facts this plan builds on)

- **A listing is one item.** `ClassifiedListing` has no quantity or stock; one paid Safe pay order sells the listing (a partial unique index allows one holding order per listing, and release marks it `sold`).
- **Safe pay** (`safe-pay.service.ts`): `requested` → `awaiting_payment` → `paid` → (`released` by release code at a meet-up | `sent` → `received`/auto-released) or `refunded`, `partly_refunded`, `disputed`, `lapsed`, `cancelled`. Deadlines run in the `classifieds` job every 15 minutes. Money: buyer's `customer_wallet` → `classified_escrow` (price + buyer fee) → on release the seller's `customer_withdrawable` (price − seller fee) and `classifieds_revenue` (both fees); refunds go back to the buyer's wallet. Fees, timers, the new-seller limit and the strike limit are per country in `ClassifiedSafePaySettings`. Guards: same person (KYC fingerprint, name and birth date, bank account), strikes, new-seller order limit, payout review of reversible top-ups, the payout hold before withdrawal.
- **Shop is closed to reseller stores on purpose**: `ListingsService.sellerCountry` accepts only bitocard.com accounts, and Safe pay's buyers and sellers are bitocard.com customers.
- **The `b2b` category flag** exists (Business and industrial, "for businesses (wholesale)") but nothing depends on it. `docs/BITOCARD_CLASSIFIEDS_PLAN.md` Phase 2 sketches B2B listings with minimum order quantity, units, price tiers, stock and request for quote; `docs/design/shop-ui/B2B.dc.html` is its mock-up. That is a different thing (businesses buying wholesale on Shop) and stays separate; see "Not in this plan".
- **Reseller stores**: templates in `src/stores/templates.ts` (what a store sells, its sections, variants, themes, a `store_template_<key>` switch each); store customers are per store; per-store domains, plans and the home page editor (`StoreHomeService`, `HomeEditor`) are template-aware. A reseller's margin reaches them through `WalletService.creditEarnings` into `reseller_earnings_held`, released after the country's payout hold. The Markup Protection Scheme caps resellers' markups per country (`markupCapPercent`), enforced in the API.

## Who does what

| Party | Account | Does | Gets |
|---|---|---|---|
| **Supplier** (B2B owner) | bitocard.com customer, identity checked, payout account set | Opens a listing to resellers; sets price, reseller discount and markup limit; hands the item to the buyer; enters the release code or marks it sent | Their price less the reseller discount, less BitoCard's seller fee, into `customer_withdrawable` (withdrawable after the payout hold) |
| **Reseller** | SHQ reseller, verified (KYB), on a store with the Resale shop template | Picks listings, sets their price within the limits, runs the store (design, domain, marketing, first-line support) | Their price less the supplier's net price, less BitoCard's fee on it (**Decide 5**), into `reseller_earnings_held` → `reseller_earnings` after the payout hold |
| **Buyer** | Customer of the reseller's store | Buys from the store with Safe pay, meets the supplier or receives the delivery, releases | The item, or their money back to their store wallet |
| **BitoCard** | Escrow and fees | Holds the money, enforces the rules, runs deadlines, decides disputes | Buyer fee, supplier fee (and the reseller fee, if chosen) into `classifieds_revenue` |

## Money: one worked example

Supplier price **P = ₦100,000**, reseller discount **D = 10%**, markup limit **M = 30%**. The supplier's net before fees is P × (1 − D) = **₦90,000**. The reseller sets their price **S** anywhere from P to P × (1 + M) = ₦130,000 (the floor is **Decide 2**); say **S = ₦115,000**.

| Step | Ledger entry (new reference `classified_order:<id>:<step>`) |
|---|---|
| Buyer pays | `customer_wallet` (buyer, reseller's store) → `classified_escrow`: S + buyer fee on S |
| Released | escrow → supplier's `customer_withdrawable`: ₦90,000 − supplier fee; escrow → reseller's `reseller_earnings_held` (an earnings lot): ₦25,000 − reseller fee; escrow → `classifieds_revenue`: all fees |
| Refunded | escrow → buyer's `customer_wallet`: everything, buyer fee included |
| Partly refunded | the refund to the buyer first; what remains is split between supplier and reseller in proportion to their shares (₦90,000 : ₦25,000), fees on what each receives (**Decide 6**) |

The order records every figure when the buyer pays (S, P, D, the supplier's net, the reseller's margin, each fee and its rate), so a later price or rule change never alters an order.

**Guards on prices** (per country, optionally per category; admin Shop > Settings > B2B):
- Reseller discount D: from a minimum (so reselling is worth a reseller's while, e.g. 5%) to a maximum (e.g. 50%).
- Markup limit M: from 0 to a maximum (default the country's Markup Protection Scheme cap, never above it).
- The reseller's price is stored as a markup over P (basis points), so it follows the supplier's price; a fixed price is allowed but is checked against the limits again whenever P changes.
- The API enforces every limit when it is set and again at checkout (`b2b_price_out_of_range`), as the Markup Protection Scheme does today.

## Trust and safety ("the reseller cannot defraud the buyer")

1. **The reseller never holds the buyer's money.** Checkout on a Resale shop is Safe pay only, paid from the store wallet through BitoCard's gateways. The reseller's own payment gateway is never offered on these stores, and paying the supplier or reseller directly is not possible through the store.
2. **The reseller cannot change what is sold.** Title, photos, video, condition, features and description come from the supplier's listing and are shown as they are; the reseller sets only the price (and, **Decide 7**, an optional short note shown as theirs). The buyer's order keeps a snapshot of the listing as they saw it, for disputes.
3. **Nothing sells that is not there.** A listing that sells, expires, is paused, removed or reported out of stock leaves every reseller store at once. Stage 4 adds stock so one listing can sell several units.
4. **BitoCard decides disputes**, not the reseller (the money is in escrow). The reseller can add a note and evidence to the dispute; the outcome follows the existing rules and strikes.
5. **Three-way same-person check**: supplier, reseller (its owner and team) and buyer must all be different people (KYC fingerprint, name and birth date, bank accounts), so nobody farms margins or fees with their own accounts.
6. **Strikes for resellers too**: disputes upheld against the listing as the store described it (a note that misled), and resale orders cancelled by the reseller count towards a reseller strike limit; reaching it pauses the store's resale checkout until operations clear it.
7. **Contact stays inside BitoCard.** Buyer and supplier talk in the order's chat (the reseller can read it), with the Shop's chat rules (no phone numbers, links or codes until a meet-up is arranged; then the meet-up details only). The supplier sees the buyer's first name and, for delivery, the address; never their email. The buyer sees the supplier's first name and area.
8. **Existing guards carry over**: the new-seller order limit, the payout review of reversible top-ups, the payout hold, the supplier's strikes and readiness (identity and payout account) before their listings can be resold.

## Autopilot

- **Listings stay in step by themselves**: sold, expired, paused or repriced listings update every reseller store in the same transaction (store listings read the supplier's listing, never a copy).
- **Instant buy** (**Decide 3**): buyers pay at once; the supplier is told and has the hand-over deadline. A supplier who does not hand over in time is refunded automatically and gets a strike, as in Safe pay today.
- **Auto-listing rules** for resellers: "add every B2B listing in Phones from verified suppliers at +15%", applied by a job as new listings open; resellers can exclude suppliers or listings.
- **Deadlines and payments** run in the existing `classifieds` job: auto-release after the confirm window, refunds, strikes, earnings released after the hold by the existing `earnings` job.
- **Everyone is told**: supplier (new order, hand-over due, released, paid out), reseller (sale, release, dispute, listing gone), buyer (paid, code, sent, released, refunded), by inbox, push and email.
- **API-first**: resellers can do all of it from their own systems (`/v1/resale/...`: browse B2B listings, add and price them, orders, webhooks `resale_order.*`), in the public OpenAPI document.

## Stages

Each stage ships behind switches that are off by default, with its tests (PGlite and Docker), docs and `AGENTS.md` lines in the same change.

### Stage 1: B2B listings (API and Shop tab)
- Listing fields: `resale` (`off` | `resellers`), `resale_discount_bps`, `resale_markup_max_bps`, `resale_paused_at`. A resale listing is never shown on BitoCard Shop: search, category pages, sitemap, showcase, category covers, the assistant's tools and Show phone all leave it out (**Decide 1** whether one listing may be both).
- Guards: `ClassifiedResaleSettings` per country (discount min and max, markup max, reseller fee, reseller strike limit), optional per category; admin endpoints and Shop > Settings > B2B.
- Who can open listings to resellers: switch `classifieds_resale` (global, country), identity-checked suppliers with a payout account, the Shop terms' new resale section accepted.
- Shop tab, Post an ad: "Let resellers sell this" with the discount and markup limit (sliders within the country's limits, with the example sum shown live); My listings shows resale listings with how many stores carry them and their sales.

### Stage 2: resellers find and add listings
- `ResaleListing` (store, listing, markup bps or fixed price, status `active` | `paused` | `gone`), per store; `ResaleRule` for auto-listing.
- `/v1/resale/catalogue` (B2B listings of verified suppliers in the reseller's country: category, words, price, supplier rating, condition, delivery), `/v1/resale/listings` (add, price, pause, remove), rules; SHQ **Resale** section (browse, my listings, rules, price preview showing the reseller's margin).
- Gates: switch `reseller_resale` (global, country, reseller), plan feature `resale` (Premium by migration, **Decide 8**), a verified (KYB) reseller, a Resale shop store.

### Stage 3: the Resale shop template and its storefront
- Template `resale_shop` (three variants, their themes, `store_template_resale_shop` switch) selling resale listings instead of catalogue products: `StorefrontService.availability` and checkout learn a second kind of item.
- New sections: `listing_rail`, `listing_grid`, `resale_categories`, plus `features` and `faq`; the home editor, starter pages and previews as for every template.
- Pages on the reseller's store: category, search, listing (`/l/<ref>-<slug>`, the supplier's photos and facts, the reseller's price, Safe pay explained, delivery or meet-up area), with the store's own SEO.
- The store's wallets must be on and collected by BitoCard (`payment_collector` cannot be `own` on a Resale shop).

### Stage 4: buying, fulfilment and payouts
- Safe pay orders gain `store_id`, `reseller_id`, `kind` (`direct` | `resale`), the price figures above and `quantity`; the buyer may be any store's customer for resale orders. The one-holding-order index applies to direct orders only.
- Stock on resale listings (`stock`, units held by open orders) so one listing can sell several times; the listing leaves every store when none is left.
- Instant buy, the order chat (supplier, buyer, reseller reading), release code and delivery as today, the three-way release entry, partial refunds split, the three-way same-person check, reseller strikes.
- Buyer's order pages in the store's account app; supplier's in the Shop tab (Orders, marked "Resale through <store>"); reseller's in SHQ (Resale > Orders) and the API; admin Shop > Safe pay orders with a Resale filter.

### Stage 5: disputes, reports and launch
- Disputes with the reseller as a third participant (note and evidence), decided by BitoCard; reseller and supplier strikes; reports (reseller: resale sales and margin in Reports; BitoCard: resale fees).
- Legal (below), lawyers' review, then switches on market by market, starting with one pilot market.

## Legal owed before any switch goes on live

- **Who sells to the buyer.** The supplier sells; the reseller markets and is paid a commission-like margin; BitoCard holds the money. Lawyers must confirm that framing per country (consumer law, Nigeria's FCCPA), whether the reseller is an agent of the supplier, and what the receipt says. **Decide 4.**
- **Safe pay licensing** is still owed for BitoCard Shop (holding buyers' money; CBN in Nigeria). Resale adds holding money owed to two parties.
- **Terms**: the Shop terms (supplier opting in, discount and limits, hand-over duties to resellers' buyers), the reseller terms (resale stores, price limits, no misleading notes, strikes, first-line support, earnings), customer terms on resale stores, and the privacy notice (supplier sees the buyer's first name and address; reseller reads the order chat).
- **Tax** on the reseller's margin and BitoCard's fees.

## Decisions for the owner

1. **Resale only, or also on Shop?** You said resale listings do not show on BitoCard Shop. Should a supplier be able to sell the same item both ways (on Shop and through resellers), with stock shared? Recommended: resale only in the first release, both later.
2. **Price floor.** May a reseller sell below the supplier's price P (giving up part of their discount, down to P × (1 − D))? Recommended: no, P is the floor, which protects the supplier's own pricing.
3. **Instant buy or supplier accepts first?** Recommended: instant buy for in-stock resale listings (autopilot), with the hand-over deadline and automatic refund protecting the buyer.
4. **Seller of record.** Recommended: the supplier, with the reseller as the store that sold it and BitoCard as the payment holder; confirm with lawyers.
5. **BitoCard's cut of the reseller's margin.** Recommended: a reseller fee rate per country (like the Safe pay fees, with a cap), so BitoCard earns on the margin too.
6. **Partial refunds.** Recommended: split between supplier and reseller in proportion to their shares.
7. **Reseller's own note on a listing** (for example "Free delivery in Lekki"). Recommended: allowed, short, shown as the store's, and counted in disputes if it misleads.
8. **Which plans may run a Resale shop?** Recommended: Premium and Enterprise (the `resale` plan feature), Startup later.
9. **Cross-border.** Recommended: same country only (supplier, store and buyer) in the first release.

## Not in this plan

- Wholesale buying on BitoCard Shop itself (businesses buying in bulk, price tiers, request for quote): `docs/BITOCARD_CLASSIFIEDS_PLAN.md` Phase 2.
- Resellers buying stock outright and reselling it as their own (they never own the item here).
- Cross-border resale and currencies other than the country's.
