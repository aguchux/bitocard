# BitoCard Classifieds: implementation plan

**Status:** plan, 25 October 2026. Nothing built. The owner decided on 25 October 2026: **Safe pay from the start**, as **the buyer's opt-in per purchase, for a fee of a percentage of the item's price paid by the buyer**; sellers with a confirmed email and phone; `shop.bitocard.com` in `apps/shop`; and phase 1 first (shops, deals and B2B in phase 2). The other recommended defaults below stand unless changed.

## What we are building

**BitoCard Classifieds** (`apps/shop`, `https://shop.bitocard.com`): an open market where anyone posts items for sale and buyers contact sellers, in the style of Jiji, plus **shops**: businesses with their own page, many listings and deals. It serves people buying from people and businesses (C2C, B2C), and businesses buying stock from other businesses (B2B: wholesale quantities and prices).

- **Sellers:** anyone with a BitoCard account and a confirmed email and phone posts listings for free (limited per month). A business opens a **shop** (verified with BitoCard Verify KYB) for more listings, a shop page, deals and B2B listings.
- **Buyers** browse and search without an account. To contact a seller they sign in, then chat in the app or reveal the seller's phone number.
- **Safe pay, the buyer's choice:** a buyer who wants protection opts in on a purchase and pays the item's price plus **Safe pay's fee, a percentage of the price**. BitoCard holds the price until they confirm they have the item (by giving the seller a release code when they meet, or confirming delivery), then pays the seller the full price. If the item never comes or is not as described, BitoCard decides the dispute and can refund. Buyers who do not opt in carry on with the seller in BitoCard's chat (or by phone) and pay the seller directly, as on Jiji.
- **Deals:** shops run sales and price drops, shown with honest "was" prices taken from the listing's own price history.
- **BitoCard earns** the Safe pay fee from buyers who opt in, and later from promotions (boosts) and shop plans.

What it is not: not part of the reseller storefronts (resellers' customers do not see it), not a BitoCard-supplied catalogue (sellers own their goods), and BitoCard is never the seller.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Address | **`shop.bitocard.com`** (already a reserved store name), its own Next.js app `apps/shop`, Vercel project `bitocard-shop` (owner's decision) | Its own brand and SEO, separate from the retail store. |
| Accounts | **bitocard.com customer accounts** (the house store's), as country stores already share them (`StoreSellers.accountStore`). The shop's server keeps its own host-only `bc_customer` cookie and sends `BitoCard-Store: bitocard` | One account for buying gift cards and posting ads. Signing in once more on `shop.` avoids a cookie on `.bitocard.com` that resellers' store subdomains would also receive. Single sign-on can come later. |
| Who sells | Any signed-in customer with a **confirmed email and phone** (owner's decision); shops need **KYB through BitoCard Verify** | A confirmed phone stops most throwaway scam accounts; Verify already does KYB with human review. |
| Payments | **Safe pay in phase 1** (owner's decision), **the buyer's opt-in per purchase**; buyers who do not opt in carry on in chat or by phone and pay the seller directly | Buyer protection is the reason to choose BitoCard over a plain classifieds site. It is a regulated activity: see Legal owed. |
| Safe pay fee | **Paid by the buyer, on top of the price** (owner's decision): a percentage of the item's price, set per country by admins, with an optional minimum and maximum; shown before they opt in. The seller is paid the full price | Protection is what the buyer buys, so the buyer pays for it; sellers are not put off. |
| Fee on a refund | **Refunded with the price** whenever the item does not change hands (the seller declines or misses the deadline, either side cancels before hand-over, or BitoCard refunds in full on a dispute); **kept** on a part refund or once released | The buyer pays only for protection that ran its course. |
| Which listings | **Any listing**: the buyer asks for Safe pay and the **seller accepts** before the buyer pays (within 24 hours) | Buyers choose it, so it cannot depend on sellers switching it on in advance; accepting first means a buyer never pays for an item the seller will not sell this way. |
| What the seller needs | To accept, the seller passes the **identity check** (Verify) and adds a **payout bank account in their verified name** (asked the first time) | They are paid out to a bank account, and customer payouts already require both (`CustomerPayoutsService`). |
| How buyers pay with Safe pay | **BitoCard's payment gateways only** (card, bank, mobile money: the market's checkout methods), **not the store wallet** at first | Store-wallet money is spend-only; paying it to a seller would turn it into withdrawable cash, which needs legal advice first (the same open point as the crypto exchange). |
| Paying the seller | On release the money becomes the seller's withdrawable money (`customer_withdrawable`), **inside the country's payout hold**, then cashed out with the existing bank payouts | A card chargeback after release can still be put right during the hold. It reuses payouts, name checks and holds. |
| Revenue later | Phase 3: **boosts** and **shop plans**, paid from the customer's wallet | Spend-only store credit spent on BitoCard's own service is what the wallet is for; no new payment flows. |
| Markets | Per country behind a feature switch **`classifieds`** (off by default; global or country), and **`classifieds_safe_pay`** (off by default) for paying through BitoCard, **Nigeria first** | Legal review per country; Safe pay can stay off where it is not cleared while the market itself runs. |
| Moderation | **Every new listing checked automatically**; a new seller's first listings and anything flagged held for review; everything reportable | Classifieds attract scams; the checks are cheap and the queue keeps the bar. |
| Search | **Postgres** full text (`tsvector`) plus `pg_trgm` for typos, with filters; a search engine (Typesense or Meilisearch) only when Postgres is too slow | Neon has both extensions; no new service to run or pay for. |
| Photos | Uploaded **through the API** (multipart), checked from their bytes, **metadata stripped** (GPS: a photo can reveal the seller's home), resized, then published to the public media bucket | Reuses `checkDocument` (`src/kyc/files.ts`) and `MediaStorage`; uploads straight from the browser to the bucket cannot strip metadata. |
| Chat | Its own tables (buyer, seller, listing), polling like support chat; reuses `ChatPanel` and the redaction of card numbers and codes | Support chat is store-to-customer; this is person-to-person about a listing. |

## Phases

### Phase 1: the open market with Safe pay (MVP)

Browse, search, post, contact, pay safely, moderate. Nigeria only, behind `classifieds` (and `classifieds_safe_pay`).

- **Categories** (admin-managed tree, two levels): Vehicles, Property, Phones & tablets, Electronics, Computers, Home & garden, Fashion, Health & beauty, Babies & kids, Sports & leisure, Agriculture & food, Animals & pets, Services, Jobs, Repair & construction, Business & industrial (B2B). Each category has **attributes** (a small JSON schema: Vehicles has make, model, year, mileage, fuel and transmission; Phones has brand, model, storage and colour) that drive the post form and the filters.
- **Listings:** title, description, category and its attributes, price (fixed, negotiable, or "contact for price"), condition (new, used, refurbished), up to 10 photos, location (country, state, then city or area, from a curated list: no free-text addresses and never coordinates), and how to be contacted (chat, phone or both). Lifecycle: `draft` → `pending_review` → `active` → `sold` | `expired` (after 30 days; renewable) | `rejected` | `removed`. Sellers edit, renew, mark sold and delete their own.
- **Limits:** free sellers get a number of active listings per category group per month (for example 10), set by admins; posting is rate limited.
- **Browsing:**
  - Home: categories, recent and featured listings, popular searches.
  - Category pages with attribute filters.
  - Search with filters (category, location, price range, condition, verified sellers, Safe pay, B2B) and sort (newest, cheapest, most expensive).
  - Listing page: photos (gallery), price, details, location, seller card (name, member since, verification badges, response rate, other listings), safety tips, Chat, Show phone, **Buy with Safe pay** (with the fee shown), Report.
- **Contact:**
  - **Chat** about a listing: text and photos; card numbers and codes masked; one conversation per buyer, seller and listing.
  - **Show phone:** signed in only, the seller's confirmed number, at most a few reveals per buyer per hour; each logged and counted for the seller as a lead.
  - Notifications through the existing inbox and push (`customer.classifieds.*`).
- **Favourites** (saved listings) for signed-in buyers.
- **Trust and safety:**
  - Automatic checks on each listing: prohibited words and categories, a price far below the category's usual range (a classic scam), the same photo used by another seller (perceptual hash), too many listings too fast.
  - Review queue: a new seller's first three listings and anything flagged.
  - Reports on listings and users (reason, details); three reports send a listing back to review at once.
  - Verification badges: phone confirmed, ID checked (Verify KYC), business verified (KYB).
  - Blocking: one user blocks another in chat. Admins suspend users and remove listings, audited.
  - Safety tips on every listing and at the start of every chat: "Use Safe pay, or meet in public, inspect before paying and never pay in advance."
- **Admin** (admin app, a new **Classifieds** section): moderation queue (approve, reject with a reason, ask for changes), reports, listings, users and shops (suspend, unsuspend), categories and attributes, areas, prohibited words, limits, Safe pay orders and disputes, Safe pay settings per country. Operations edit, support views, finance decides money; every action audited (`classifieds.*`).
- **SEO:** listing and category pages are server-rendered and indexed, with Product and Offer JSON-LD, a sitemap of active listings, and Open Graph images from the first photo. Sold, expired and removed listings leave the sitemap and answer 410 after a grace period.

### Safe pay (part of phase 1)

- **Settings** (admins, per country): the fee (a percentage of the item's price, with an optional minimum and maximum), the largest order during a seller's first five Safe pay sales, how long a seller has to accept (24 hours) and to hand over (for example 5 days), and how long a buyer has to confirm after delivery (for example 3 days).
- **Opting in (the buyer):**
  1. On any listing, the buyer presses **Buy with Safe pay** at the listed price, or agrees a price by **offer** in chat. They see the price, Safe pay's fee and the total before they ask, with what the protection covers.
  2. They choose **meet in person** or **delivery** (giving the delivery address, shown only to the seller once paid), and send the request.
  3. Buyers who do not opt in simply carry on in chat or by phone, and pay the seller directly.
- **Accepting (the seller):**
  - The seller is told and accepts or declines within 24 hours (no answer: the request lapses). Accepting the first time asks for the identity check and a payout bank account in their verified name; a seller who cannot finish them declines.
  - Once accepted, the buyer has 24 hours to pay the total on the market's payment page. This reuses the checkout payment flow: gateways, the payment timeout, Cancel payment and gateway refunds. Nothing is reserved until it is paid.
- **Paid:** the price and the fee are held in escrow, the listing shows as reserved, and the seller is told to hand it over.
- **Handing over:**
  - **Meet in person:** the buyer's app shows a **6-digit release code**. They inspect the item, then give the code; the seller enters it, and the money is released at once. The code is never shown to the seller and never sent in chat; the seller has 5 tries.
  - **Delivery:** the seller marks it **sent** (with a tracking note); the buyer confirms **received**, or it releases by itself when the confirmation time ends without a dispute.
- **Release:** the full price moves from escrow to the seller's withdrawable money (inside the payout hold), and the fee to BitoCard's revenue, in one journal entry, once.
- **Cancelling and refunds:**
  - Before hand-over either side can cancel: the buyer is refunded in full, **fee included**.
  - A seller who misses the hand-over deadline: refunded in full, fee included, automatically by the job.
  - Refunds go back through the same gateway, as failed store checkouts are refunded today.
- **Disputes** (before release only):
  - The buyer opens one (not received, not as described, damaged), which stops the release.
  - Both sides add messages and photos. **BitoCard decides**: a full refund (fee included), a part refund (the rest to the seller; the fee kept), or release to the seller (the fee kept). Operations decide; refunds need finance.
  - A refund that needs the item back is decided once the seller confirms it was returned. Decisions are audited.
- **Protection against abuse:**
  - Card chargebacks are handled like checkout chargebacks; released money stays inside the payout hold.
  - New sellers have a lower order limit. A seller who loses disputes or cancels often is limited or suspended.
  - Buyer and seller must be different people, and not the same verified identity.
- **What each side sees:** both see the order, its status and timeline. The seller sees the price they will be paid (never the buyer's fee or how they paid), and the buyer's delivery address only after payment and only for delivery. Neither sees the other's bank details.

### Phase 2: shops, deals and B2B

- **Shops:** a business account (one owner; team members later) with name, logo, cover image, description, area, opening hours and categories, verified by **KYB through BitoCard Verify** before it goes public. A shop page (`/s/<slug>`) lists its listings and deals, with a follow button.
- **Deals and discounts:**
  - **Price drops:** every price change is kept. A listing shows "was ₦X" only when that price was live for at least 7 of the last 30 days, so "was" prices are real (consumer law on fake discounts: Nigeria's FCCPA, the UK CMA's guidance).
  - **Shop sales:** a shop runs a sale (a percentage off chosen listings or all of them, with a start and an end). The listing shows the sale price, the "was" price and when the sale ends.
  - A **Deals** page and section across the market: the biggest real discounts first, by category and location.
- **B2B listings:** a listing can be offered to businesses, with a **minimum order quantity**, a unit (piece, carton, kg, tonne), **quantity price tiers** (for example ₦5,000 each for 10 to 49, ₦4,500 for 50 or more), stock available and delivery terms. Only shops post B2B listings. Buyers filter by **For businesses** and send a **request for quote** (quantity, delivery location, date), which opens a chat with the quote attached; an accepted quote can be paid with Safe pay.
- **Reviews:** after a Safe pay order is released, or after a conversation of a few messages, each side can leave one rating and comment; shown on seller cards and shop pages. Sellers can reply once.
- **Saved searches and alerts:** a buyer saves a search and gets a daily or instant notification of new matches.

### Phase 3: promotions and shop plans

- **Boosts**, bought per listing from the customer's wallet: **Top** (first in its category for 7 days), **Featured** (home and category carousels), **Urgent** (a badge). Prices per country set by admins.
- **Shop plans** (monthly, from the wallet): more active listings, B2B listings, sales, shop analytics (views, leads, phone reveals) and a custom shop address.
- Admin reports: Safe pay fees, boost and plan revenue, by country and category.

### Phase 4 (later): Safe pay additions

Paying from the store wallet (after legal advice), courier integrations with tracked delivery, B2B orders paid by quantity, and partial shipments.

## Data model (Prisma, new migrations)

- **`classified_categories`**: `id`, `parent_id`, `slug`, `name`, `icon`, `position`, `attributes` (JSON schema), `b2b`, `enabled`; availability per country in `classified_category_countries`.
- **`classified_areas`**: country, state, then city or area; seeded for Nigeria (36 states and the FCT with their main cities).
- **`classified_listings`**: `customer_id` (seller), `shop_id` (nullable), `category_id`, `country`, `area_id`, `title`, `description`, `attributes` (JSON), `price_minor`, `currency`, `price_kind` (`fixed`, `negotiable`, `on_request`), `condition`, `b2b` (with `min_quantity`, `unit`, `stock`), `status`, `review_reason`, `published_at`, `expires_at`, `sold_at`, `search` (generated `tsvector`), `views`, `leads`. Indexes on status, country, category, area, price and published time; GIN on `search` and a trigram index on `title`.
- **`classified_photos`**: `listing_id`, `position`, `url`, `width`, `height`, `phash`.
- **`classified_price_history`**: `listing_id`, `price_minor`, `from`, `to`.
- **`classified_conversations`**: `listing_id`, `buyer_id`, `seller_id`, `last_message_at`, block flags; unique on listing and buyer. **`classified_messages`**: `conversation_id`, `sender_id`, `body` (redacted), attachments, `read_at`.
- **`classified_offers`**: `conversation_id`, `price_minor`, `status` (`open`, `accepted`, `declined`, `expired`), `expires_at`.
- **`classified_orders`** (Safe pay, numbered `SP-000123`): `listing_id`, `buyer_id`, `seller_id`, `mode`, `price_minor`, `currency`, `fee_minor` and `fee_bps` (the buyer's fee and the rate shown when they asked), `fulfilment` (`meet_up`, `delivery`), `delivery_address` (encrypted), `tracking_note`, `status` (`requested`, `declined`, `lapsed`, `awaiting_payment`, `paid`, `sent`, `released`, `cancelled`, `refund_pending`, `refunded`, `disputed`), `payment_id`, `release_code` (encrypted, shown to the buyer only) with `release_attempts`, deadlines (`accept_by`, `pay_by`, `handover_by`, `confirm_by`) and a timestamp per step.
- **`classified_disputes`**: `order_id`, `reason`, `status`, `decision` (`refund`, `partial`, `release`), `refund_minor`, messages with photos (private bucket, like chat files), `decided_by`.
- **`classified_safe_pay_settings`**: per country: the buyer's fee (`fee_bps`, optional minimum and maximum), new-seller order limit, accept, pay, hand-over and confirmation times.
- **`classified_leads`**: phone reveals and first chats per listing and buyer (rate limits and seller stats).
- **`classified_favourites`**; **`classified_reports`**: `listing_id` or `reported_customer_id`, `reporter_id`, `reason`, `details`, `status`, `decided_by`.
- Phase 2: **`classified_shops`** (owner, slug, name, logo, cover, description, area, status, `kyc_case_id`, `plan_code`), **`classified_price_tiers`**, **`classified_sales`**, **`classified_quotes`**, **`classified_reviews`**, **`classified_saved_searches`**. Phase 3: **`classified_boosts`**.
- **Ledger:** `classified_escrow` (money held for Safe pay orders: BitoCard's liability, per mode and currency, never below zero) and `classifieds_revenue` (fees, later boosts and plans). Entries: `classified_order:<id>:paid` (the gateway payment, price and fee, into escrow), `classified_order:<id>:released` (the price from escrow to the seller's `customer_withdrawable`, the fee to revenue), `classified_order:<id>:refund` (price and fee back out through the gateway), `classified_order:<id>:partial` (a part of the price refunded, the rest to the seller, the fee to revenue).

## API (`/v1/classifieds`, `src/classifieds`)

- **Public, cached a minute** (`@Public`, `?market=`): `GET categories`, `GET areas`, `GET listings` (filters, sort, cursor paging), `GET listings/:id`, `GET search/suggest`; phase 2 `GET shops/:slug`, `GET deals`.
- **Signed-in customers** (`CustomerGuard`, the house store's accounts):
  - Listings: `POST/PATCH/DELETE listings(/:id)`, `POST listings/:id/photos` (multipart), `POST listings/:id/renew|sold`, `GET me/listings`.
  - Contact: `POST listings/:id/phone` (reveal), `GET/POST conversations(/:id/messages)`, `POST conversations/:id/block`, `GET/POST/DELETE favourites`, `POST reports`.
  - Safe pay: `GET listings/:id/safe-pay` (the fee and total for the buyer), `GET me/safe-pay` (what a seller still needs: identity check, payout account), `POST conversations/:id/offers`, `POST offers/:id/accept|decline`, `POST orders { listing_id | offer_id, fulfilment, delivery_address? }` (the buyer's request), `POST orders/:id/accept|decline` (the seller), `POST orders/:id/pay` (the buyer, once accepted: opens the payment page), `GET orders(/:id)` (as buyer or seller), `GET orders/:id/release-code` (the buyer, once paid, meet-up only), `POST orders/:id/release { code }` (the seller), `POST orders/:id/sent { tracking_note }`, `POST orders/:id/received`, `POST orders/:id/cancel`, `POST orders/:id/dispute` (+ messages and photos).
- **Admin** (`/v1/admin/classifieds`): moderation queue and decisions, reports, listings, users, categories and attributes, areas, limits, prohibited words, Safe pay settings per country, orders, and disputes (`POST disputes/:id/decide { decision, refund_minor?, note }`, refunds finance only, behind the step-up window); all audited.
- Left out of the public OpenAPI document, like the store's customer endpoints, so resellers' API is unchanged. Gated by the switches (`classifieds_unavailable`, `safe_pay_unavailable`).
- **Payments:** a new payment purpose `classified_order` on the existing `PaymentsService` (gateway choice, timeout, cancel, verification, unmatched money and refunds all as today); when paid, the escrow entry is written in the same transaction as the order turning `paid`.
- **Jobs** (in `cron.json`, run by the droplet's scheduler): `classifieds` every 15 minutes (expire listings and offers, lapse requests not accepted or not paid in time, refund orders past their hand-over deadline, release delivered orders past their confirmation time, send saved-search alerts, re-check flagged listings); a daily cleanup (photos of deleted listings, old conversations by the retention rule).

## The app (`apps/shop`)

Next.js App Router, built like the storefront: server components fetching the API on the server (`lib/api.ts`), the customer session in the shop's own `bc_customer` cookie (`lib/customer.ts`), Tailwind with the BitoCard tokens, mobile first, no horizontal scroll at phone width.

- `/` home: search with location, category grid, featured and recent listings (later a deals strip).
- `/c/<category>`: listings with filters and sort. `/search?q=`.
- `/l/<id>-<slug>`: a listing. `/l/<id>/buy`: Safe pay (price, fee and total, what is covered, meet-up or delivery, address, send the request; then pay once the seller accepts).
- `/post`: post an ad, step by step (category, details, photos, price, location, contact, Safe pay).
- `/account/listings`, `/account/messages(/<id>)` (with offers), `/account/orders(/<id>)` (as buyer: status, pay, release code, received, dispute; as seller: accept or decline, hand-over, enter the code, mark sent), `/account/favourites`, `/account/safe-pay` (identity check and payout account), `/signin`, `/signup` (bitocard.com's account flows, sending `BitoCard-Store: bitocard`).
- Phase 2: `/s/<shop>`, `/deals`, `/account/shop`.
- Shared code from `@bitocard/ui`, `@bitocard/api-client` (a new `classifieds` entry with its types) and the storefront's chat and photo components where they fit. Tests in `apps/shop/test` (Vitest) for every `lib/` helper and server action.

## Legal owed before switching on in a market

- **Safe pay, before taking any payment:** BitoCard holds buyers' money for third parties and pays sellers, which may be a regulated payment or escrow service in each country (Nigeria: CBN payment service licensing; take advice on whether a licensed partner must hold the funds). Safe pay terms: that it is the buyer's choice, its fee (a percentage of the price, paid by the buyer, refunded when the item does not change hands), holding, release codes, deadlines, cancellation, refunds and disputes, that BitoCard is not the seller and does not inspect goods, and sellers' payouts with the payout hold. Until cleared, Safe pay runs only in the sandbox (`classifieds_safe_pay` off live).
- **Marketplace terms** (`apps/legals`): BitoCard hosts listings and is not a party to a sale paid directly; sellers' warranties (they own the goods and the listing is true); prohibited items (weapons, drugs, counterfeit and stolen goods, restricted animals, financial products, adult content and anything illegal locally); honest prices and "was" prices; moderation, removal and suspension; reviews; boosts and shop plans.
- **Privacy notice:** listings and seller profiles are public; phone numbers shown to signed-in buyers who ask; chats kept for a set period and read by moderators only on a report or dispute; photo metadata removed; leads and views counted; delivery addresses shown only to the seller; payment, payout and dispute data and their retention; Verify checks for Safe pay sellers and shops.
- **Per country:** consumer protection on pricing and discounts (Nigeria FCCPA), data protection (NDPA), and any rules on online marketplaces and particular categories (vehicles, property, jobs, animals). Lawyers' review before launch.

## Order of work for phase 1

1. Migrations and seed: categories with attributes, Nigerian areas, the switches, Safe pay settings.
2. API: listings (create, edit, lifecycle, limits), photos through the API, public reads and search, automatic checks and moderation, reports, favourites.
3. API: conversations and messages, offers, phone reveal and leads, notifications.
4. API: Safe pay: the buyer's request with the fee, the seller's acceptance and set-up, orders and the `classified_order` payment purpose, escrow entries, release codes, sent and received, deadlines in the job, cancellations and refunds, disputes and admin decisions, release into the payout hold.
5. Admin app: the Classifieds section (queue, reports, listings, users, categories, limits, Safe pay orders, disputes and settings).
6. `apps/shop`: home, category, search, listing, post an ad, Safe pay (buy, orders, release code, set-up), account (listings, messages, favourites), sign-in.
7. Vercel project `bitocard-shop` (skip unaffected builds and the deep clone on, as for the other projects), `shop.bitocard.com` on Cloudflare (DNS only, to Vercel), the API's `ALLOWED_ORIGINS`, and a link from the storefront.
8. Tests: the API on PGlite and Postgres (Safe pay money paths with parallel requests, as for P2P trades), the app's Vitest; legal drafts; then a closed pilot in Nigeria, with Safe pay in the sandbox until legal clearance.
