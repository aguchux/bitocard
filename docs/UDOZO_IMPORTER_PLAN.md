# Udozo ads importer: link your Jiji store, Konga store, Facebook Marketplace and more, then bring your ads

**Status:** planned on 8 November 2026 at the owner's request. Nothing is built yet. Build it phase by phase only once the owner says so, and settle the legal point in Context before phase 1 goes live.

## Context

The owner wants sellers to bring the ads they already have on Jiji, Konga and Facebook onto Udozo without typing them again.

None of the three offers an official way in:
- **Jiji:** no seller API and no export. The only tools around are third-party scrapers.
- **Konga:** no public seller API. Its sellers work with spreadsheet uploads in Seller HQ.
- **Facebook:** Marketplace listings posted by individuals cannot be read through any API. Meta's Graph API reaches only business catalogues (Commerce Manager), and only for an app whose permissions Meta has approved.

So the importer works from **what the seller gives it**. That is their own store on Jiji or Konga, which they first prove is theirs, a spreadsheet, or later their Facebook business catalogue. It is never a crawl of another site.

**Owner's rule, 8 November 2026: only a store's owner can import its ads.** Before importing anything, a seller links their store on Jiji, Konga or Facebook to their Udozo account and proves it is theirs (see Linked stores below). Udozo keeps the store's name, address and the platform's own id for it. Every ad imported afterwards must name that same store on its own page, or it is refused. This is the main protection against the legal risk.

**Owner's rule, 8 November 2026: importers never import images, only the product's details.** That means its title, price, condition, category, place, description, brand, model and how many are in stock. The seller adds their own photos before posting.

That rule also keeps out of Udozo the other sites' watermarks, photos the seller may not own the rights to, and the cost of fetching them.

**Legal point to settle first:** Jiji's and Konga's terms very likely forbid automated copying of their pages. With this design, Udozo only ever reads pages of a store whose owner proved it is theirs and asked for the import. That is a much smaller step than scraping. Even so, lawyers should confirm it per market before link import is switched on. The spreadsheet and the Facebook catalogue need no such check.

## Rules the design follows

- **No images, ever.**
  - Extractors drop every image field: JSON-LD `image`, `og:image`, `<img>`, and a spreadsheet's photo columns.
  - Nothing downloads, stores, shows or links an image address from another site.
  - Tests pin this down: no image field in what is stored, and no request beyond the one page.
- **An import makes a draft, never a live ad.** It becomes an ordinary draft through `ListingsService.create` and `update` (`apps/udozo-api/src/classifieds/listings.service.ts`).
  - The seller opens it in Post an ad (`ListingForm`). It opens at its first unfinished step, which is always Photos at least, since the market's minimum (`minPhotos`, 4) is never met by an import.
  - The seller then posts it as any other ad: the terms, `requireComplete`, the photo minimum, moderation, the monthly limits, and `submit`.
- **Only the store's owner imports its ads.**
  - A seller must link and prove their store first (Linked stores, below).
  - Each ad's own page must name that linked store (its id or address, as the platform shows the seller on the ad). Otherwise it is refused with `import_not_your_ad`, and nothing is kept but the refusal.
  - A store is linked to one Udozo account at a time. Another account trying to link it is refused with `store_linked_elsewhere`; operations can release a store from the admin, with a reason, audited.
  - Each ad is imported once.
  - Imports are limited per seller per day (`import_per_day`, 20).
  - An imported ad's first posting still goes to review. Moderators see the store it came from (`imported_from` on the admin's listing view).
- **Udozo's words win.** Imported text goes through the listing's own checks (`checkTitle`, `checkDescription`, refused words). Phone numbers, links and emails are cleaned out (`cleanNote`'s rules), so an ad cannot carry the other site's contact details.
- **The switches:** `classifieds_import`, Udozo's only, global or country, **off by default**. Each platform has its own switch too, `classifieds_import_<platform>` (`classifieds_import_jiji`, `classifieds_import_konga`, `classifieds_import_facebook_marketplace`, `classifieds_import_facebook_page`), so a platform can stay off until its legal check is done while spreadsheets go ahead.

## Linked stores: proving a store is the seller's

A seller links a store once per platform, from Profile > **Linked stores** on udozo.com: **Link your Jiji store**, **Link your Konga store**, **Link your Facebook Marketplace**, and more as platforms are added.

- **Platforms are a registry** (`platforms.ts`). Each entry gives:
  - its key and name, and the markets it serves;
  - its hosts, and what its store and ad addresses look like;
  - how a store is proved (`code` or `facebook_login`);
  - its extractors for a store page and an ad page.

  Adding a platform (Jumia vendors, an Instagram shop, a local classifieds site) is one entry, its extractors and their tests, behind its own switch. Nothing else changes.
- **First platforms:**
  - **Jiji:** its seller or shop page, in every Jiji market Udozo serves;
  - **Konga:** its merchant store page;
  - **Facebook Marketplace:** the seller's Marketplace profile;
  - **Facebook Page shops:** a Page's catalogue in Commerce Manager.

- **Jiji and Konga, by a code on the store:**
  1. The seller pastes their store's address (a Jiji seller or shop page; a Konga merchant store page).
  2. Udozo reads that one page and keeps the store's name, address and the platform's own id for it.
  3. Udozo gives the seller a one-time code, such as `UDOZO-7KQ4M2`, valid for 48 hours. The seller puts it in their store's public description, or in the description of one of the store's live ads, wherever that platform lets a seller write.
  4. The seller presses **Check now**. Udozo reads the page again, and the code there proves the store is theirs. Only someone who can edit that store can put the code there.
  5. Afterwards the seller may remove the code. A link is checked again only when it is renewed, which happens once a year.
- **Facebook, by signing in:** Facebook Login proves it. It gives Udozo the person's Facebook id (their Marketplace profile) and, with Facebook Login for Business, the Pages and catalogues they manage, since Meta lists only those. No code is needed (phase 4).
- **Facebook Marketplace, what can and cannot be read:** Meta offers no API for Marketplace listings, and its pages mostly need a sign-in. So Udozo links the seller's Marketplace profile by Facebook Login, and imports a Marketplace ad only by its link, only where its public page can be read and names that same profile. Whether it does must be confirmed on real pages before building. Where it cannot be read, Udozo says so and offers the spreadsheet instead. A Page's catalogue is read through the Graph API as below.
- **What is kept per linked store:**
  - the platform;
  - the store's name and address;
  - the platform's id for it (the identity ads are checked against);
  - how and when it was proved, and when it is next due.
- **Where the code and identity are read:** where on a Jiji or Konga page the store's id sits, and which descriptions a seller can edit, must be confirmed on real pages before building. The extractors are pure functions, tested on saved copies, so this stays a contained piece of work.
- **The seller's own list:** once a store is linked, **Choose ads to import** reads the store's public page (and its next pages, five at most) to list its ads. Each ad shows its title, price and address, never a picture. The seller ticks the ads they want, and each is imported as below. A pasted ad address works too, checked the same way.
- **Unlinking:** the seller can unlink a store at any time. Drafts already made stay theirs.
- **When the store's owner changes:** if a later import's ad no longer names the store, it is refused, and the seller is told to check the link.

## Data (one migration in `apps/udozo-api/prisma/migrations/`)

- **`classified_import_stores`**, one row per linked store:
  - who: the customer;
  - the store: `platform` (a key in the registry: `jiji`, `konga`, `facebook_marketplace`, `facebook_page`, and later others), `store_key` (the platform's id for the store, normalised), `name` and `url`;
  - proof: `code_hash`, `code_expires_at`, `method` (`code` or `facebook_login`), `verified_at`, `renew_at`, and `released_at` with `released_by` and a reason for operations' releases;
  - uniqueness: an open link (not released or unlinked) is unique per `platform` and `store_key`, enforced by a partial unique index. One store, one Udozo account.

- **`classified_imports`**, one row per thing imported:
  - who: the customer and country;
  - where it came from: `platform` (as above, or `sheet`), `store_id` (the linked store; null for a spreadsheet row), `source_url` and `source_key` (the platform's id for the ad, unique per linked store, so each ad is imported once);
  - what happened: `status` (`drafted` or `failed`, with `error`), and `listing_id`, with no foreign key, so a deleted draft keeps its record until retention removes it;
  - what was read: `fields` jsonb, the details exactly as read (text only), for moderators and for "what we could not use";
  - `created_at`.
- **Market settings** (`classified_market_settings`): `import_per_day` (20) and `import_sheet_rows` (100).
- **Retention:** rows are deleted 90 days after the draft is posted or deleted, by the `marketing` job.

## API (`apps/udozo-api/src/classifieds/imports/`, `@ProductOnly('udozo')`, customer sessions)

1. **Linked stores** (`stores.service.ts`):
   - `GET /v1/store/account/import-stores` lists the seller's links.
   - `POST /v1/store/account/import-stores { url }` reads the store page, keeps its name, address and id, and returns the code. A store already linked to someone else is refused with `store_linked_elsewhere`.
   - `POST …/import-stores/:id/check` reads the page again for the code. Found, the link is proved; not found, it answers `store_code_not_found` and says where to put the code. At most 10 checks an hour.
   - `GET …/import-stores/:id/ads?page=` returns the store's ads to choose from: titles, prices and addresses, never images.
   - `DELETE …/import-stores/:id` unlinks it.
   - Admins: the linked stores on the seller's page, and `POST /v1/admin/classifieds/import-stores/:id/release { reason }` (operations, audited `classifieds.import_store_released`).
2. **Import an ad: `POST /v1/classifieds/imports { store_id, url }`.**
   - Only the hosts of the platforms in the registry, for the linked store's platform: for example Jiji's (`jiji.ng`, `jiji.com.gh`, `jiji.co.ke` and the others) and Konga's (`konga.com`).
     - Any other address is refused with `import_source_unsupported`.
   - **Owner check:** the ad's page must name the linked store, which must be proved and belong to the seller. Otherwise `import_not_your_ad` (or `store_not_verified`).
   - **Fetching** (`fetch.ts`):
     - one GET, https only, through `safeLookup` and `checkDestination` (`apps/udozo-api/src/webhooks/destinations.ts`);
     - redirects followed only on the same site, three at most;
     - the page only, never its images or scripts, capped at 1 MB with a 10-second timeout;
     - an honest user agent: `UdozoImporter (+https://udozo.com/help/import)`.
   - **Extractors** (`extractors/jiji.ts`, `extractors/konga.ts`, and `extractors/structured.ts` for the shared JSON-LD Product and Offer, and Open Graph's text tags):
     - for an ad, each returns `{ store_key, ad_key, title, description, price, currency, condition, category_words, place_words, brand, model, attributes }`; for a store page, `{ store_key, name, codes, ads }`;
     - they are pure functions tested on saved copies of real pages.
     - When a source changes its pages, the failures show in the admin's report (below).
   - **Matching to Udozo:**
     - category: `matchSubcategories` (`whatsapp/flows/context.ts`) on the page's breadcrumb, then on the title;
     - place: `matchAreas` on its location (an area only, never a whole state);
     - price: the structured price, or `readPrice` on the words. It is kept only in the market's own currency.
     - condition: new, used, or foreign used (`untested`) from its words;
     - brand and model: `ClassifiedModelsService.detect` on the title;
     - features: other attributes become features only where a key in the feature registry matches, at most the listing's 20.
   - **The answer:** the draft's id, what was filled, and what was not ("Add photos", plus anything else missing, from `missingParts`).
   - Refusal codes: `import_not_your_ad`, `store_not_verified`, `import_unreachable`, `import_unreadable`, `import_limit`, `import_exists` (the seller's own earlier import, with its draft).
3. **Import a spreadsheet: `POST /v1/classifieds/imports/sheet { rows }`.**
   - udozo.com reads the file in the browser and sends at most `import_sheet_rows` a request. This needs `parseCsv` and the header matching moved from `apps/udozo-admin/components/marketing/csv.ts` into `@bitocard/api-client` so both apps share them.
   - The columns: title, price, condition, category, area or location, description, brand, model, stock and link (the source, if any). Konga's and Facebook catalogue exports' column names are matched too.
   - Photo columns are ignored, and the answer says so.
   - A spreadsheet is the seller's own list, so nothing is fetched. A row's link column is kept only if it is an ad of the seller's linked store, and otherwise dropped.
   - Each row is matched as for a link and becomes its own draft. The answer reports each row: drafted with what is missing, or refused with why.
4. **`GET /v1/classifieds/me/imports`:** the seller's imports with their drafts' state.
5. **Posting journeys:** the source `import`, added to `sellSources` in all three copies (the API's `journeys.service.ts`, udozo.com's `lib/sell-sources.ts`, the api-client's `posting-journeys.ts`) and to the admin's labels. Each draft is bound through `journeys.api` as WhatsApp's are.
6. **Moderation:** the first submit of a listing that has an import goes to `pending_review`, with the reason `imported`.

## Apps

- **udozo.com:**
  - Profile > **Linked stores** (`/account/profile/linked-stores`): link a store, the code with where to put it, Check now, then the store's name and when its link is next renewed, plus Unlink.
  - Post an ad offers **Import from your Jiji or Konga store**: until a store is linked it leads to Linked stores. After that it shows **Choose ads to import** (the store's ads as text, ticked), or the seller pastes an ad's address. Then it shows what was read and continues in the wizard.
  - It also offers **Import a spreadsheet**: download Udozo's template, upload, and see the row-by-row report.
  - My listings shows imported drafts marked "Imported: add photos".
  - A help page, `/help/import`, says what is imported, that photos never are, and why.
- **Marketing tie-in:** a seller who signs up through a Marketing invite has their Jiji ad addresses already on their prospect (`adverts` in `marketing.service.ts`). Once they link and prove their Jiji store, their Post an ad offers **Bring your N Jiji ads**: a checklist, each ticked one imported and owner-checked as above.
- **Udozo admin:** Reports > **Imports**:
  - imports by source and market;
  - failures by source and code, which is how a source changing its pages is noticed;
  - drafts posted against drafts left;
  - linked stores by platform, codes not yet found, and stores released by operations.
  - The two switches and the two limits sit on Limits and words.
- **Legal:** the terms say a seller may import only their own ads and is responsible for them. The privacy notice says what an import keeps and for how long. Bump `legalVersion`.

## Phases (one commit each, each tested)

0. **This plan**, saved and linked from AGENTS.md.
1. **Linked stores and ad import from Jiji and Konga:** linking and proving a store, its ad list, the owner check on every ad, the extractors, matching, and udozo.com's Linked stores and Import screens, behind `classifieds_import_jiji` and `classifieds_import_konga`. It goes live only after the legal check.
2. **Spreadsheet import:** the shared CSV helpers, the template, and the row-by-row report.
3. **The Marketing tie-in:** Bring your Jiji ads for invited sellers.
4. **Facebook: Marketplace and Page shops:**
   - **Link your Facebook Marketplace:** Facebook Login on Udozo's Meta app proves the profile (`method: facebook_login`). Its ads are imported by link where their public page names that profile (to confirm first), else by spreadsheet.
   - Facebook Login for Business on Udozo's Meta app (the WhatsApp one), with catalogue read permission once Meta approves it (App Review). Signing in links the Page or catalogue as a proved store (`method: facebook_login`);
   - `GET /{catalog-id}/products` asking only for text fields (`name`, `description`, `price`, `currency`, `condition`, `brand`, `availability`, `retailer_id`, `url`), never `image_url`;
   - the token used for that import and then discarded.
5. **Legal and docs:** the terms, the privacy notice and AGENTS.md.

## Owner steps (outside code)

1. Lawyers' view, per market, on reading a seller's own proved store and its ads on Jiji and Konga at their request (phase 1).
2. For phase 4, Meta App Review for the catalogue permission on Udozo's Meta app.
3. Switch `classifieds_import` on, then each platform's switch once it is cleared, starting with Nigeria.

## Verification

- **Tests in `apps/udozo-api`:**
  - `imports.test.mjs`, with a fake source server for Jiji's and Konga's pages and saved real pages. It covers:
    - linking a store: the code and its expiry, Check now, `store_linked_elsewhere`, unlinking, and releasing;
    - the owner check: an ad of another store is refused with `import_not_your_ad`;
    - the hosts allowed;
    - private addresses refused;
    - the size cap and the redirect rule;
    - the extractors' fields;
    - **no image field kept, and no second request**;
    - the draft's fields and what is missing;
    - the limits;
    - `import_exists`;
    - the first submit going to review;
    - the switches.
  - `imports-sheet.test.mjs`: rows, column names, photo columns ignored, and the report.
- **Tests in udozo.com:** `import.test.ts` (Linked stores, the ad list as text only, the forms, the report, the wizard opening at Photos).
- **Tests in the admin:** `imports.test.tsx`.
- Run each phase's targeted tests only, and build `@udozo/api` before its tests.
