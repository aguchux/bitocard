# Udozo seller ratings: three kinds

Status: **all four phases built, 5 November 2026**: 0 (buy orders), 1 (post-purchase reviews), 2 (private interaction ratings) and 3 (Anjio's scores and summaries).
Phase 0 as built differs from the plan below in one way: a buy order is always paid in person (`payment` and
`order_id` are not stored). Where Safe pay is open, the listing still offers Buy with Safe pay beside Buy this, as its
own order; both kinds of completed order open reviews. Phase 1 as built differs in one way: the seller summaries are worked out when read (`ReviewStatsService`, last 12
months, one voice per reviewer) instead of kept in a `classified_seller_review_stats` table. The To confirm tab (Yes,
I bought it, or No), editing one's reply for 15 minutes and the chat report reason `review_pressure` were added
afterwards, the same day; the terms version stayed `2026-11-05` (reviews were in the terms before anything shipped).
Phase 2 as built differs in these ways: the seller's summary is worked out when read (ratings up to the last midnight,
UTC, which does what "refreshed nightly" was for) and counts the last 12 months; admins can also put a left-out rating
back; and the seller's page is a Private ratings tab under Reviews (`/account/ratings`) rather than its own place.
Phase 3 as built differs in these ways, kept on purpose: each seller is scored by a few queries of their own (not
set-based SQL per metric), the job stopping at four minutes and carrying on at the next hourly run (the rows done today
are the cursor), which is enough at launch scale; the overall score needs at least 30 of weight behind it, so never one
metric alone; the bands are Excellent from 85, Very good from 70, Good from 55 and Fair from 40; costing leaves out the
seller's own listings; and reliability's strikes are the Safe pay standing's (90 days) while the rest looks back 180.

## Context
Udozo (udozo.com) has no ratings or reviews today. Buyers judge sellers only by two badges (phone confirmed, ID checked) and "answers N% of chats". The owner wants three kinds of ratings:
1. **System ratings by Anjio** (Udozo's AI assistant): response time, attention to requests, pricing performance, competitive costing.
2. **Post-purchase reviews**: Positive, Neutral (admin-gated, default off) or Negative. They are threaded: the seller replies, and other buyers of the same product from the same seller can join to agree or counter.
3. **Pre-purchase ratings**: anyone who chatted with or called a seller rates the interaction, to analyse salesmanship.

**Owner's decisions (5 November 2026):**
- **Who may review:** buyers of a completed **buy order**, built first (phase 0 below). Buyers send a request with their price, the seller must accept it before they meet, and payment is offline today (Safe pay too where it is open). The seller then marks the order sold, which records who bought what and starts the review. Completed Safe pay orders count as well. The earlier "pick the buyer from your chats" idea is dropped in favour of buy orders.
- **"Same product":** same brand and model from that seller, falling back to the same listing when the ad has no model.
- **Pre-purchase ratings:** private. The seller sees an anonymous summary, admins see everything.
- **Anjio:** computed scores every night, plus a 1–2 sentence AI summary per active seller.

Build only in `apps/udozo-api`, `apps/udozo`, `apps/udozo-admin` and `packages/api-client`, never `apps/api`. The contract is copied into `docs/UDOZO_RATINGS_PLAN.md`, and each phase adds its AGENTS.md entry when it ships.

## Defaults chosen (change at approval if wanted)
- **Not reviewable for now:**
  - resale orders, where the buyer bought through a reseller's store;
  - fully refunded orders (their outcome feeds Anjio's reliability score instead);
  - sandbox orders.
- **Timing:** reviews open on completion and close after 30 days, with reminders on day 2 and day 7. A review can be edited 3 times within 30 days, and every version is kept for admins. Withdrawing is allowed.
- **Showing a percentage:** "N% positive" counts the last 12 months, one voice per reviewer (their latest review only). Neutrals are listed but left out of the %, and the % shows from 3 counted reviews.
- **Effect on ranking and access:** none in this plan. Scores are informational, so search, discovery and Safe pay are unchanged.
- **No `aggregateRating`/`Review` JSON-LD:** these are seller-service reviews, not product reviews, so marking them up would be misleading. Reviews still render as server HTML, so they are indexable.

## Phase 0 (first): buy orders (purchase requests)
**Why:** today sellers meet buyers and agree the deal off Udozo, so nobody knows who bought what. A buy order is the single place a purchase starts: the buyer asks at a price, the seller accepts before they meet, they transact (mostly cash or transfer in person), and the seller marks it sold. That records the buyer, completes the purchase and opens their review.

**Data** (migration `…_buy_orders`; its own table, because Safe pay's `classified_orders` is built around fees, escrow and the ledger):
- **`classified_buy_orders`:**
  - Number `BO-000123`, `listing_id`, `buyer_id`, `seller_id`, `conversation_id` (the listing's chat, created if needed; SetNull), `country`, `currency`.
  - `price_minor`: the buyer's price, the listing's price by default, or lower like an offer. `counter_minor`: the seller's counter price, if any.
  - `quantity` (1, up to the listing's stock), `payment` (`offline` | `safe_pay`), `note` (up to 300 characters, cleaned), `meet_note` (where and when, cleaned).
  - `status`: `requested` → `countered` → `accepted` → `completed`; or `declined`, `cancelled` (by whom, with why), `lapsed` (not answered in time), `expired` (not completed by the meet deadline), `no_show` (reported by either side), `voided` (the buyer said they didn't buy).
  - Times: `respond_by` (48h), `meet_by` (accepted + 7 days, the seller may extend once), `completed_at`, `buyer_confirmed_at`, `voided_at`, and `*_reminded_at` (each claimed once).
  - `order_id`: the Safe pay order it handed off to, if any.
  - **Uniqueness:** one open order per (buyer, listing), enforced by a partial unique index.
- **Market settings:** `buy_request_hours` (48), `buy_meet_days` (7), `buy_open_per_buyer` (10), `buy_requests_per_day` (20).

**Flow:**
1. **The buyer asks.** "Buy this" on the listing page (and Make an offer in chat) opens one form:
   - **price:** the asking price, or their own;
   - **quantity**, an optional note, and preferred meeting place and time;
   - **payment:** "Pay the seller in person" (offline), plus "Safe pay" only where `classifieds_safe_pay` is open in the market. Choosing Safe pay hands off to the existing `SafePayService.request` (`safe-pay.service.ts` L269) unchanged and records `order_id`.

   Checks: a confirmed email and mobile (the mobile can't be put off till later here, as for calls); never their own listing; never the same person as the seller; the listing is live, priced and in stock. A system card goes into the chat, and the seller gets an inbox notice and a push.
2. **The seller answers within 48 hours:**
   - **Accept:** the meet deadline starts, and the units are **held**. Accepted orders count with `holdingStatuses` (`rules.ts` L29), so two buyers can't both be accepted for a one-off item. The listing shows "Reserved" when all its stock is held.
   - **Counter** with a price: the buyer accepts or declines it within 48 hours.
   - **Decline**, with an optional reason.
   - **No answer:** the order lapses, the buyer is told, and it counts against Anjio's attention score.
3. **Before meeting:**
   - Either side may cancel, with a reason. A seller cancelling after accepting counts against reliability.
   - Either side may report "They didn't show up" once the meet time has passed (`no_show`, recorded for scores and abuse).
   - Reminders go out 24 hours before `meet_by`. With no outcome by then the order expires and the hold is released.
4. **The seller marks it sold** ("Sold to Ade"), from the order or from the listing's Mark sold, which offers its accepted buy orders first:
   - the status becomes `completed`;
   - stock drops, and the listing is sold at 0, as Safe pay's release does;
   - a **purchase** row is written (`source: buy_order`), and the buyer is told: "You bought <item> from <seller>. Rate the seller."
   - The buyer may also say "I didn't buy this" within 7 days. That sets `voided`, which removes the purchase and its review, counts against the seller, and pauses their buy orders after 3 voids in 90 days.
   - Writing a review counts as the buyer's confirmation (`buyer_confirmed_at`).
5. **The buyer can complete it too:** "I bought it" on an accepted order asks the seller to confirm. If the seller says nothing in 3 days, the order completes.

**Abuse limits:** at most 10 open requests per buyer and 20 a day, one open request per listing, the `samePerson` check when asking and when completing, only accepted orders can be completed, and voids pause a seller.

**API** (`src/classifieds/buy-orders/`, customer routes under `/v1/classifieds/`):
- `POST listings/:id/buy-orders`, `GET me/buy-orders?role=buyer|seller&status`, `GET buy-orders/:id`.
- The seller: `POST buy-orders/:id/accept|counter|decline`. The buyer: `POST buy-orders/:id/accept-counter`.
- Either side: `POST buy-orders/:id/cancel|no-show`. Completing: `POST buy-orders/:id/complete` (seller) and `…/bought` (buyer). `POST buy-orders/:id/void` (buyer, within 7 days).
- **Refusal codes:** `own_listing`, `listing_unavailable`, `out_of_stock`, `buy_order_open`, `buy_limit_reached`, `phone_required`, `same_person`, `buy_order_not_pending`, `buy_order_closed`, `meet_not_passed`, `buy_orders_paused`.
- **Admin:** `GET /v1/admin/classifieds/buy-orders?status&country&seller` and the detail, plus `POST sellers/:customer/buy-orders/pause|unpause { reason }`. Audited.
- **Switch:** `classifieds_buy_orders` (Udozo only, global or country). It can go on in Nigeria by itself, before reviews.
- **Notices:** `customer.classifieds.buy_request`, `buy_countered`, `buy_accepted`, `buy_declined`, `buy_lapsed`, `buy_cancelled`, `buy_meet_reminder`, `buy_completed`, `buy_voided`. Emails only for a new request and an acceptance, and never what anyone wrote.
- **Cron:** the 15-minute `classifieds` job handles lapses, meet-deadline reminders and expiries, buyer "bought" auto-completion and releasing holds. It is safe to run twice, since every step is claimed in one conditional update.

**udozo.com:**
- **Listing page:** "Buy this" in `ListingActions` (`components/listing-actions.tsx`) beside Chat and Call, opening the buy form as a sheet on phones.
- **Chat:** a system card for each step, with that step's buttons.
- **Account > Orders** (`app/(account)/account/orders`) gains a **Buy orders** tab, buying and selling. Each order page shows the steps, the seller's Accept, Counter and Decline, Mark sold, Cancel, I bought it, They didn't show up and I didn't buy this.
- **Mark sold** offers the listing's accepted buy orders.
- All confirmations use `useConfirm`. Mobile first.

**Admin:** Marketplace > Buy orders (list and detail with every step, Pause buy orders on a seller).

**Legal:**
- **Terms:** a buy order is an agreement between buyer and seller. Udozo is not the seller, and offline payments are at the parties' own risk (the Safe Trade Guide applies). Marking a sale that didn't happen, or denying one that did, breaks the terms.
- **Privacy notice:** buy orders, what the other side sees.

**Tests:**
- `apps/udozo-api/test/buy-orders.test.mjs`: every transition and refusal, holds against stock, lapses, expiry and auto-complete by the cron, counters, the void window and pause, `samePerson`, the Safe pay handoff only where it is open, and the switch off.
- `apps/udozo/test/buy-orders.test.ts`: the form, the chat cards, the orders tab and the dialogs.
- `apps/udozo-admin/test/buy-orders.test.tsx`.

## Phase 1: post-purchase reviews
**Data** (migration `…_seller_reviews`, made with `npm run db:migrate:create -w @udozo/api`):
- **`classified_purchases`:** one row per completed purchase, the ledger of review and thread rights. `source` is `safe_pay` or `buy_order`, with exactly one of `order_id`/`buy_order_id`. A voided buy order deletes its purchase and any review. Also: listing, seller, buyer, country, `product_key`, `product_label`, `completed_at`, `review_closes_at`, and `remind1_at`, `remind2_at`, `dismissed_at` (each claimed once).
- **`classified_reviews`:** `purchase_id` unique, so one review per purchase. Fields:
  - `rating` (positive, neutral or negative);
  - `aspects` (as described, communication, handover; each up or down);
  - `body` (up to 1000 characters);
  - `status` (published, held, removed or withdrawn) with held reasons;
  - edit history, and `edited_after_reply`;
  - thread lock and post count.
- **`classified_review_posts`:** a flat thread, one level, with an optional `reply_to`. `role` is seller, reviewer or buyer. A buyer post carries the `purchase_id` that grants the right, and a required `stance` (agree, disagree or context). Body up to 600 characters.
- **`classified_review_reports`:** reasons are fake, not a buyer, offensive, personal info, contact or links, threat or extortion, off topic, or other.
- **`classified_seller_review_stats`:** a denormalised row per seller (12-month counts, `positive_pct`, Safe pay share).
- **Market settings** (`classified_market_settings`): `reviews_neutral` (false), `review_window_days` (30), `review_min_shown` (3).
- **`classified_sellers`:** `reviews_blocked_until` (for reviewers caught extorting or faking). Phase 0 adds `buy_orders_paused_until`/`reason`.

**Flows:**
- **Safe pay:** inside `settle()`'s transaction (`safe-pay.service.ts` ~L1131, its `extra` hook), when an order becomes `released` or `partly_refunded` and is direct and live, insert a purchase row. Its product key comes from the new `productKeyOf()`, which uses `ClassifiedBrandsService.match` and `ClassifiedModelsService.match` (`models.service.ts` ~L170). After the commit, `tell()` (~L1283) sends direct buyers a completion notice with the review prompt (`customer.classifieds.review_invite`); they get no completion notice today. The migration backfills 12 months of past orders.
- **Buy orders:** completing a buy order (phase 0) writes its purchase row in the same transaction. Reviews from accounts under 7 days old, or from orders completed under an hour after acceptance, are held for a moderator.
- **Writing a review:** the caller must be the purchase's buyer, inside the window, with no review yet.
  - **Neutral** only where the market allows it.
  - **Negative** needs at least 20 characters or a down aspect.
  - **Text cleaning:** `cleanNote` style (`contact.service.ts` L27) hides links, codes and phone numbers, and also masks emails.
  - **Refused words:** a block word refuses the review, a review word holds it for admins.
  - Also checked: `same_person`, the current shop terms accepted, and not blocked from reviewing.
- **Thread rights:**
  - the reviewer, the seller, and buyers with a purchase of the same seller and `product_key` in the last 12 months (not the review's own purchase);
  - post caps: 5 for the reviewer and the seller, 3 for each other buyer, 50 per thread, 20 a day per author;
  - edits within 15 minutes;
  - a thread locks after 12 months or by an admin;
  - reply notices are in-app only, at most every 10 minutes (emails never carry what people wrote).
- **Moderation:**
  - 3 open reports, or any threat or extortion report, put the review on the admins' list. Nothing is hidden automatically.
  - Removing or restoring needs a reason and is audited (`classifieds.review_removed`), and the author is told.
  - Proven extortion blocks the reviewer for 180 days.
  - A new chat report reason, `review_pressure`, covers sellers pressuring buyers.

**API** (new `src/classifieds/reviews/`: `product-key.ts`, `purchases`, `reviews`, `review-threads`, `review-moderation` services, `reviews.controller.ts`, `admin-reviews.controller.ts`):
- **Customer routes:**
  - `GET me/purchases?state=to_review`
  - `POST purchases/:id/review`, `POST purchases/:id/dismiss`
  - `PATCH|DELETE reviews/:id`
  - `POST reviews/:id/posts`, `PATCH|DELETE review-posts/:id`
  - `POST reviews/:id/report`
  - `GET reviews/:id/viewer`
  - `GET me/reviews?role=given|received`
- **Public routes** (cached a minute): `GET sellers/:key/reviews?product&rating&source&sort` and `GET reviews/:id`.
  - Reviewers are shown by first name and initial, photo, product, month and source ("Safe pay purchase" or "Buy order"). Never price, contact details or order numbers.
  - The `sellers/:key` profile gains `reviews`.
  - `listings/:ref` gains `seller.reviews` and `product_reviews` (top 3).
  - Cards gain `seller.rating`, looked up in one batch per page like `sellerBadges`.
- **Refusal codes:**
  - reviews: `review_not_open`, `review_closed`, `review_given`, `rating_invalid`, `review_reason_required`, `review_prohibited`, `reviews_blocked`, `same_person`;
  - threads: `thread_not_allowed`, `thread_locked`, `thread_post_limit`, `post_edit_closed`, `report_exists`;
  - the switch: `reviews_unavailable`.
- **Admin routes:** `/v1/admin/classifieds/reviews` (queue tabs: reported, held, all, flags), plus publish, remove, restore, lock, remove post, decide report, block reviewer, and the new market settings. Operations change, support reads, all audited.
- **Switch:** `classifieds_reviews` (Udozo only, global or country, off by default). Purchase rows are recorded even while it is off.
- **Notices** (`inbox.ts`): review invite, reminder, received, reply, removed. Admin: review reported, review held. Emails only for the invite and the reminder, never anyone's text.
- **Cron:** the 15-minute `classifieds` job sends reminders (claimed once).

**udozo.com:**
- **Order page** (`components/account/order-detail.tsx`): a review card (segmented rating, aspect chips, text, a confirm before posting a negative review), then the posted review and its thread. The Orders list gets a "Rate it" chip.
- **Account > Reviews** (`/account/reviews`): tabs To review, To confirm (Yes or No with a reason), Your reviews, About you (with Reply).
- **Buy order page:** once completed, the review card sits there too, beside I didn't buy this.
- **Seller page:** positive % in its stats, and a Reviews section (summary bar, product filter chips, newest or negatives first, threads folded after 2 replies, Reply and Report for allowed viewers).
- **Listing page:** the seller card shows "98% positive · 120 reviews", plus "Reviews of <product> from this seller" (top 3).
- **Listing cards:** a rating chip.
- All of it mobile first (320, 360 and 390 px), with Udozo's own `useConfirm` dialogs.

**Admin:** Marketplace > Reviews (queue, detail with versions, thread, reports and evidence, `ActionDialog` actions with reasons); a Ratings card on the seller page; the new fields in Limits and words.

**Legal** (`apps/udozo/lib/legal.ts`; bump `shopTermsVersion`):
- **Terms**, a new "Reviews and ratings" section:
  - verified buyers only;
  - forbidden: fake, self, paid or incentivised reviews, sellers offering refunds or discounts to change a review, buyers demanding things in exchange for one, contact details, threats;
  - the seller's right of reply;
  - moderation and appeal;
  - marking a buy order sold that didn't happen breaks the terms.
- **Privacy notice:** what is public. A "How reviews work" link sits beside every summary bar.

## Phase 2: pre-purchase (interaction) ratings, private
- **`classified_interaction_ratings`:**
  - rater, seller, listing, `channel` (chat, call, callback or contact), the source id with no foreign key (sources are purged);
  - `responsiveness`, `helpfulness` and `courtesy` (1–5 each);
  - tags such as answered fast, clear answers, honest about the item, pushy, rude, no reply, no show, price changed, item unavailable, asked to pay outside, asked for upfront payment;
  - a comment for admins only, `flagged`, `excluded_at`;
  - unique (rater, listing).
- **`classified_interaction_prompts`:** records shown and dismissed prompts.
- **Who may rate:**
  - **Chat:** the buyer sent at least 2 messages and the seller replied, or the buyer sent at least 1 and got no reply in 24 hours.
  - **Call:** answered or ended, or missed after ringing at least 10 seconds.
  - **Contact or call-back request:** answered or done, or still pending after 48 hours.
  - **Limits:** once per (rater, listing), editable for 30 days, once per (rater, seller) per 30 days, 10 a day. Never yourself or the same person as the seller.
  - **Safety tags** flag the rating to admins.
- **Prompts:** a slim card in the chat, on a call's end screen, and on an answered request. Dismissible, at most one a day.
- **Seller sees:** an anonymous aggregate on `/account/ratings`, only from 5 ratings and refreshed nightly, with no per-listing breakdown.
- **Admins see:** everything, and can exclude a rating.
- **Switch:** `classifieds_interaction_ratings`.
- **Routes:** `GET interaction-ratings/state?listing_id`, `POST|PATCH interaction-ratings`, `POST …/prompt/dismiss`, `GET me/ratings`, and admin `GET sellers/:customer/ratings`, `GET interaction-ratings?flagged=1`, `POST …/:id/exclude`.

## Phase 3: Anjio's scores and AI summary
**`classified_seller_scores`** (one row per seller, recomputed nightly): each metric's 0–100 score and sample size, `overall_score` and band, `details` (breakdown and tips), `interaction_summary`, an inputs hash, and the summary text with its provider, model, tokens, cost, input hash, written and hidden fields. `classified_seller_score_months` keeps monthly snapshots for 24 months.

**Metrics** (90 days unless stated; null below the minimum sample):

| Metric | How it's worked out | Minimum sample |
|---|---|---|
| **response** | Median time to the seller's first reply; a missing reply counts as 7 days. ≤15 min scores 100, 1h 85, 4h 65, 24h 30, 7 days 0. | 5 chats |
| **attention** | Weighted share answered: chats, contact requests, call backs (×1.5), calls (missed 0, declined 0.5), offers decided rather than expired, Safe pay requests (×2) accepted or declined rather than lapsed. | 8 requests |
| **pricing (honesty)** | Starts at 100. Minus 50 × the share of contacted listings whose price went up within 7 days of first contact; minus 30 × the share priced "on request"; minus 20 × the share sold above the listed price. | 5 listings |
| **costing (competitive)** | Each live listing (price plus delivery) placed against the p25–p75 of comparable listings (same SQL as Anjio's `price_range` in `assistant/tools.ts` ~L310: at least 8 comparables, category, condition, brand and model). At or below p25 scores 100, p75 scores 50, twice that range 0. Prices under half the median are left out and flagged, never rewarded. | 3 listings |
| **reliability** | 180 days. Completed ÷ (completed + strikes + 0.5 × lapsed requests + voided or no-show buy orders + seller cancellations after accepting). Strikes are counted as in `SafePayGuardsService.standing`. | 3 orders |
| **satisfaction** | Reviews, Bayesian-smoothed (m = 5) towards the market's positive share. | 3 reviews |
| **salesmanship** | Interaction ratings, Bayesian-smoothed; new or prolific raters count half. Never public. | 5 ratings |

- **Overall:** a weighted mean of what's available. Weights: reliability 25, satisfaction 25, response 15, attention 15, salesmanship 10, costing 5, pricing 5.
- **Bands:** Excellent (85+), Very good, Good, Fair, Needs work.
- **What the public sees:** response and attention always (as words, e.g. "Replies within an hour"); the overall badge only at Good or better; the other metrics only in their top two bands.
- **What sellers see:** numbers and tips, e.g. "6 of your 20 chats waited over a day".
- **New sellers:** "New seller: not enough to rate yet" until there's enough data.

**AI summary:**
- **Who gets one:** active sellers with an overall score.
- **Inputs:** structured figures only (bands, words, counts, aspect counts, top categories, since when, the market's language). No names, messages, review text or prices.
- **Prompt rules:** 1–2 factual sentences, at most 240 characters, through one `write_summary` tool call. No numbers that aren't in the input, no names, no "safe", "trustworthy" or "guarantee" claims, no payment advice, no comparisons with other sellers.
- **Checks after writing:** length, every number present in the input, `redact`, refused words and the claim deny list. If anything fails, the previous summary is kept.
- **When refreshed:** only on a material change (a band changes, overall moves 5 points, counted reviews change 10%) or when it is over 30 days old.
- **Cost and budget:**
  - written with Anjio's model via `AiService.reply` (`support/ai/ai.service.ts` L175) under a new `AiKind` `shop_summary`;
  - `checkBudget` (`assistant/assistant.service.ts` L225) counts `shop` and `shop_summary` together, so they share the cap;
  - new bot limits: `summaries_daily` (default 50 at launch), `summary_budget_share` (0.25) and an optional cheaper `summary_model`;
  - the job stops at the share, at 90% of the budget or at the daily cap.
- **Display:** under the scores, with "Written by Anjio, Udozo's AI assistant, from Udozo's figures. It can be imperfect. How Anjio rates sellers."
  - Never in metadata or JSON-LD.
  - Sellers can report it; admins can hide it with a reason or regenerate it.

**Job:**
- A new Udozo-only daily cron `seller-scores` in `cron.controller.ts`, `vercel.json` and `test/vercel-crons.test.mjs`, running hourly from 01:17 to 04:17. It uses a deadline under 300 seconds and a cursor to resume.
- It refreshes review stats, computes scores with set-based SQL per metric, raises abuse flags (reciprocal reviews, clusters of new accounts), writes summaries, and takes the monthly snapshot.

**Switches:** `seller_scores` controls whether scores are public; they are computed regardless, so admins can preview first. `seller_score_summaries` needs `classifieds_assistant` on.

**Screens:**
- **udozo.com:** the seller page's "Anjio's view" panel; `/account/ratings` (scores with numbers and tips, the interaction aggregate, reviews waiting for a reply); a help page "How Anjio rates sellers".
- **Admin:** the seller Ratings card (breakdown, Recompute, summary Hide, Unhide and Regenerate), Reports > Ratings (band distribution, moderation rates, summary cost against its share), and the new limits on the shop assistant form.

## Retention
These purges run in the daily `marketing` job:
- **Published reviews:** kept while both accounts exist.
- **Withdrawn reviews:** text purged after 30 days.
- **Removed reviews and posts:** kept hidden for 2 years, then deleted.
- **Reports:** 2 years.
- **Purchases with no review:** 13 months.
- **Sales that were not confirmed:** 12 months.
- **Interaction ratings:** 24 months.
- **Prompt records:** 90 days.
- **Score snapshots:** 24 months.

## Risks covered
- **Review stuffing:** verified purchases only (Safe pay, or buy orders the seller accepted before completing), caps on requests, `samePerson`, one voice per reviewer, holds on new accounts, and flags for reciprocal reviews and clusters.
- **Fake completed buy orders:** only accepted orders complete; the buyer can void within 7 days, and voids lower reliability and pause the seller after 3.
- **Retaliation:** sellers never rate buyers; the `review_pressure` report; pre-purchase raters stay anonymous behind a minimum of 5.
- **Extortion:** its own report goes straight to admins; negatives need a reason; 180-day blocks; the seller can reply publicly.
- **Defamation:** text cleaning, refused words, a held queue, takedown with reasons and an audit trail.
- **Unfair automated scores:** informational only, with published formulas, minimum samples, weak metrics kept private, and a person can be asked to review them.
- **AI cost:** daily cap, budget share, refreshed only on change.

## Verification
- **API tests** (PGlite and Docker):
  - `classifieds-reviews.test.mjs`: purchase rows and backfill, product keys, window, Neutral gate, negative rule, cleaning, thread rights for same and different products, caps, reports and audit, aggregation, reminders claimed once, switch off, no leaks in public responses.
  - `interaction-ratings.test.mjs`: each channel's eligibility, limits, flags, the aggregate hidden below 5.
  - `seller-scores.test.mjs`: each formula on fixtures, bands, low prices left out, cursor resume; summaries with the fake AI (an invented number rejected, caps, budget share, unchanged inputs skipped, hidden summaries not shown).
  - Updates to `vercel-crons`, `classifieds-sellers` and `classifieds-safe-pay`.
- **udozo.com:** `reviews.test.ts` (review card, buyer picker, threads, dialogs), plus updates to `seller-page`, `seller-seo` (a test pinning that there is no `aggregateRating` or `review` markup) and `mobile-width`.
- **Admin and shared types:** `reviews.test.tsx` and `seller-ratings.test.tsx` in the admin, and `reviews.test.ts` in `packages/api-client`.
- **Typecheck and lint:** across all four packages.
- **Live, per phase:** phase 0 first: on Nigeria, a buy order end to end (request, counter, accept, the listing reserved, mark sold, the buyer told, void within 7 days) and lapse and expiry by the cron. Then, with reviews on, the review prompt from a completed buy order, the review on the seller and listing pages, a same-model buyer joining the thread and a different-model buyer refused, and the seller replying. Phase 3: check the nightly job on the admin preview before `seller_scores` goes on; read a few summaries before `seller_score_summaries` goes on.

## Rollout
0. **Phase 0 (first):** buy orders. Switch `classifieds_buy_orders` on in Nigeria once the terms text is in.
1. **Phase 1:** reviews. Switch `classifieds_reviews` on in Nigeria after the legal text is approved, and watch the held and reported rates for 2 weeks.
2. **Phase 2:** pre-purchase ratings, then switch `classifieds_interaction_ratings` on.
3. **Phase 3:** scores previewed by admins for 2 weeks, then `seller_scores` on. Summaries come last, starting at 50 a day.
