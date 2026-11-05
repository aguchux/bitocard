# Udozo: usernames (plan and contract)

Status: **requested by the owner on 5 November 2026, being built.** Udozo only: `apps/udozo-api`, `apps/udozo`,
`apps/udozo-admin`, `packages/api-client`. Not Seller HQ stores.

## What and why

Seller pages are `udozo.com/<cc>/seller/<handle>`, a random 10-character handle. A customer (seller or buyer) who has
**posted at least the market's minimum of ads** (admins set it, default 5) may choose a **username**, and their page
becomes `udozo.com/<cc>/seller/<username>`: easier to share and remember, better for search.

## Rules

- **Form** (`usernamePattern` in `@bitocard/api-client/classifieds`): 3 to 24 characters, lower-case letters, digits
  and underscores, starting with a letter; typed in any case and stored lower-case. Unique across every Udozo account
  (a unique index), never equal to anyone's handle, and never a reserved word (`udozo`, `admin`, `support`, `help`,
  `safepay`, `safe_pay`, `seller`, `sellers`, `official`, `staff`, `moderator`, `account`, `settings`, `api`, `www`,
  `shop`, `store`, `search`, `market`, `null`, `undefined`, and names of Udozo's own pages) or containing one of the
  refused words, a phone number (7 or more digits in a row), or `udozo` anywhere.
- **Who** (`eligible`): an active account whose **posted ads** (listings published at least once, any status but removed
  by moderation or deleted) reach the market's `username_min_listings`. Keeping it does not depend on staying above it.
- **Changing**: at most once every 30 days (`change_after`). The old username **redirects to the new one for 90 days**
  and nobody else can take it then (`customer_username_history`).
- **Admins** can take a username away (abuse, impersonation; a reason, audited `classifieds.seller_username_removed`,
  the customer told by an inbox notice); the page goes back to the handle and the old username is held for 90 days.

## API contract (`apps/udozo-api`)

**Data** (one migration): `customers.username` (citext-like: stored lower-case, unique where not null),
`customers.username_set_at`, `customers.username_prompt_dismissals` (int, default 0),
`customer_username_history` (username unique, customer_id, released_at, hold_until), and
`classified_market_settings.username_min_listings` (int, default 5, 0 to 100).

**Customer routes** (`/v1/store/account/username`, customer session; Udozo's only):
- `GET` → `UsernameStatus` (in `@bitocard/api-client/classifieds`).
- `GET …/availability?username=` → `UsernameAvailability`: `available`, else `reason` (`invalid`, `reserved`,
  `refused`, `taken`, or `own` for their current one) and up to 3 `suggestions` (free variants of their name or what
  they typed). 30 a minute per customer (`username_check_limit`, 429).
- `PUT { username }` → `UsernameStatus`. Refusals: `username_not_eligible` (403, with posted and required in the
  message), `username_invalid`, `username_reserved`, `username_refused`, `username_taken` (409),
  `username_change_too_soon` (409, with the date). Checks availability again inside the transaction (the unique index
  decides a race). Audited `customer.username_set`.
- `POST …/prompt/dismiss` → `UsernameStatus` (adds 1 to `dismissals`; after 3, `prompt` stays false).
- `GET /v1/store/account` adds `username`.

**Seller pages and cards**: `GET /v1/classifieds/sellers/:key` takes a username or a handle (username first; an old
username in its 90 days answers the profile with `redirect: "<current username or handle>"`, or 404 after). The profile,
listing pages' `seller` and cards' `seller` carry `username` beside `handle`. The search's `seller=` takes either.
The sitemap's `sellers` carry `username`.

**Admin**: the market settings route that edits `classified_market_settings` takes `username_min_listings` (operations,
audited); the admin seller view carries `username`; `POST /v1/admin/classifieds/sellers/:customer/username/remove
{ reason }` (operations).

## udozo.com

- **Addresses**: every link to a seller page uses `sellerPath(cc, sellerSlug(seller))`. `/<cc>/seller/<handle>` of a
  seller with a username, and an old username in its 90 days, **redirect permanently** to the username's address; the
  canonical, Open Graph, JSON-LD, sitemap and share cards (`/seller-card/<username>.gif|.jpg`) use the username.
- **Profile > Username** (an account screen): the current username and their page's address with Copy; when eligible,
  the field with live availability (as they type, debounced, through a same-origin route or server action), the
  suggestions, and Save; when not, "Post N more ads to choose a username" with Post an ad; after setting, when they can
  change it next.
- **The banner** (beside the mobile reminder on the account pages, same look): "Choose your username: your page becomes
  udozo.com/ng/seller/yourname" with Choose and Not now; shown while `prompt` is true; Not now calls dismiss (after 3 it
  never shows again; the profile still offers it).
- **Their own seller page**: when the viewer is the seller and has no username, a card above their listings: choose a
  username for a better address (or post N more ads first).
- **Legal**: the privacy notice (a username is public, on their page and listings) and the terms (usernames may not
  impersonate, mislead, carry contact details or refused words; Udozo may remove one).

## Admin (`apps/udozo-admin`)

The market's Marketplace settings: "Ads before choosing a username" (0 to 100). The seller's page: their username with
Remove username (a reason).
