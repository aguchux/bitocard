# Udozo ads importer: bring your ads from Jiji, Konga and Facebook

**Status:** planned on 8 November 2026 at the owner's request. Nothing is built yet. Build it phase by phase only once the owner says so, and settle the legal point in Context before phase 1 goes live.

## Context

The owner wants sellers to bring the ads they already have on Jiji, Konga and Facebook onto Udozo without typing them again.

None of the three offers an official way in:
- **Jiji:** no seller API and no export. The only tools around are third-party scrapers.
- **Konga:** no public seller API. Its sellers work with spreadsheet uploads in Seller HQ.
- **Facebook:** Marketplace listings posted by individuals cannot be read through any API. Meta's Graph API reaches only business catalogues (Commerce Manager), and only for an app whose permissions Meta has approved.

So the importer works from **what the seller gives it**. That is the address of one of their own ads, a spreadsheet, or later their Facebook business catalogue. It is never a crawl of another site.

**Owner's rule, 8 November 2026: importers never import images, only the product's details.** That means its title, price, condition, category, place, description, brand, model and how many are in stock. The seller adds their own photos before posting.

That rule also keeps out of Udozo the other sites' watermarks, photos the seller may not own the rights to, and the cost of fetching them.

**Legal point to settle first:** Jiji's and Konga's terms very likely forbid automated copying of their pages. Fetching one page once, because its own seller asked, is a far smaller step than scraping. Even so, lawyers should confirm it per market before link import is switched on. The spreadsheet and the Facebook catalogue need no such check.

## Rules the design follows

- **No images, ever.**
  - Extractors drop every image field: JSON-LD `image`, `og:image`, `<img>`, and a spreadsheet's photo columns.
  - Nothing downloads, stores, shows or links an image address from another site.
  - Tests pin this down: no image field in what is stored, and no request beyond the one page.
- **An import makes a draft, never a live ad.** It becomes an ordinary draft through `ListingsService.create` and `update` (`apps/udozo-api/src/classifieds/listings.service.ts`).
  - The seller opens it in Post an ad (`ListingForm`). It opens at its first unfinished step, which is always Photos at least, since the market's minimum (`minPhotos`, 4) is never met by an import.
  - The seller then posts it as any other ad: the terms, `requireComplete`, the photo minimum, moderation, the monthly limits, and `submit`.
- **The seller's own ads only, as far as Udozo can tell.**
  - Each source address is imported once per seller.
  - Imports are limited per seller per day (`import_per_day`, 20).
  - An imported ad's first posting goes to review. Moderators see where it came from (`imported_from` on the admin's listing view).
  - An address another seller has already imported is flagged to moderators, never refused: two people can sell the same thing.
- **Udozo's words win.** Imported text goes through the listing's own checks (`checkTitle`, `checkDescription`, refused words). Phone numbers, links and emails are cleaned out (`cleanNote`'s rules), so an ad cannot carry the other site's contact details.
- **The switch:** `classifieds_import`, Udozo's only, global or country, **off by default**. Link import for each source has its own switch, `classifieds_import_links`, so that it can stay off until the legal check is done while spreadsheets go ahead.

## Data (one migration in `apps/udozo-api/prisma/migrations/`)

- **`classified_imports`**, one row per thing imported:
  - who: the customer and country;
  - where it came from: `source` (`jiji`, `konga`, `facebook` or `sheet`), `source_url` (null for a spreadsheet row) and `source_key` (an HMAC of the normalised address, unique per customer, and indexed across customers for the "imported elsewhere" flag);
  - what happened: `status` (`drafted` or `failed`, with `error`), and `listing_id`, with no foreign key, so a deleted draft keeps its record until retention removes it;
  - what was read: `fields` jsonb, the details exactly as read (text only), for moderators and for "what we could not use";
  - `created_at`.
- **Market settings** (`classified_market_settings`): `import_per_day` (20) and `import_sheet_rows` (100).
- **Retention:** rows are deleted 90 days after the draft is posted or deleted, by the `marketing` job.

## API (`apps/udozo-api/src/classifieds/imports/`, `@ProductOnly('udozo')`, customer sessions)

1. **Import from a link: `POST /v1/classifieds/imports { url }`.**
   - Only the hosts of the sources, in Udozo's markets: Jiji's (`jiji.ng`, `jiji.com.gh`, `jiji.co.ke` and the others) and Konga's (`konga.com`).
     - Facebook item pages need a sign-in, so Facebook comes through its catalogue or a spreadsheet instead (phase 4).
     - Any other address is refused with `import_source_unsupported`.
   - **Fetching** (`fetch.ts`):
     - one GET, https only, through `safeLookup` and `checkDestination` (`apps/udozo-api/src/webhooks/destinations.ts`);
     - redirects followed only on the same site, three at most;
     - the page only, never its images or scripts, capped at 1 MB with a 10-second timeout;
     - an honest user agent: `UdozoImporter (+https://udozo.com/help/import)`.
   - **Extractors** (`extractors/jiji.ts`, `extractors/konga.ts`, and `extractors/structured.ts` for the shared JSON-LD Product and Offer, and Open Graph's text tags):
     - each returns `{ title, description, price, currency, condition, category_words, place_words, brand, model, attributes }`;
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
   - Refusal codes: `import_unreachable`, `import_unreadable`, `import_limit`, `import_exists` (the seller's own earlier import, with its draft).
2. **Import a spreadsheet: `POST /v1/classifieds/imports/sheet { rows }`.**
   - udozo.com reads the file in the browser and sends at most `import_sheet_rows` a request. This needs `parseCsv` and the header matching moved from `apps/udozo-admin/components/marketing/csv.ts` into `@bitocard/api-client` so both apps share them.
   - The columns: title, price, condition, category, area or location, description, brand, model, stock and link (the source, if any). Konga's and Facebook catalogue exports' column names are matched too.
   - Photo columns are ignored, and the answer says so.
   - Each row is matched as for a link and becomes its own draft. The answer reports each row: drafted with what is missing, or refused with why.
3. **`GET /v1/classifieds/me/imports`:** the seller's imports with their drafts' state.
4. **Posting journeys:** the source `import`, added to `sellSources` in all three copies (the API's `journeys.service.ts`, udozo.com's `lib/sell-sources.ts`, the api-client's `posting-journeys.ts`) and to the admin's labels. Each draft is bound through `journeys.api` as WhatsApp's are.
5. **Moderation:** the first submit of a listing that has an import goes to `pending_review`, with the reason `imported`, and `imported_elsewhere` when another seller imported the same address.

## Apps

- **udozo.com:**
  - Post an ad offers **Import from Jiji or Konga**: paste the ad's address, see what was read, then continue in the wizard.
  - It also offers **Import a spreadsheet**: download Udozo's template, upload, and see the row-by-row report.
  - My listings shows imported drafts marked "Imported: add photos".
  - A help page, `/help/import`, says what is imported, that photos never are, and why.
- **Marketing tie-in:** a seller who signs up through a Marketing invite has their Jiji ad addresses already on their prospect (`adverts` in `marketing.service.ts`). Their Post an ad offers **Bring your N Jiji ads**: a checklist, each ticked one imported as above.
- **Udozo admin:** Reports > **Imports**:
  - imports by source and market;
  - failures by source and code, which is how a source changing its pages is noticed;
  - drafts posted against drafts left;
  - imports flagged as imported elsewhere.
  - The two switches and the two limits sit on Limits and words.
- **Legal:** the terms say a seller may import only their own ads and is responsible for them. The privacy notice says what an import keeps and for how long. Bump `legalVersion`.

## Phases (one commit each, each tested)

0. **This plan**, saved and linked from AGENTS.md.
1. **Link import from Jiji and Konga:** the API, the extractors, matching, and udozo.com's Import from a link, behind `classifieds_import_links`. It goes live only after the legal check.
2. **Spreadsheet import:** the shared CSV helpers, the template, and the row-by-row report.
3. **The Marketing tie-in:** Bring your Jiji ads for invited sellers.
4. **Facebook business catalogues:**
   - Facebook Login for Business on Udozo's Meta app (the WhatsApp one), with catalogue read permission once Meta approves it (App Review);
   - `GET /{catalog-id}/products` asking only for text fields (`name`, `description`, `price`, `currency`, `condition`, `brand`, `availability`, `retailer_id`, `url`), never `image_url`;
   - the token used for that import and then discarded.
5. **Legal and docs:** the terms, the privacy notice and AGENTS.md.

## Owner steps (outside code)

1. Lawyers' view, per market, on fetching a seller's own ad page from Jiji and Konga at their request (phase 1).
2. For phase 4, Meta App Review for the catalogue permission on Udozo's Meta app.
3. Switch `classifieds_import` (and `classifieds_import_links` once cleared) on, starting with Nigeria.

## Verification

- **Tests in `apps/udozo-api`:**
  - `imports.test.mjs`, with a fake source server for Jiji's and Konga's pages and saved real pages. It covers:
    - the hosts allowed;
    - private addresses refused;
    - the size cap and the redirect rule;
    - the extractors' fields;
    - **no image field kept, and no second request**;
    - the draft's fields and what is missing;
    - the limits;
    - `import_exists` and the imported-elsewhere flag;
    - the first submit going to review;
    - the switches.
  - `imports-sheet.test.mjs`: rows, column names, photo columns ignored, and the report.
- **Tests in udozo.com:** `import.test.ts` (the forms, the report, the wizard opening at Photos).
- **Tests in the admin:** `imports.test.tsx`.
- Run each phase's targeted tests only, and build `@udozo/api` before its tests.
