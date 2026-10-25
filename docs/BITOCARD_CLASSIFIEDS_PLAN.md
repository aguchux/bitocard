# BitoCard Classifieds: implementation plan

**Status:** plan, 25 October 2026. Nothing built. The owner decided on 25 October 2026: **Safe pay from the start**, as **the buyer's opt-in per purchase**, with **fees on both sides, each capped**: the buyer pays x% of the price on top and the seller y% out of what they are paid, each the percentage or that side's cap, whichever is smaller, all set by admins; **anyone can sell and anyone can buy** (every account does both, with no seller approval; B2B open to all); **inside the customer account app on each country store** (`ng.bitocard.com/shop`; Shop takes the account app's last tab, Account moving to the header), not a separate app; and phase 1 first (shops, deals and B2B in phase 2). The other recommended defaults below stand unless changed.

## What we are building

**BitoCard Classifieds** (the **Shop**, at `/shop` on BitoCard's country stores, `https://ng.bitocard.com/shop`, in `apps/storefront`): an open market where anyone posts items for sale and buyers contact sellers, in the style of Jiji, plus **shops**: businesses with their own page, many listings and deals. It serves people buying from people and businesses (C2C, B2C), and businesses buying stock from other businesses (B2B: wholesale quantities and prices).

- **Anyone can sell and anyone can buy.** There are no seller or buyer accounts: every BitoCard account (signing up is open to anyone) can post listings and buy, and no one needs approval to start. Posting is free (limited per month, against spam). Anyone can also open a **shop** for more listings, a shop page and deals; businesses that pass BitoCard Verify KYB get the **Verified business** badge.
- **Buyers** browse and search without an account. To contact a seller they sign in, then chat in the app or reveal the seller's phone number (when the seller has confirmed one and chosen to show it).
- **B2B is open to everyone too:** anyone can post a listing for businesses (wholesale quantities and prices) and anyone can buy from one.
- **Safe pay, the buyer's choice:** a buyer who wants protection opts in on a purchase and pays the item's price plus **the buyer's Safe pay fee** (a percentage of the price, capped). BitoCard holds the price until they confirm they have the item (by giving the seller a release code when they meet, or confirming delivery), then pays the seller the price less **the seller's Safe pay fee** (a percentage of the price, capped). If the item never comes or is not as described, BitoCard decides the dispute and can refund. **Safe pay is the only payment BitoCard collects, and only from the buyer's BitoCard wallet.** Buyers who do not opt in carry on with the seller in BitoCard's chat (or by phone) and agree between themselves how to pay, where to meet, and how the item is inspected and tested, as on Jiji; BitoCard guides them with **BitoCard's Safe Trade Policy** and the **Safe Trade Guide** checklist (below).
- **Deals:** shops run sales and price drops, shown with honest "was" prices taken from the listing's own price history.
- **BitoCard earns** the Safe pay fees from both sides of each Safe pay sale, and later from promotions (boosts) and shop plans.

What it is not: not part of the reseller storefronts (resellers' customers do not see it), not a BitoCard-supplied catalogue (sellers own their goods), and BitoCard is never the seller.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Address | **`<country>.bitocard.com/shop`** in the storefront (`apps/storefront`), on BitoCard's own country stores only (owner's decision, replacing `shop.bitocard.com` and `apps/shop`). The account app's tabs become Home, Catalog, Orders, Wallet, Crypto, **Shop**: Shop takes the last tab, and Account moves to the header (the account button and the menu drawer). Shop has its own sub menu: Browse, Post an ad, My listings, Messages, Orders, Favourites, Safe pay | One place for everything a customer does with BitoCard, no new app or Vercel project, and the country comes from the store's own address. |
| Accounts | **bitocard.com customer accounts**, which country stores already share (`StoreSellers.accountStore`, the `bc_customer` cookie the storefront already keeps per host), so no extra sign-in | One account for buying gift cards and selling. |
| Which country | **The store's address decides it:** `ng.bitocard.com/shop` is Nigeria's market, `gh.bitocard.com/shop` Ghana's. A listing belongs to one country, is priced in its currency and never shows in another's. People post only in their account's own (fixed) country, and Safe pay works only between people of the same country; browsing another open country's Shop is fine. `bitocard.com/shop` sends a signed-in customer to their country's store, and a visitor to the market they chose (`bc_market`), else asks | Each country is its own market anyway (currency, Safe pay, payouts, fees, legal review); the country stores already exist. |
| Resellers' stores | **No Shop**: Classifieds is BitoCard's own, so resellers' stores keep Account as the last tab | Listings, chats and Safe pay are between BitoCard's customers. |
| Who sells and buys | **Anyone** (owner's decision): any signed-in account sells and buys, with no approval. The account's email is confirmed, as for every bitocard.com account; a phone is optional (it earns the Phone confirmed badge and is needed for Show phone). Shops are open to anyone; KYB through BitoCard Verify earns the Verified business badge. Being paid through Safe pay still needs the identity check and a payout account (below) | Lowest barrier to listing, as on Jiji. Scams are held back by moderation, posting limits, reports, badges that buyers can filter on, and Safe pay. |
| Payments | **Safe pay in phase 1** (owner's decision), **the buyer's opt-in per purchase**; buyers who do not opt in carry on in chat or by phone and pay the seller directly | Buyer protection is the reason to choose BitoCard over a plain classifieds site. It is a regulated activity: see Legal owed. |
| Safe pay fees | **Both sides pay, each capped** (owner's decision): the buyer pays **x%** of the price on top; the seller pays **y%** of it, taken from what they are paid. Each side's fee is its percentage of the price or its **cap**, whichever is smaller. The two rates and the two caps are set per country by admins. Each side sees its own fee before committing (the buyer before asking, the seller before accepting) | Both sides gain from a safe sale. The caps keep Safe pay worth using on high-priced goods (cars, land, machinery), where a plain percentage would put people off. |
| Fees on a refund | **The buyer's fee is refunded with the price** whenever the item does not change hands (the seller declines or misses the deadline, either side cancels before hand-over, or BitoCard refunds in full on a dispute), and **kept** on a part refund or once released. **The seller's fee is taken only from money released to them**: none on a full refund; on a part refund, worked out on the part released (and capped) | Each side pays only for a sale that went ahead. |
| Which listings | **Any listing**: the buyer asks for Safe pay and the **seller accepts** before the buyer pays (within 24 hours) | Buyers choose it, so it cannot depend on sellers switching it on in advance; accepting first means a buyer never pays for an item the seller will not sell this way. |
| What the seller needs | To accept, the seller passes the **identity check** (Verify) and adds a **payout bank account in their verified name** (asked the first time) | They are paid out to a bank account, and customer payouts already require both (`CustomerPayoutsService`). |
| How buyers pay with Safe pay | **From the buyer's BitoCard wallet only** (owner's decision), in the country's currency. A buyer short of the total tops up first (card, bank, mobile money or their account number, as today) and comes back to pay. Refunds go back to the wallet at once | One way in and out, no payment page or gateway refund per order. **Open legal point:** store-wallet money is spend-only, and Safe pay turns it into a seller's withdrawable money, the same question as the crypto exchange; take advice before Safe pay runs live, and keep the payout hold and the recent-card-top-up review in place. |
| Trades without Safe pay | **Agreed between buyer and seller** (owner's decision): how to pay (cash, transfer, anything else), where to meet, inspecting and testing, and their own safety. BitoCard handles none of that money and does not decide those disputes; it publishes **BitoCard's Safe Trade Policy** and the **Safe Trade Guide**, takes reports and removes bad actors | BitoCard is only a party to what it holds. |
| Paying the seller | On release the money becomes the seller's withdrawable money (`customer_withdrawable`), **inside the country's payout hold**, then cashed out with the existing bank payouts | A card chargeback after release can still be put right during the hold. It reuses payouts, name checks and holds. |
| Revenue later | Phase 3: **boosts** and **shop plans**, paid from the customer's wallet | Spend-only store credit spent on BitoCard's own service is what the wallet is for; no new payment flows. |
| Markets | Per country behind a feature switch **`classifieds`** (off by default; global or country), and **`classifieds_safe_pay`** (off by default) for paying through BitoCard, **Nigeria first** | Legal review per country; Safe pay can stay off where it is not cleared while the market itself runs. |
| Moderation | **Every new listing checked automatically**; a new seller's first listings and anything flagged held for review; everything reportable | Classifieds attract scams; the checks are cheap and the queue keeps the bar. |
| Search | **Postgres** full text (`tsvector`) plus `pg_trgm` for typos, with filters; a search engine (Typesense or Meilisearch) only when Postgres is too slow | Neon has both extensions; no new service to run or pay for. |
| Listing form | **Quick and light, photo and video first** (owner's decision): at least **4 photos** and up to **1 video**, a title, price, **condition** (new, used, untested, for parts), **features** as key and value pairs whose keys come from a searchable **feature library** with icons, and a **rich text** description. No long per-category forms | Posting from a phone in about a minute; buyers judge by pictures first. |
| Photos and video | Uploaded **through the API** (multipart), checked from their bytes, **metadata stripped** (GPS: a photo or video can reveal the seller's home), resized or re-encoded, then published to the public media bucket | Reuses `checkDocument` (`src/kyc/files.ts`) and `MediaStorage`; uploads straight from the browser to the bucket cannot strip metadata. |
| Chat | Its own tables (buyer, seller, listing), polling like support chat; reuses `ChatPanel` and the redaction of card numbers and codes | Support chat is store-to-customer; this is person-to-person about a listing. |

## Phases

### Phase 1: the open market with Safe pay (MVP)

Browse, search, post, contact, pay safely, moderate. Nigeria only, behind `classifieds` (and `classifieds_safe_pay`).

- **Categories** (admin-managed tree, two levels): Vehicles, Property, Phones & tablets, Electronics, Computers, Home & garden, Fashion, Health & beauty, Babies & kids, Sports & leisure, Agriculture & food, Animals & pets, Services, Jobs, Repair & construction, Business & industrial (B2B). Each category **suggests** feature keys from the feature library (below), in order, so the form offers the right ones first; none are forced.
- **Listings** (kept short):
  - **Photos and video:** at least **4 photos** (up to 12; the first is the cover, reordered by dragging) and up to **1 video** (at most 60 seconds and 50 MB; MP4, MOV or WebM). Photos are taken or picked on the phone and scaled to 1600 px JPEG in the browser first (as BitoCard Verify does, so HEIC works); the API checks them again and strips their metadata. The video is re-encoded on the API's droplet with ffmpeg (720p H.264 and AAC MP4, every metadata track dropped, a poster frame taken) and the listing goes live once it is ready.
  - **Title** and **price** (fixed, negotiable, or "contact for price").
  - **Condition:** new, used, untested, or for parts.
  - **Features:** key and value pairs, for example Size 42, Bathrooms 3, Memory 8 GB, Storage (ROM) 128 GB, Colour Black, Engine type Petrol. The key is chosen from the **feature library** by searching (typing "ram" finds Memory, "rom" finds Storage), with the category's suggested keys offered first as chips; each key brings its icon, unit and kind of value (text, number with its unit, a choice, or yes or no). At most 20 per listing. A missing key can be suggested to admins; free-text keys are not allowed, so filters stay clean.
  - **Description:** rich text with bold, italic, bullet and numbered lists and paragraphs only (no links, images or HTML, which scammers use), at most 5,000 characters, stored as that limited Markdown and rendered escaped.
  - **Category**, picked by search (the title suggests one), and the location (country, state, then city or area, from a curated list: no free-text addresses and never coordinates), and how to be contacted (chat, phone or both). Lifecycle: `draft` → `pending_review` → `active` → `sold` | `expired` (after 30 days; renewable) | `rejected` | `removed`. Sellers edit, renew, mark sold and delete their own.
- **Limits:** free sellers get a number of active listings per category group per month (for example 10), set by admins; posting is rate limited.
- **Browsing:**
  - Home: categories, recent and featured listings, popular searches.
  - Category pages with **feature filters** (the category's filterable keys: a range for numbers, ticks for choices) and condition.
  - Search with filters (category, location, price range, condition, verified sellers, Safe pay, B2B) and sort (newest, cheapest, most expensive).
  - Listing page: photos and video (gallery, the video with its poster), price, condition, features with their icons, description, location, seller card (name, member since, verification badges, response rate, other listings), safety tips, Chat, Show phone, **Buy with Safe pay** (with the fee shown), Report.
- **Contact:**
  - **Chat** about a listing: text and photos; card numbers and codes masked; one conversation per buyer, seller and listing.
  - **Show phone:** signed in only, the seller's confirmed number (shown only when the seller has one and has chosen to show it), at most a few reveals per buyer per hour; each logged and counted for the seller as a lead.
  - Notifications through the existing inbox and push (`customer.classifieds.*`).
- **Favourites** (saved listings) for signed-in buyers.
- **Trust and safety:**
  - Automatic checks on each listing: prohibited words and categories, a price far below the category's usual range (a classic scam), the same photo used by another seller (perceptual hash), too many listings too fast.
  - Review queue: a new seller's first three listings and anything flagged.
  - Reports on listings and users (reason, details); three reports send a listing back to review at once.
  - Verification badges: phone confirmed, ID checked (Verify KYC), business verified (KYB).
  - Blocking: one user blocks another in chat. Admins suspend users and remove listings, audited.
  - Safety tips on every listing and at the start of every chat ("Use Safe pay, or meet in public, inspect before paying and never pay in advance"), each linking to the **Safe Trade Guide** (below).
- **Admin** (admin app, a new **Classifieds** section): moderation queue (approve, reject with a reason, ask for changes), reports, listings, users and shops (suspend, unsuspend), categories with their suggested features, the **feature library** (keys, icons, units, kinds of value, choices, search words, filterable) and suggested keys from sellers, areas, prohibited words, limits, Safe pay orders and disputes, Safe pay settings per country. Operations edit, support views, finance decides money; every action audited (`classifieds.*`).
- **SEO:** listing and category pages are server-rendered and indexed, with Product and Offer JSON-LD, a sitemap of active listings, and Open Graph images from the first photo. Sold, expired and removed listings leave the sitemap and answer 410 after a grace period.

### Safe pay (part of phase 1)

- **Settings** (admins, per country):
  - **The buyer's fee:** a rate (x%) and a cap, in the country's currency.
  - **The seller's fee:** a rate (y%) and a cap, in the country's currency.
  - Each fee is `min(price x rate, cap)`, rounded down to the currency's minor unit; a rate of 0 means no fee for that side. Both rates and both caps must be set before Safe pay opens in a country. Changes apply to new requests only: an order keeps the rates and caps it was requested under.
  - Also: the largest order during a seller's first five Safe pay sales, how long a seller has to accept (24 hours) and to hand over (for example 5 days), and how long a buyer has to confirm after delivery (for example 3 days).
- **Opting in (the buyer):**
  1. On any listing, the buyer presses **Buy with Safe pay** at the listed price, or agrees a price by **offer** in chat. They see the price, their Safe pay fee and the total before they ask, with what the protection covers.
  2. They choose **meet in person** or **delivery** (giving the delivery address, shown only to the seller once paid), and send the request.
  3. Buyers who do not opt in simply carry on in chat or by phone, and pay the seller directly.
- **Accepting (the seller):**
  - The seller is told and accepts or declines within 24 hours (no answer: the request lapses). Before accepting they see the price, their fee and what they will be paid. Accepting the first time asks for the identity check and a payout bank account in their verified name; a seller who cannot finish them declines.
  - Once accepted, the buyer has 24 hours to pay the total **from their BitoCard wallet** (the country's currency). Short of it, **Add funds** tops the wallet up as today and brings them back. Paying moves the total from the wallet to escrow in the same transaction that marks the order paid, once (the ledger's balance check stops parallel payments overspending). Nothing is reserved until it is paid. Safe pay needs customer wallets on in the market.
- **Paid:** the price and the fee are held in escrow, the listing shows as reserved, and the seller is told to hand it over.
- **Handing over:**
  - **Meet in person:** the buyer's app shows a **6-digit release code**. They inspect the item, then give the code; the seller enters it, and the money is released at once. The code is never shown to the seller and never sent in chat; the seller has 5 tries.
  - **Delivery:** the seller marks it **sent** (with a tracking note); the buyer confirms **received**, or it releases by itself when the confirmation time ends without a dispute.
- **Release:** the price less the seller's fee moves from escrow to the seller's withdrawable money (inside the payout hold), and both fees to BitoCard's revenue, in one journal entry, once.
- **Cancelling and refunds:**
  - Before hand-over either side can cancel: the buyer is refunded in full, **fee included**.
  - A seller who misses the hand-over deadline: refunded in full, fee included, automatically by the job.
  - Refunds go back to the buyer's wallet at once (where the money came from).
- **Disputes** (before release only):
  - The buyer opens one (not received, not as described, damaged), which stops the release.
  - Both sides add messages and photos. **BitoCard decides**: a full refund (fee included), a part refund (the rest to the seller, less the seller's fee worked out on that rest; the buyer's fee kept), or release to the seller (both fees kept). Operations decide; refunds need finance.
  - A refund that needs the item back is decided once the seller confirms it was returned. Decisions are audited.
- **Protection against abuse:**
  - A chargeback on the card top-up that funded the wallet is handled as for any customer wallet top-up; released money stays inside the payout hold, and a seller paid from recent card top-ups waits for review before a bank payout, as for P2P money.
  - New sellers have a lower order limit. A seller who loses disputes or cancels often is limited or suspended.
  - Buyer and seller must be different people, and not the same verified identity.
- **What each side sees:** both see the order, its status and timeline. The buyer sees the price, their fee and the total; the seller sees the price, their fee and what they will be paid. Neither sees the other's fee, and the seller never sees how the buyer paid. The seller sees the buyer's delivery address only after payment and only for delivery. Neither sees the other's bank details.

### Phase 2: shops, deals and B2B

- **Shops:** a business account (one owner; team members later) with name, logo, cover image, description, area, opening hours and categories, open to anyone; a business that passes **KYB through BitoCard Verify** gets the **Verified business** badge. A shop page (`/shop/s/<slug>`) lists its listings and deals, with a follow button.
- **Deals and discounts:**
  - **Price drops:** every price change is kept. A listing shows "was ₦X" only when that price was live for at least 7 of the last 30 days, so "was" prices are real (consumer law on fake discounts: Nigeria's FCCPA, the UK CMA's guidance).
  - **Shop sales:** a shop runs a sale (a percentage off chosen listings or all of them, with a start and an end). The listing shows the sale price, the "was" price and when the sale ends.
  - A **Deals** page and section across the market: the biggest real discounts first, by category and location.
- **B2B listings:** a listing can be offered to businesses, with a **minimum order quantity**, a unit (piece, carton, kg, tonne), **quantity price tiers** (for example ₦5,000 each for 10 to 49, ₦4,500 for 50 or more), stock available and delivery terms. Anyone can post B2B listings and anyone can buy from them. Buyers filter by **For businesses** and send a **request for quote** (quantity, delivery location, date), which opens a chat with the quote attached; an accepted quote can be paid with Safe pay.
- **Reviews:** after a Safe pay order is released, or after a conversation of a few messages, each side can leave one rating and comment; shown on seller cards and shop pages. Sellers can reply once.
- **Saved searches and alerts:** a buyer saves a search and gets a daily or instant notification of new matches.

### Phase 3: promotions and shop plans

- **Boosts**, bought per listing from the customer's wallet: **Top** (first in its category for 7 days), **Featured** (home and category carousels), **Urgent** (a badge). Prices per country set by admins.
- **Shop plans** (monthly, from the wallet): more active listings, B2B listings, sales, shop analytics (views, leads, phone reveals) and a custom shop address.
- Admin reports: Safe pay fees, boost and plan revenue, by country and category.

### Phase 4 (later): Safe pay additions

Courier integrations with tracked delivery, B2B orders paid by quantity, and partial shipments.

## Data model (Prisma, new migrations)

- **`classified_features`** (the feature library): `key`, `name`, `icon`, `kind` (`text`, `number`, `choice`, `boolean`), `unit` (GB, m², cc…), `choices`, `synonyms` (search words: RAM, ROM, rooms), `filterable`, `enabled`; seeded with the common ones (size, colour, brand, model, memory, storage (ROM), screen size, bedrooms, bathrooms, toilets, furnished, parking, land size, year, mileage, engine type, transmission, fuel, and so on). **`classified_category_features`**: the keys a category suggests, in order, and which of them are its filters.
- **`classified_categories`**: `id`, `parent_id`, `slug`, `name`, `icon`, `position`, `b2b`, `enabled`; availability per country in `classified_category_countries`.
- **`classified_areas`**: country, state, then city or area; seeded for Nigeria (36 states and the FCT with their main cities).
- **`classified_listings`**: `customer_id` (seller), `shop_id` (nullable), `category_id`, `country`, `area_id`, `title`, `description` (limited Markdown), `price_minor`, `currency`, `price_kind` (`fixed`, `negotiable`, `on_request`), `condition` (`new`, `used`, `untested`, `parts`), `b2b` (with `min_quantity`, `unit`, `stock`), `status`, `review_reason`, `published_at`, `expires_at`, `sold_at`, `search` (generated `tsvector`), `views`, `leads`. Indexes on status, country, category, area, price and published time; GIN on `search` and a trigram index on `title`.
- **`classified_listing_features`**: `listing_id`, `feature_id`, `value_text`, `value_number` (in the key's unit), indexed on feature and value for filters; values also go into the listing's `search`.
- **`classified_media`**: `listing_id`, `kind` (`photo`, `video`), `position`, `url`, `width`, `height`, `phash` (photos), `duration_ms` and `poster_url` (video), `status` (`processing`, `ready`, `failed`).
- **`classified_price_history`**: `listing_id`, `price_minor`, `from`, `to`.
- **`classified_conversations`**: `listing_id`, `buyer_id`, `seller_id`, `last_message_at`, block flags; unique on listing and buyer. **`classified_messages`**: `conversation_id`, `sender_id`, `body` (redacted), attachments, `read_at`.
- **`classified_offers`**: `conversation_id`, `price_minor`, `status` (`open`, `accepted`, `declined`, `expired`), `expires_at`.
- **`classified_orders`** (Safe pay, numbered `SP-000123`): `listing_id`, `buyer_id`, `seller_id`, `mode`, `price_minor`, `currency`, `buyer_fee_bps`, `buyer_fee_cap_minor` and `buyer_fee_minor` (the buyer's fee, fixed when they ask), `seller_fee_bps` and `seller_fee_cap_minor` (the seller's rate and cap, fixed when the buyer asks and shown to the seller before accepting), `seller_fee_minor` (taken at release, on what is released), `fulfilment` (`meet_up`, `delivery`), `delivery_address` (encrypted), `tracking_note`, `status` (`requested`, `declined`, `lapsed`, `awaiting_payment`, `paid`, `sent`, `released`, `cancelled`, `refund_pending`, `refunded`, `disputed`), `payment_id`, `release_code` (encrypted, shown to the buyer only) with `release_attempts`, deadlines (`accept_by`, `pay_by`, `handover_by`, `confirm_by`) and a timestamp per step.
- **`classified_disputes`**: `order_id`, `reason`, `status`, `decision` (`refund`, `partial`, `release`), `refund_minor`, messages with photos (private bucket, like chat files), `decided_by`.
- **`classified_safe_pay_settings`**: per country: the buyer's fee (`buyer_fee_bps`, `buyer_fee_cap_minor`), the seller's fee (`seller_fee_bps`, `seller_fee_cap_minor`), new-seller order limit, accept, pay, hand-over and confirmation times.
- **`classified_leads`**: phone reveals and first chats per listing and buyer (rate limits and seller stats).
- **`classified_favourites`**; **`classified_reports`**: `listing_id` or `reported_customer_id`, `reporter_id`, `reason`, `details`, `status`, `decided_by`.
- Phase 2: **`classified_shops`** (owner, slug, name, logo, cover, description, area, status, `kyc_case_id`, `plan_code`), **`classified_price_tiers`**, **`classified_sales`**, **`classified_quotes`**, **`classified_reviews`**, **`classified_saved_searches`**. Phase 3: **`classified_boosts`**.
- **Ledger:** `classified_escrow` (money held for Safe pay orders: BitoCard's liability, per mode and currency, never below zero) and `classifieds_revenue` (fees, later boosts and plans). Entries: `classified_order:<id>:paid` (price and the buyer's fee from the buyer's `customer_wallet` into escrow), `classified_order:<id>:released` (the price less the seller's fee from escrow to the seller's `customer_withdrawable`, both fees to revenue), `classified_order:<id>:refund` (the price and the buyer's fee from escrow back to the buyer's `customer_wallet`), `classified_order:<id>:partial` (a part of the price refunded, the rest to the seller less the seller's fee on it, both fees to revenue).

## Safe trade (trades without Safe pay)

Buyer and seller agree how to pay, inspect, test and stay safe. BitoCard gives them two things:

- **BitoCard's Safe Trade Policy** (`apps/legals`, `/documents/safe-trade-policy`, in `legalDocuments`; `legalUpdated` bumped): the rules, in plain words.
  1. What BitoCard does and does not do: it hosts listings and chat and runs Safe pay; it is not a party to a trade paid directly, does not hold, inspect or guarantee those goods or that money, and does not decide their disputes.
  2. Paying outside Safe pay is agreed between the two; never pay in advance for an item not seen; BitoCard never asks anyone to pay it outside the wallet, and never asks for a release code, password or one-time code.
  3. Meeting: a public, busy place in daylight; bring someone or tell someone; never to a remote place or a stranger's home; property and vehicles only with their documents.
  4. Inspecting and testing before paying, with the category's checklist.
  5. Red flags: urgency, prices far below the market, deposits or "delivery fees" up front, fake payment alerts and screenshots, overpayment and refund requests, moving the chat off BitoCard, asking for codes.
  6. Sellers: hand over only once the money shows in their own bank or mobile money app (never an SMS or screenshot); check cash.
  7. Prohibited items (the marketplace terms) and personal data: share only what a trade needs, never ID photos.
  8. Reporting and blocking; what BitoCard does about it (removal, suspension, help to the police on a lawful request).
  9. Safe pay as the protected option, and its release code given only after inspection.
- **The Safe Trade Guide** (`/shop/safe-trade`, short and printable): a checklist for each side.
  - **Before meeting:** chat on BitoCard; check the seller's badges and reviews; is the price realistic; agree the place, time and how to pay; tell someone.
  - **At the meeting:** public place, daylight; inspect and test with the category's checklist; check documents and serial numbers; pay only when satisfied, and confirm a transfer in the banking app.
  - **Sellers:** money in your account before hand-over; refuse overpayments; check notes.
  - **Category checklists**, set by admins per category (`classified_categories.safety_checklist`): phones (powers on, IMEI matches the box and is not blacklisted, iCloud or Google account signed out, charging, camera and screen), laptops (charger, battery, keyboard, storage), vehicles (papers in the seller's name, chassis number, a mechanic, a test drive), property (title documents, the agent's identity, never pay to view), animals, and so on.
  - Shown in short on every listing and at the start of every chat, and before Show phone the first time.

## Country and locality

- **Country** is a hard boundary, from the store's address (above): every query is limited to that country.
- **Locality is a ranking, never a filter.** Areas are country, state, then city or area (`classified_areas`), each area with a centre point (public map data, never anyone's position), so nearby areas can be ordered by distance.
  - The visitor chooses their locality ("Lagos > Ikeja"); it is remembered in a cookie, and a signed-in customer can save a home area on their profile. An optional **Use my location** matches them to the nearest area in the browser; the position is never sent or kept.
  - Never guessed from the IP address: Nigerian mobile networks often route through Lagos, so a buyer in Abuja would see Lagos.
  - Results run local first: in the area, then nearby areas, then the rest of the state, then the whole country, each as its own heading, so a small town's search is never empty. In SQL: the country always in the `WHERE`, then sorted by that tier before the chosen sort (listings keep `state_id` beside `area_id`; index on country, status, state and area).
- **Delivers to:** a seller can mark a listing "Delivers to my state" or "nationwide"; it then also shows in other areas' results, labelled **Delivers to you** (most useful for shops and B2B).
- **Location pages** for search engines: `/shop/lagos`, `/shop/lagos/ikeja`, `/shop/lagos/ikeja/phones`, server-rendered with their own titles, one sitemap per country store; a page with very few listings points search engines to its state's page so thin pages do not hurt the rest.

## API (`/v1/classifieds`, `src/classifieds`)

- **Public, cached a minute** (`@Public`, `?store=<country store>`, which sets the country; `area` and `near` for the locality): `GET features?q=` (the library, searched by name and search words), `GET categories` (with their suggested features), `GET areas`, `GET listings` (filters, sort, cursor paging), `GET listings/:id`, `GET search/suggest`; phase 2 `GET shops/:slug`, `GET deals`.
- **Signed-in customers** (`CustomerGuard`, the house store's accounts):
  - Listings: `POST/PATCH/DELETE listings(/:id)`, `POST listings/:id/media` (multipart, a photo or the video), `PATCH listings/:id/media` (order), `DELETE listings/:id/media/:media`, `POST listings/:id/renew|sold`, `GET me/listings`.
  - Contact: `POST listings/:id/phone` (reveal), `GET/POST conversations(/:id/messages)`, `POST conversations/:id/block`, `GET/POST/DELETE favourites`, `POST reports`.
  - Safe pay: `GET listings/:id/safe-pay` (the buyer's fee and total), `GET me/safe-pay` (what a seller still needs: identity check, payout account), `POST conversations/:id/offers`, `POST offers/:id/accept|decline`, `POST orders { listing_id | offer_id, fulfilment, delivery_address? }` (the buyer's request), `POST orders/:id/accept|decline` (the seller; the order shows them their fee and payout first), `POST orders/:id/pay` (the buyer, once accepted: pays from the wallet, `wallet_balance_low` saying how much to add), `GET orders(/:id)` (as buyer or seller), `GET orders/:id/release-code` (the buyer, once paid, meet-up only), `POST orders/:id/release { code }` (the seller), `POST orders/:id/sent { tracking_note }`, `POST orders/:id/received`, `POST orders/:id/cancel`, `POST orders/:id/dispute` (+ messages and photos).
- **Admin** (`/v1/admin/classifieds`): moderation queue and decisions, reports, listings, users, categories and their suggested features, the feature library and sellers' suggested keys, areas, limits, prohibited words, Safe pay settings per country, orders, and disputes (`POST disputes/:id/decide { decision, refund_minor?, note }`, refunds finance only, behind the step-up window); all audited.
- Left out of the public OpenAPI document, like the store's customer endpoints, so resellers' API is unchanged. Gated by the switches (`classifieds_unavailable`, `safe_pay_unavailable`).
- **Payments:** no payment pages of its own: Safe pay is paid from the wallet (the `customer_wallet` ledger account, as wallet purchases are), and wallets are topped up through the existing top-ups. The escrow entry is written in the same transaction as the order turning `paid`.
- **Jobs** (in `cron.json`, run by the droplet's scheduler): `classifieds` every 15 minutes (expire listings and offers, lapse requests not accepted or not paid in time, refund orders past their hand-over deadline, release delivered orders past their confirmation time, send saved-search alerts, re-check flagged listings); a daily cleanup (photos of deleted listings, old conversations by the retention rule).

## In the storefront (`apps/storefront`)

Built in the storefront like the rest of the customer account app: server components fetching the API on the server, the customer's existing `bc_customer` session, the store's design tokens, mobile first, no horizontal scroll at phone width. Only on BitoCard's country stores where `classifieds` is on; elsewhere the tabs stay as they are.

- **Tabs** (`components/app/tabs.ts`): Home, Catalog, Orders, Wallet, Crypto, **Shop** (`/shop`). Account leaves the tabs and is reached from the header's account button and the menu drawer (Profile, Security, Identity check, Help & support, sign out); Shop's sub rail and pills follow the existing sub menus (`components/app/sub-menus.ts`, a `shop` menu).
- **Public and signed in alike:** `/shop` and its browsing pages (home, categories, locations, search, listings, shops) are public and indexed. Its layout shows the account app's shell, with Shop current, to signed-in customers, and the store's header and footer to visitors (a route group of its own, since `(app)` requires sign-in). Everything that acts (post, chat, favourite, Show phone, Safe pay) asks visitors to sign in and returns them (`next`).
- **Pages:**
  - Browse: `/shop` (search with locality, category grid, near you, recent), `/shop/c/<category>`, `/shop/<state>(/<area>)(/<category>)`, `/shop/search?q=`, `/shop/l/<id>-<slug>` (a listing), phase 2 `/shop/s/<shop>` and `/shop/deals`.
  - **Post an ad:** `/shop/post`, one short screen on a phone: photos and video first (camera or gallery, several at once, drag to reorder), then title, category, price, condition chips, features (the category's suggested keys as chips, a search for any other), description, then location (the saved area by default), delivery, contact and Safe pay. The draft saves as they go; uploads run in the background while they type.
  - **My listings:** `/shop/listings` (active, in review, sold, expired; edit, renew, mark sold, delete).
  - **Messages:** `/shop/messages(/<id>)`, chats about listings, with offers.
  - **Orders:** `/shop/orders(/<id>)`, Safe pay orders as buyer (status, pay, release code, received, dispute) and as seller (accept or decline, hand-over, enter the code, mark sent), apart from the Orders tab's store orders. Buying is `/shop/l/<id>/buy` (price, fee and total, what is covered, meet-up or delivery, send the request; then pay once the seller accepts).
  - **Favourites:** `/shop/favourites`. **Safe pay:** `/shop/safe-pay` (identity check and payout account, to be paid).
  - **Safe trade:** `/shop/safe-trade` (the Safe Trade Guide, with each category's checklist), linked from every listing, chat and Show phone, and from the footer; the policy itself is on the legals site.
  - Phase 2: `/shop/my-shop`.
- Shared code from `@bitocard/ui` and `@bitocard/api-client` (a `classifieds` entry with its types), the account app's `Slider`, chat and photo components. Tests in `apps/storefront/test` (Vitest) for every `lib/` helper and server action.

## Legal owed before switching on in a market

- **Safe pay, before taking any payment:** BitoCard holds buyers' money for third parties and pays sellers, and Safe pay turns spend-only wallet money into a seller's withdrawable money, which may be a regulated payment or escrow service in each country (Nigeria: CBN payment service licensing; take advice on whether a licensed partner must hold the funds). Safe pay terms: that it is the buyer's choice, its fees (the buyer's and the seller's, each a percentage of the price up to a cap; the buyer's refunded when the item does not change hands, the seller's taken only from money released to them), holding, release codes, deadlines, cancellation, refunds and disputes, that BitoCard is not the seller and does not inspect goods, and sellers' payouts with the payout hold. Until cleared, Safe pay runs only in the sandbox (`classifieds_safe_pay` off live).
- **BitoCard's Safe Trade Policy** (see Safe trade): drafted for the legals site and reviewed by lawyers, so it guides without implying that BitoCard guarantees or takes part in trades paid directly.
- **Marketplace terms** (`apps/legals`): BitoCard hosts listings and is not a party to a sale paid directly; sellers' warranties (they own the goods and the listing is true); prohibited items (weapons, drugs, counterfeit and stolen goods, restricted animals, financial products, adult content and anything illegal locally); honest prices and "was" prices; moderation, removal and suspension; reviews; boosts and shop plans.
- **Privacy notice:** listings and seller profiles are public; phone numbers shown to signed-in buyers who ask; chats kept for a set period and read by moderators only on a report or dispute; photo and video metadata removed; leads and views counted; delivery addresses shown only to the seller; payment, payout and dispute data and their retention; Verify checks for Safe pay sellers and shops.
- **Per country:** consumer protection on pricing and discounts (Nigeria FCCPA), data protection (NDPA), and any rules on online marketplaces and particular categories (vehicles, property, jobs, animals). Lawyers' review before launch.

## Order of work for phase 1

1. Migrations and seed: categories, the feature library with icons and each category's suggested features, Nigerian areas, the switches, Safe pay settings.
2. API: listings (create, edit, lifecycle, limits), features, photos and the video through the API (ffmpeg in the API image for the video), public reads and search, automatic checks and moderation, reports, favourites.
3. API: conversations and messages, offers, phone reveal and leads, notifications.
4. API: Safe pay: the buyer's request with the fee, the seller's acceptance and set-up, orders paid from the wallet, escrow entries, release codes, sent and received, deadlines in the job, cancellations and refunds, disputes and admin decisions, release into the payout hold.
5. Admin app: the Classifieds section (queue, reports, listings, users, categories, limits, Safe pay orders, disputes and settings).
6. Storefront: the Shop tab (Account to the header), the `/shop` route group and its sub menu, browsing and location pages, post an ad, my listings, messages, Safe pay (buy, orders, release code, set-up), favourites.
7. SEO for the country stores' Shop pages (sitemaps per country, titles, JSON-LD) and the `bitocard.com/shop` redirect.
8. Tests: the API on PGlite and Postgres (Safe pay money paths with parallel requests, as for P2P trades), the app's Vitest; legal drafts; then a closed pilot in Nigeria, with Safe pay in the sandbox until legal clearance.
