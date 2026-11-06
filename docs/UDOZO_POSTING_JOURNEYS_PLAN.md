# Udozo posting journeys (sellers' journey from Sell to first results)

**Status (6 November 2026): built.** The plan as approved, with what changed while building noted under *As built* below.

## Context
Admins can see where people get stuck signing up (Reports > Sign-up journeys) but not where sellers get stuck posting ads. The owner wants each ad's journey tracked from pressing **Sell** until the ad is live and showing its first results, in a report shaped like Sign-up journeys, so admins can see:
- where sellers drop off,
- why their ads are refused or sent back,
- how long review takes,
- what happens after an ad goes live.

**Owner's decisions (6 November 2026):**
- **The journey runs through first results:** Sell → draft → each wizard step → submitted → in review → live (or sent back) → first view, first chat or call, first lead, sold.
- **Wizard steps are recorded too.** udozo.com reports each step reached and each Next it refused (the step and the missing field only, never what was typed). This applies to signed-in sellers only, and the privacy notice gets a line about it.
- **Moderators' rejections get a reason code** (photos, wrong category, prohibited item, misleading, contact details, duplicate, other) plus a note, and the review time is recorded.

Build only in `apps/udozo-api`, `apps/udozo`, `apps/udozo-admin` and `packages/api-client`. The contract is copied to `docs/UDOZO_POSTING_JOURNEYS_PLAN.md`, and AGENTS.md gets an entry after Sign-up journeys.

## Pattern reused
Copy the structure of `apps/udozo-api/src/signups/`:
- the decorator and global interceptor (`SignupJourneyInterceptor`, the `@Global` `SignupsModule` with `APP_INTERCEPTOR`);
- recording that never fails a step (try/catch, warn, Udozo only);
- `errorParts`, `deviceOf` and `utcDay` (imported from `signups/journeys.service.ts`, not copied);
- partial unique index plus P2002 re-read, and milestones as nullable `*At` columns set once;
- the rollup purge in the daily `marketing` cron (`cron.controller.ts:200`);
- `SignupInsightsService` summary, list and audited get.

The admin page copies `app/(console)/reports/signups/page.tsx` and `[id]/page.tsx`, and the hooks copy `packages/api-client/src/admin/signup-journeys.ts`.

## Data model
One additive migration, `20270220000000_posting_journeys`. Schema edits are made by script (never `prisma format`), and the SQL comes from `prisma migrate diff`.

- **`posting_journeys`**:
  - Who and what: `customer_id` (FK, cascade on delete), `listing_id` (unique, nullable, **no FK**: drafts are hard-deleted, so the journey outlives them), `listing_ref` and `sku` (copied when the journey binds to its listing).
  - Context: `source`, `country`, `category_id`, `top_category_id`, `device`.
  - Where it stands: `stage` (composing, in_review, sent_back, live, abandoned or removed) and `furthest_step` (0 basics to 5 post).
  - Milestones (nullable, each set once): `opened_at`, `draft_at`, `first_photo_at`, `submitted_at`, `review_queued_at`, `reviewed_at`, `sent_back_at`, `resubmitted_at`, `live_at`, `first_view_at`, `first_chat_at`, `first_call_at`, `first_lead_at`, `sold_at`, `ended_at`.
  - Outcome details: `live_via` (direct or review), `ended_reason`, and `review_flags` (a copy taken when queued, because approving clears the listing's flags).
  - Counters: reviews, sent back, submit attempts, refusals and events.
  - Last problem: the last error's step and code, and the last reject code.
  - Indexes: a partial unique index on `(customer_id) WHERE listing_id IS NULL AND stage='composing'`, so each seller has one open journey not yet tied to a listing. Plus indexes on started_at, last_event_at, (stage, last_event_at) and (country, started_at).
- **`posting_journey_events`**: `origin` (api, client or system), step, outcome, code, param, listing_id, device and time. At most 200 per journey, deleted with the journey.
- **Rollups:**
  - Tables: `posting_visit_days` (day, source, signed_in), `posting_funnel_days` (day × country × source × top category, with milestone counts and sums of minutes to submit, to go live, to review and to first contact), `posting_blocker_days` (day × origin × step × code × param × country) and `posting_review_days` (day × country × kind (flag, reason or outcome) × value).
  - None of them holds anything about a person.
  - They are kept for 400 days.
- **`classified_listings`**: adds `review_reason_code` (checked against the list), `reviewed_at`, `reviewed_by_id` (SetNull) and an index on (status, reviewed_at).

## Recording (new `apps/udozo-api/src/postings/`)
**`PostingJourneysService`** is never awaited on a request path:
- Everything runs fire-and-forget, after the commit, in try/catch.
- Pending work is tracked, and `idle()` lets tests wait for it.

**Which journey a step belongs to:**
1. **`sell_opened`:** reuse the seller's open journey not yet tied to a listing if it was touched within the last 24 hours. Otherwise close the stale one (abandoned, `never_drafted`) and open a new one with its `source`.
2. **The draft is created:** tie the open journey to the new listing. With no open journey (a draft made from photos, the API or another tab), start one at draft with source `api` or `unknown`.
3. **Steps naming a listing** go to that listing's journey. A draft or rejected listing reopened on the edit page with no journey starts one (source `resumed`). Edits to live ads with no journey are ignored.
4. **Wizard events that arrive before the draft is tied** go to the open journey, else the latest composing one from the last hour, else they are dropped.

**Status and stuck:** status is worked out as in_progress, stuck, in_review, sent_back, live, sold, abandoned or removed.
- **Stuck** means still composing and quiet for 24 hours (sellers leave drafts while they take photos, so 1 hour is too short).
- **`stuck_at`** is the first missing milestone in this order: opened, draft, each wizard step, submitted. For sent-back ads it is resubmitted.

**(a) API interceptor:** `@TrackPosting(step)` with a global `PostingJourneyInterceptor`. It uses `tap` and adds no latency or change to the answers. It is on these routes in `classified/classifieds.controller.ts` (lines 472–539):

| Route | Step | What is recorded |
|---|---|---|
| create | `create` | ties the journey to the draft |
| PATCH save | `save` | successes write no event row (autosave is hot), only `last_event_at` and category, at most once a minute via a conditional update; refusals are recorded |
| photos | `photo` | the first photo |
| video, video-upload | `video` | the step |
| submit | `submit` | below |

- **A submit that succeeds:**
  - active: live, `live_via` direct;
  - pending_review: in review, with the flags copied;
  - a rejected listing submitted again: `resubmitted_at` is set.
- **Refused steps** are recorded with their code and `param`.
- The token video upload (`video-uploads/:token`) is recorded inside `addVideoWithToken`.

**(b) Wizard events:** `POST /v1/classifieds/posting-journeys/events` (customer session, `@SkipIdempotency`, about 60 a minute per customer).
- The DTO allows only closed types: `sell_opened{source}`, `form_resumed{listing_id}`, `step_reached{step}`, `step_refused{step,param}`, `terms_ticked` and `post_pressed`.
- `step`, `param` and `source` must come from fixed lists, and any other key is refused, so typed text can never arrive.
- `step_reached` only records a new furthest step.

**(c) Service hooks** (void, after the commit):

| Where | What is recorded |
|---|---|
| `listings.service.ts` `recheck` (a live ad sent back to review) | requeued |
| `listings.service.ts` draft deleted | abandoned (`draft_deleted`) |
| `listings.service.ts` other deletions | ended (`deleted`), or a closed event if the ad was live |
| `listings.service.ts` `markSold` | sold |
| `moderation.service.ts` reported | reported |
| `moderation.service.ts` approve | reviewed and live (`review`) |
| `moderation.service.ts` reject | sent back, with its code |
| `moderation.service.ts` remove | removed, with its code |
| `home/views.service.ts` | the first view, only when the listing's `views` was 0 (add `views` to its select); no extra query after that |
| `conversations.service.ts:216` | first chat and first lead |
| `CallsService` (the seller called) | first call |
| contact requests, callbacks, buy order requests | first lead (a no-op once set) |
| buy order `complete`, Safe pay `settle` | sold, via one `syncSold` UPDATE … FROM classified_listings |

**Safety net:** `reconcile()` runs in the daily job. One set-based UPDATE copies `published_at`, `sold_at` and removed or deleted states from the listings, and abandons journeys whose draft is gone.

**(d) Visits:** `POST /v1/posting-journeys/visits {source, signed_in}` is public and only increments a daily count.

## API
- **Module:** `postings.module.ts` (`@Global`, imported beside `SignupsModule`), plus `journeys.service.ts`, `insights.service.ts` and `track.ts`.
- **Admin routes:** `/v1/admin/posting-journeys` with `@RealmOnly('admin') @AdminRoles('operations','support') @ProductOnly('udozo')`.
  - `GET summary?days=7|30|90|365&country&source&category`
  - `GET ?status&stuck_at&code&source&category&country&q&limit&offset` (q matches a number as the listing ref, an SKU, or the seller's email or name)
  - `GET :id`, audited as `posting_journey.viewed`
- **Daily job:** the `marketing` cron adds `posting_journeys: { reconcile, purge }`.

## Report
**Summary.** Live journeys and rollups are merged, as for sign-ups.
- **Visits:** signed in and signed out.
- **Totals:** started, submitted, live, sold, abandoned, in progress, stuck, in review now, sent back now, and the post rate.
- **Times:** medians to submit, to go live and to first contact from journeys still kept, and averages including rollups, labelled as such.
- **Funnel:** opened → draft → media → details → where → place → post → submitted → live (split direct and after review) → first view → first contact → first lead → sold.
- **Stuck at:** counts by milestone.
- **Review:** queued, approved, sent back, removed, approval rate, median time to review, reasons and flags.
- **Blockers:** the top 30 (origin Form or Posting, step, code, param, refusals, journeys).
- **Daily:** visits, started, submitted and live.
- **Breakdowns:** sources, top categories, devices and countries.

**List and detail:**
- Each row: status, `stuck_at`, source, the seller (name and email), the listing (ref, SKU, current title or "deleted"), category, milestones, furthest step, flags, last reject code, last error, counters and `deletes_at`.
- The detail adds the event timeline and links to the listing and the seller.

## udozo.com
- **Sources on Sell links.** `lib/sell-sources.ts` holds `sellSources` and `sellHref(source)`, which gives `/sell?from=<source>`. They are used on:
  - the header (`header`) and the phones' Sell button (`header_phone`);
  - My listings' "Post an ad" (`my_listings`) and its empty state (`empty_state`);
  - Start here (`start_here`) and invite links (`invite`);
  - the manifest shortcut (`pwa`), and the reseller and username pages.
- **Signed-out Sell now leads back to Sell:** `SignInHere` gets an optional `next`, so after signing in the seller lands on `/sell?from=…` instead of the page they started on. This closes a leak in the funnel.
- **`/sell`:**
  - reads the `from` source, cleaned against `sellSources`;
  - calls `requireSeller('/sell?from=…')`, so the source survives sign-in and verify;
  - renders `SellVisit` (a copy of `signup-visit.tsx`) and passes the source to `ListingForm`.
  - `/signin?for=sell` also renders `SellVisit signedIn={false}`.
- **`lib/posting-actions.ts`** (server actions): `countSellVisit` and `recordPostingStep`, through `customerApi`, which already forwards the device. Errors are swallowed and the event type is closed.
- **`components/account/listing-form.tsx`** gets a `track()` helper:
  - on opening: `sell_opened`, or `form_resumed` for a draft or rejected listing;
  - in `goTo`: `step_reached` at a new furthest step;
  - in `next()`, on a refusal: `step_refused{step,param}`;
  - in `post()`: `post_pressed`, local refusals (including `terms_box`) and `terms_ticked`.
  - API refusals are not sent again: the interceptor already records them.
- **`lib/legal.ts` privacy notice:**
  - **What:** each posting step (the step reached, what a step still needed, whether posting went through or why not), how a review ended and why, and when the ad first got a view, a chat, a call or a contact, with the device and browser kind. Never anything typed or uploaded. Sell openings are counted per day with nothing about who opened it.
  - **Purpose:** seeing where sellers get stuck and helping them (legitimate interest).
  - **Retention:** as below.

## Rejection reasons
- **Codes:** `listingReviewCodes` = photos, wrong_category, prohibited_item, misleading, contact_details, duplicate, other. They live in `moderation.service.ts` and are mirrored in the api-client.
- **Admin DTO** for reject (sent back) and remove (`admin.controller.ts`): `{reason_code, note?}`.
  - The old `{reason}` still works, read as `other` plus its note.
  - `other` needs a note.
- **`moderation.reject` and `remove`** set `review_reason_code`, `reviewed_at` and `reviewed_by_id`.
  - The seller reads the note, or the code's default sentence (e.g. "The photos need to show the item clearly."). The notice wording is otherwise unchanged.
  - `approve` sets `reviewed_at` and `reviewed_by_id`.
  - Audits carry the code.
- **Presented:** `review_reason_code` on listings, and `reviewed_at` and `reviewed_by` in the admin.
- **Admin queue** (`app/(console)/classifieds/page.tsx`): the Ask for changes and Reject dialogs get a required reason select and a note, required for Other, with a preview of what the seller will read. Today's labels map Reject to `remove` and Ask for changes to `reject`; codes apply to both.
- **Client:** `moderateClassifiedListing` (in `packages/api-client/src/admin/classifieds.ts`) sends `{reason_code, note}`.

## Retention
`purge` runs in the daily `marketing` job:
- **Not live:** deleted 30 days after the last step, though not while still in review.
- **Live:** deleted at the earlier of 30 days after it sold and 90 days after it went live.
- **How:** each batch of 250 is rolled into the daily counts and deleted in one transaction (at most 40 batches a run). Daily rows are deleted after 400 days, and deleting an account deletes its journeys.

## Admin
- **Hooks:** `packages/api-client/src/admin/posting-journeys.ts` (types, `usePostingSummaryQuery`, `usePostingJourneysQuery`, `usePostingJourneyQuery`), exported from `admin/index.ts`.
- **Labels:** `apps/udozo-admin/components/postings.ts` for steps, codes, params, sources, statuses, milestones and reject codes.
- **`app/(console)/reports/postings/page.tsx`**:
  - filters for days, country, source and category;
  - StatCards: started, live, post rate, stuck, in review now, median time to live;
  - the funnel with drops and the live split;
  - `stuck_at` buttons that filter the list;
  - a LineChart of the daily figures;
  - a review card (reasons, flags, time to review);
  - the blockers table;
  - split cards for sources, categories, devices and countries;
  - the journeys list, paged.
- **`[id]/page.tsx`:** a milestone strip and the timeline.
- **Menu:** `components/shell.tsx` Reports gets **Posting journeys** after Sign-up journeys.

## Verification
- **API, `apps/udozo-api/test/posting-journeys.test.mjs`** (PGlite, then Docker). It covers:
  - matching steps to journeys: reuse within 24 hours, then a new journey; tying to the draft; a draft made without Sell; resuming on the edit page; live edits ignored;
  - the DTO refusing unknown keys or values;
  - interceptor refusals recorded with code and param; save successes throttled with no event row; submit live or in review with flags;
  - approve, reject with a code and with the old `{reason}`, remove, then resubmit to live; `reviewed_at` set; the seller's text;
  - the first view only at 0 views; first chat, call and lead; sold via `markSold`, a buy order and Safe pay;
  - a deleted draft abandoned;
  - a recording failure still answering the route, and other products recording nothing;
  - reconcile and purge (idempotent, rollups correct);
  - the admin summary merging live and rolled-up rows, list filters and `q`, an audited get, and account deletion cascading.
- **Moderation tests:** update the moderation and classifieds tests for the new reject body.
- **Admin, `apps/udozo-admin/test/posting-journeys.test.tsx`:** funnel and drops, the `stuck_at` filter, blocker labels, the detail timeline, the reject dialog sending `reason_code`, and only `/v1/admin/` routes called.
- **udozo.com, `apps/udozo/test/posting-journeys.test.ts`:** `sellHref` and source cleaning; `requireSeller` keeping `from`; `SellVisit` counting once; actions swallowing errors; the wizard sending `step_reached`, `step_refused` and `sell_opened` with whitelisted keys only (no title or price). `post-wizard.test.ts` must still pass.
- **Static checks:** `tsc` and `eslint` on the four packages, `test/vercel-crons.test.mjs` unchanged (no new cron), and the report and dialogs checked at 320, 360 and 390 px with no sideways scroll.
- **Manual check, on a running dev stack:**
  1. Sign out, press Sell, sign in, and confirm you land on `/sell?from=header`.
  2. Go through the wizard, refuse a step, submit, and approve in the admin.
  3. View the ad from another account and chat.
  4. Check the journey's timeline in Reports > Posting journeys.

## Rollout
1. Ship the migration and API; reject still accepts the old body.
2. Ship the admin report, menu and reason select.
3. Ship the udozo.com sources, `SellVisit`, wizard events and privacy notice together.

Journeys start from the deploy date, with no backfill. Watch the logs for "Could not record a posting step".

## As built
- **First chat, call, lead and sold are read, not hooked.** `PostingJourneysService.syncResults` (the 15-minute `classifieds` job, and the daily `reconcile`) copies them from the listings' own records (`classified_conversations`, `classified_calls`, `classified_leads.first_at`, `classified_listings.sold_at`) in one statement touching only journeys it changes, so the chat, call, contact, buy-order and Safe pay services gain no work and every way an ad sells is covered. Only the first view is told as it happens (`ListingViewsService`, when the count was 0).
- **The wizard's events controller** (`src/postings/events.controller.ts`) is registered in the classifieds module, beside its customer guard; the visits and admin controllers are in the global `PostingsModule`.
- **A live ad sent back to review** by an edit or a photo is told by `ListingsService.recheck`, and by reports from `ModerationService.report`.
- **`reviewed_by_id`** keeps the admin's id without a foreign key (admins are never deleted).
- **The token video upload** (`video-uploads/:token`) is not followed: asking for its link is the `video` step.
- **Signed-out Sell** now signs in and goes on to `/sell?from=<source>` (`SignInHere`'s `next`).
