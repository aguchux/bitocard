# Udozo: interest tracking and personalised discovery (plan)

Status: **plan, nothing built** (4 November 2026). Build in `apps/udozo-api` and `apps/udozo` only.

## Goal

Record what each person looks at, searches for and acts on, and use it so that what they see on Udozo (home rows,
search results, suggestions, the listing page's "more like this") puts the listings they are most likely to want first.
Measured by contacts, saves and Safe pay orders per visit, not by time spent.

## What exists today (the starting point)

| Signal | Where | Per person? |
|---|---|---|
| Listing views | `classified_listing_view_days` (counts per listing and day), `classified_listings.views` | No: deduped by an in-memory hash of address, browser and listing, then thrown away |
| Saves | `classified_favourites` | Yes (customer) |
| Chats, offers, leads, contact requests, call backs, calls | `classified_conversations`, `classified_offers`, `classified_leads`, `classified_contact_requests`, `classified_calls` | Yes (buyer) |
| Safe pay orders | `classified_orders` | Yes (buyer) |
| Searches | not recorded (only the assistant's `search_listings` tool calls, in `assistant_messages`) | No |
| Home area | `customers.area_id` (profile) | Yes, but search ignores it: the place comes only from the address |

Ranking today is the same for everyone: search orders by distance tier, then full-text rank (`ListingSearchService`);
home rows use trending (`leads*3 + saves*2 + views/10` over 14 days), deals, top selling and newest
(`HomeResolver`), cached 60 seconds per page. There is no "recently viewed", "for you" or "people also viewed".

## Ground rules (privacy and fairness first)

1. **No emotion recognition.** We do not try to read anyone's mood or feelings (from text, faces, voice or behaviour):
   it is unreliable, intrusive, and restricted or banned in places (the EU AI Act; the data protection laws of our
   markets treat inferred sensitive traits strictly). What the brief calls "emotion" we measure as **strength of
   interest**: how long someone stays on a listing, whether they open every photo, come back to it, save it, contact
   the seller or buy. These are actions, not feelings.
2. **Signed-in customers:** personalisation is on by default with a plain **Personalise what I see** switch and
   **Clear my history** on the profile (lawful basis: legitimate interest, with the right to object). Turning it off
   stops recording and deletes the profile.
3. **Signed-out visitors:** remembered only after **Accept all** on the cookie banner (`optionalAllowed`), with a random
   visitor ID in a new optional cookie `udz_vid` (12 months). With **Necessary only**, nothing is kept beyond the visit:
   no ID, no events. Signing in folds a visitor's recent history into the account.
4. **Never used for ranking:** date of birth, sex, anything from chats' or messages' text, phone numbers. Under-18s
   (from `birth_date`) get no profile.
5. **Never sold, never used for advertising, never shared with sellers.** Sellers keep seeing only counts.
6. **Paid placement stays separate.** Sponsored listings keep their label; personalisation never moves a listing up
   because anyone paid (terms section 2).
7. **Short memory.** Raw events kept 90 days; the interest profile decays (interest halves every 14 days) and is
   deleted after 180 days without a visit, or at once when the account is deleted or personalisation is turned off.
8. **Not a filter bubble.** Every personalised list keeps a share of fresh and popular listings outside the person's
   interests (exploration), and at most a few listings per seller.

## Part 1: recording (the data)

### Events

One table, `discovery_events` (append-only; indexed by subject and time, and by listing and time):

| Field | Meaning |
|---|---|
| `subject` | the customer's ID, or an HMAC of the visitor ID (`udz_vid`) |
| `session` | a random ID per visit (in memory on the page, never a cookie) |
| `kind` | `view`, `engaged` (dwell and depth), `search`, `filter`, `result_click`, `rail_click`, `save`, `unsave`, `share`, `contact`, `chat`, `offer`, `call`, `order`, `not_interested`, `impression` (sampled) |
| `listing_id`, `category_id`, `brand`, `model`, `area_id`, `price_minor`, `condition` | what it was about, copied at the time |
| `query`, `filters`, `results`, `sort` | for searches: the words (lower-cased, cut to 100 characters, phone numbers, emails and codes removed), the filters and how many results |
| `source`, `position` | where a click came from (`search`, `home:<row>`, `similar`, `for_you`, `recent`) and its place in the list |
| `seconds`, `photos`, `depth` | for `engaged`: time on the page while visible (capped at 10 minutes), photos opened, how far down they read |
| `country`, `at` | market and time |

**How they arrive:**

- **From the browser** (views, engagement, searches, filters, clicks, impressions): udozo.com batches them and sends
  them with `navigator.sendBeacon` to its own route, `/api/events` (same-origin only, as `/api/view` is), which adds
  the session or visitor ID and the signed shopper address and posts them to
  `POST /v1/classifieds/events` (public, `@SkipIdempotency`, rate limited per address, at most 50 events a call).
  Robots, empty browsers and a seller's own listings are dropped. Search results pages are cached by the CDN, so the
  search itself is logged by the page's beacon, never by `GET /v1/classifieds/listings`.
- **From the API itself** (saves, chats, offers, contact requests, calls, orders): written where those already happen,
  after they commit, never failing them.

`/api/view` and `ListingViewsService` stay as they are (public view counts); a `view` event is recorded beside them.

### Aggregates (built from the events)

- **`interest_profiles`** (one per subject and country, updated as events arrive): decayed scores per category, brand,
  model and area; the price band per category (from prices they engaged with); condition preference; the last 20
  searches; the last 200 listings seen (to skip or demote); listings marked not interested; `updated_at`.
  Event weights to start with (tuned in Part 4): view 1, engaged 2 to 4 (by time and photos), result or rail click 1,
  save 6, share 4, contact, chat, call or offer 10, order 15, unsave -3, not interested -20.
- **`search_query_days`** (per country, normalised query and day): searches, zero results, clicks, contacts. For
  popular searches, spelling and synonym fixes, and Reports.
- **`listing_neighbours`** (nightly): for each live listing, the 20 listings most often viewed or contacted in the same
  visits ("people who looked at this also looked at"), from the last 30 days.
- **`listing_signals`** (every 15 minutes, the `classifieds` job): per live listing, click-through from impressions,
  save and contact rates, freshness, photos, the seller's reply rate and standing, and price against comparable
  listings (as the assistant's `price_range`). The quality half of every score.

## Part 2: the algorithm (explainable first)

Every candidate listing gets

    score = quality × freshness × (1 + personal) × exploration

- **quality** (`listing_signals`): contact and save rates (smoothed so new listings are not punished), photos, seller
  reply rate and standing, a fair price.
- **freshness:** newer listings first, halving over about 14 days, renewed listings count as fresh again.
- **personal** (the profile): category, brand and model affinity; price fit (close to the band they engage with);
  nearness (their home area, then the area they browse); condition. Zero when there is no profile, so the list falls
  back to today's popular order.
- **demotions:** already contacted, bought or marked not interested (removed); seen several times without a click
  (pushed down).
- **mixing:** at most 2 listings per seller in a row of 12; categories interleaved; 15% of places kept for fresh and
  popular listings outside the person's interests.

Search keeps its rules: the distance tiers come first, and with words typed, relevance leads; personal interest only
breaks ties within a tier. Browsing without words (a category or place page sorted by Best match) is ordered by the
score within each tier. Sorting by newest or price is never personalised.

## Part 3: what people see

| Where | What |
|---|---|
| Home (each market) | **For you** (a new row type `for_you`, placed by admins in the layout editor, filled per person; popular for people without a profile), **Recently viewed**, **Because you searched "…"**, **Price dropped** on listings they viewed or saved |
| Listing page | **People also viewed** (`listing_neighbours`, then the current "More … in …") |
| Search box | their recent searches (with remove), then popular searches in the market, as suggestions start |
| Results pages | Best match ordered as in Part 2; "Not interested" on each card (a menu) |
| Account > Profile > Privacy | Personalise what I see (on or off), Recently viewed (remove one or all), Clear my history |

**Speed and search engines:** the shared home page stays cached as today and is what robots see; the personal rows are
fetched for the person (`GET /v1/classifieds/for-you?country=&rows=` with their session or visitor ID, never cached
by the CDN, under 150 ms from `interest_profiles` and a candidate pool of live listings kept for a minute per market)
and drawn in place of their placeholders after the page loads.

## Part 4: measuring and learning

- **Holdout:** 10% of people (by subject) keep today's order, so every change is measured: contacts per visit, saves
  per visit, Safe pay orders, searches ending in a click, zero-result searches, time to first contact.
- **Reports > Discovery** (Udozo's admin): top searches and zero-result searches per market, clicks and contacts per
  home row, personalised against holdout, and the switches below.
- **Switches:** `personalisation` (Udozo's, global or market, off by default) and `personalisation_search` (search
  re-ranking, off by default), so each market is turned on when ready.
- **Later (phase 3):** tune the weights from what was clicked and contacted (offline, then by holdout); add listing
  embeddings (pgvector on Neon, an embedding of each listing's title, category and features: no personal data) for
  "search by meaning" and better "people also viewed"; then a learned ranking model if the data supports it.

## Legal changes before switching it on

- **Privacy notice:** what is recorded (Part 1), why (personalising what they see, improving search), the lawful basis,
  the 90 and 180 day retention, the on and off switch and Clear my history, no use for advertising, visitors only with
  Accept all, under-18s excluded; personalisation in the automated decisions section.
- **Cookie notice:** `udz_vid` (optional, 12 months, only after Accept all); bump `consentVersion` so everyone is
  asked again.
- **Terms section 2 (how listings are shown):** Best match and the For you rows consider the person's own activity;
  sponsored stays labelled and nothing moves up for payment.
- The legal documents were finalised on 4 November 2026; these changes need the same review before the switch goes on.

## Phases

| Phase | What | Size |
|---|---|---|
| 1 | Recording: events table, `/api/events` and the API route, server-side events, consent and `udz_vid`, the profile's Privacy screen, retention jobs, legal text | about 1 week |
| 2 | Profiles and surfaces: `interest_profiles`, `listing_signals`, `listing_neighbours`; For you, Recently viewed, Because you searched, Price dropped, People also viewed, recent and popular searches; holdout and Reports > Discovery | about 1.5 weeks |
| 3 | Search re-ranking (browse first, then ties with words), weight tuning from the holdout, then embeddings | after 2 to 4 weeks of data |

## Decisions for the owner

1. **Visitors:** remember signed-out visitors only after Accept all (recommended), or not at all?
2. **Age and sex:** never used for ranking (recommended), as above?
3. **Search with words typed:** interest only breaks ties (recommended), or a stronger personal boost?
4. **Retention:** 90 days of events and 180 days for an idle profile, as proposed?
5. **Start market:** one market first (Nigeria), with the 10% holdout, then the others?
