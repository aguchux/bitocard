# Udozo ads importer: link your Jiji store, Konga store, Facebook and more, then bring your ads

**Status:** planned on 8 November 2026 at the owner's request. Nothing is built yet. Build it phase by phase only once the owner says so, and settle the legal points in Context before a platform's switch goes on.

## Context

The owner wants sellers already registered on Udozo to bring the ads they have on Jiji, Konga and Facebook without typing them again.

None of the three offers an official way in:
- **Jiji:** no seller API and no export.
- **Konga:** no public seller API. Its sellers work with spreadsheet uploads in Seller HQ.
- **Facebook:** Marketplace listings posted by individuals cannot be read through any API. Meta's Graph API reaches only business catalogues (Commerce Manager), and only for an app whose permissions Meta has approved.

**The owner's rules (8 November 2026):**
1. **Only a store's owner can import its ads.** A seller must first prove the store on the other platform is theirs, and every ad imported must belong to that store.
2. **Proving a store must not ask the seller to add anything to it first.** No codes in descriptions.
3. **Importers never import images, only a product's details:** its title, price, condition, category, place, description, brand, model and how many are in stock. The seller adds their own photos before posting.
4. **The importer is for people already registered on Udozo.** It never makes accounts.

**What the platforms' pages show** (checked on real pages, 8 November 2026):

| Platform | Can Udozo's server read it? | What it shows about the seller |
|---|---|---|
| **Jiji** (jiji.ng, jiji.co.ke, jiji.com.gh) | **No.** Every page, the sitemap included, answers 403 with Cloudflare's "Just a moment…" bot check. | Nothing reachable. |
| **Konga** | Yes. | A product page carries `seller: { id, name }` with ratings and "seller since". The store page, `konga.com/merchant/<id>`, has the name, city, state, "seller since" and the product list. **No phone, no email, and nothing the seller writes.** |
| **Facebook Marketplace** | No. Anonymous visits get an error page (HTTP 400). | Nothing reachable. |
| **Facebook Page shops** | Only through the Graph API, after Facebook Login. | The Pages and catalogues the person manages, and the catalogue's products. |

**Jiji pages are never fetched.** Getting past Jiji's bot check would mean dodging its protection, which is the legal risk this design avoids. Jiji imports work from Jiji records Udozo already holds (below).

**Legal points to settle first, per market:**
- reading a seller's own Konga merchant and product pages at their request;
- where Marketing's Jiji lists come from. If they come from a scraping tool, lawyers should look at that too, since Jiji imports are built on them.

The spreadsheet and the Facebook catalogue need no such check.

## Proving a store is the seller's, without editing it

A seller links a store once per platform, from Profile > **Linked stores** on udozo.com: **Link your Jiji store**, **Link your Konga store**, **Link your Facebook**, and more as platforms are added. Each platform is proved its own way:

- **Jiji: the phone number.**
  - The seller must already be registered on Udozo with a confirmed mobile, proved by a texted code (`phoneVerifiedAt`).
  - Udozo looks for that number among the Jiji sellers it already holds: Marketing's prospects from Jiji lists (`marketing_prospects` with `source` Jiji, their `phones` and `adverts`, in `apps/udozo-api/src/marketing/marketing.service.ts`).
  - On a match, Udozo says "We found your Jiji store, <name>, with N ads". The seller confirms, and the link is made with `method: phone_match`.
  - Nothing is fetched from Jiji.
  - A confirmed mobile belongs to one Udozo account, so a store found by it can be linked only by that account.
  - If the seller's confirmed mobile changes or is removed, the link is unlinked. Drafts already made stay theirs.
  - With no match, Udozo says it has no Jiji store for that number and offers the spreadsheet.
- **Konga: the merchant must match the account (proposed; the owner to confirm).**
  - The seller pastes their store's address, `konga.com/merchant/<id>`, and Udozo reads that one page.
  - The merchant's name must match the seller's Udozo account: their name, username or Seller HQ business name, compared as letters and digits only.
  - The merchant's state must be the state of the account's area (About you).
  - Konga shows no phone or email, so this is weaker proof than Jiji's or Facebook's. Two things make up for it: every Konga import goes to moderators before going live, and each Konga merchant can be linked to only one Udozo account.
  - A store that does not match is refused (`store_not_matched`), saying which check failed.
- **Facebook Page shops: signing in with Facebook.**
  - Facebook Login for Business on Udozo's Meta app (the WhatsApp one) with catalogue read permission, once Meta approves it in App Review.
  - Meta lists only the Pages and catalogues the person manages, so signing in is the proof (`method: facebook_login`).
- **Facebook Marketplace: signing in proves the account, but its ads cannot be read.** Facebook Login links the seller's Facebook account. With no way to read Marketplace listings, those sellers import with the spreadsheet.

**For every linked store:**
- **Kept:** the platform, the store's name and address where there is one, the platform's id for it (the identity ads are checked against), and how and when it was proved.
- **One store, one Udozo account.** Another account trying to link it is refused with `store_linked_elsewhere`. Operations can release a store from the admin, with a reason, audited.
- **Unlinking:** the seller can unlink a store at any time. Drafts already made stay theirs.

**The platform registry** (`platforms.ts`). Each entry gives:
- its key and name, and the markets it serves;
- its hosts and the shape of its store and ad addresses, where pages are read;
- how a store is proved (`phone_match`, `merchant_match` or `facebook_login`);
- where its ads come from: Udozo's records, its pages, its API, or the spreadsheet.

Adding a platform (Jumia vendors, an Instagram shop, a local classifieds site) is one entry, its reader and their tests, behind its own switch. Nothing else changes.

## Rules the design follows

- **No images, ever.**
  - Readers drop every image field: JSON-LD `image`, `og:image`, `<img>`, Konga's `image_thumbnail`, the Graph API's `image_url` (never asked for), Marketing's records' images, and a spreadsheet's photo columns.
  - Nothing downloads, stores, shows or links an image address from another site.
  - Tests pin this down: no image field in what is stored, and no request for anything but the page or API call itself.
- **Every imported ad must belong to the linked store:**
  - **Jiji:** it is one of that store's records.
  - **Konga:** its product page's `seller.id` is the linked merchant's id.
  - **Facebook:** it is in a catalogue the person manages.

  Anything else is refused with `import_not_your_ad`.
- **An import makes a draft, never a live ad.**
  - It becomes an ordinary draft through `ListingsService.create` and `update` (`apps/udozo-api/src/classifieds/listings.service.ts`).
  - The seller opens it in Post an ad (`ListingForm`). It opens at its first unfinished step, which is always Photos at least, since the market's minimum (`minPhotos`, 4) is never met by an import.
  - The seller then posts it as any other ad: the terms, `requireComplete`, the photo minimum, moderation, the monthly limits, and `submit`.
  - An imported ad's first posting goes to review, and moderators see the store it came from (`imported_from` on the admin's listing view).
- **Each ad is imported once**, and imports are limited per seller per day (`import_per_day`, 20).
- **Udozo's words win.** Imported text goes through the listing's own checks (`checkTitle`, `checkDescription`, refused words). Phone numbers, links and emails are cleaned out (`cleanNote`'s rules), so an ad cannot carry the other site's contact details.
- **The switches:**
  - `classifieds_import`, Udozo's only, global or country, **off by default**;
  - one per platform: `classifieds_import_jiji`, `classifieds_import_konga`, `classifieds_import_facebook_page`, `classifieds_import_facebook_marketplace`. A platform can stay off until its legal check is done while the spreadsheet goes ahead.

## Where each platform's ads come from

- **Jiji, from Udozo's records:** the matched prospect's `adverts`: title, price, category, location and the ad's address (kept only as where it came from). No description is held, so the draft asks for one. Each advert is imported once.
- **Konga, from its pages:**
  - **Choose ads to import** lists the merchant page's products: title, price and address, never a picture, up to five pages.
  - A pasted product address works too.
  - Each is read from its product page, whose `seller.id` must be the linked merchant's. That gives the name, brand, price, categories, stock and description.
- **Facebook Page shops, from the Graph API:** `GET /{catalog-id}/products` asking only for text fields (`name`, `description`, `price`, `currency`, `condition`, `brand`, `availability`, `retailer_id`, `url`). The token is used for that import and then discarded.
- **Anyone, from a spreadsheet:**
  - Udozo's template: title, price, condition, category, area or location, description, brand, model, stock, link.
  - Konga's and Facebook catalogue exports' column names are matched too.
  - Photo columns are ignored.
  - A spreadsheet is the seller's own list, so nothing is fetched. A row's link is kept only if it is an ad of the seller's linked store.

## Matching to Udozo (every source)

- **Category:** `matchSubcategories` (`apps/udozo-api/src/whatsapp/flows/context.ts`) on the source's categories (Konga's breadcrumb, Jiji's category), then on the title.
- **Place:** `matchAreas` on its location (an area only, never a whole state). Konga's city and state, then Jiji's location.
- **Price:** the structured price, or `readPrice` on the words. It is kept only in the market's own currency.
- **Condition:** new, used, or foreign used (`untested`) from its words.
- **Brand and model:** the source's brand, else `ClassifiedModelsService.detect` on the title.
- **Stock:** Konga's quantity, else none.
- **Features:** other attributes become features only where a key in the feature registry matches, at most the listing's 20.

## Data (one migration in `apps/udozo-api/prisma/migrations/`)

- **`classified_import_stores`**, one row per linked store:
  - who: the customer;
  - the store: `platform` (a registry key), `store_key` (the platform's id: Konga's merchant id, the Jiji prospect's id, the Facebook catalogue's or account's id), `name` and `url`;
  - proof: `method` (`phone_match`, `merchant_match` or `facebook_login`), `verified_at`, `phone_hash` (for `phone_match`, so a changed mobile can be noticed), and `released_at` with `released_by` and a reason for operations' releases;
  - uniqueness: an open link (not released or unlinked) is unique per `platform` and `store_key`, enforced by a partial unique index.
- **`classified_imports`**, one row per ad imported:
  - who: the customer and country;
  - where it came from: `platform` (or `sheet`), `store_id`, `source_url` and `source_key` (the platform's id for the ad, unique per linked store);
  - what happened: `status` (`drafted` or `failed`, with `error`), and `listing_id`, with no foreign key;
  - what was read: `fields` jsonb, the text exactly as read, for moderators and for "what we could not use";
  - `created_at`.
- **Market settings** (`classified_market_settings`): `import_per_day` (20) and `import_sheet_rows` (100).
- **Retention:** rows are deleted 90 days after the draft is posted or deleted, by the `marketing` job.

## API (`apps/udozo-api/src/classifieds/imports/`, `@ProductOnly('udozo')`, customer sessions)

1. **Linked stores:**
   - `GET /v1/store/account/import-stores` lists the seller's links, plus the Jiji store found for their confirmed mobile, if any (`found`).
   - `POST /v1/store/account/import-stores { platform, url? }`:
     - Jiji: links the store found by the phone (`phone_required` without a confirmed mobile, `store_not_found` without a match);
     - Konga: reads and checks the merchant (`store_not_matched`);
     - `store_linked_elsewhere` when another account has it.
   - `GET /v1/store/account/import-stores/facebook/start` and `POST …/facebook/finish`: Facebook Login, as Google sign-in does.
   - `GET …/import-stores/:id/ads?page=`: the store's ads to choose from, titles, prices and addresses, never images.
   - `DELETE …/import-stores/:id`: unlinks it.
   - Admins: the linked stores on the seller's page, and `POST /v1/admin/classifieds/import-stores/:id/release { reason }` (operations, audited `classifieds.import_store_released`).
2. **Import ads:** `POST /v1/classifieds/imports { store_id, keys }`, the chosen ads (a Jiji advert, a Konga product id or address, a catalogue product), up to 20 a request. Each becomes a draft. The answer gives each draft with what was filled and what was not ("Add photos", plus anything else missing, from `missingParts`).
   - Refusal codes: `import_not_your_ad`, `import_unreachable`, `import_unreadable`, `import_limit`, `import_exists` (the seller's earlier import, with its draft).
3. **Fetching Konga pages** (`fetch.ts`):
   - one GET, https only, Konga's hosts only, through `safeLookup` and `checkDestination` (`apps/udozo-api/src/webhooks/destinations.ts`);
   - redirects followed only on the same site;
   - the page only, never its images or scripts, capped at 2 MB, with a 10-second timeout;
   - an honest user agent: `UdozoImporter (+https://udozo.com/help/import)`.
   - Readers are pure functions (`readers/konga.ts`, and `readers/structured.ts` for JSON-LD), tested on saved copies of real pages. When Konga changes its pages, the failures show in the admin's report.
4. **Import a spreadsheet:** `POST /v1/classifieds/imports/sheet { rows }`. udozo.com reads the file in the browser and sends at most `import_sheet_rows` a request. This needs `parseCsv` and the header matching moved from `apps/udozo-admin/components/marketing/csv.ts` into `@bitocard/api-client`. The answer reports each row.
5. **`GET /v1/classifieds/me/imports`:** the seller's imports with their drafts' state.
6. **Posting journeys:** the source `import`, added to `sellSources` in all three copies (the API's `journeys.service.ts`, udozo.com's `lib/sell-sources.ts`, the api-client's `posting-journeys.ts`) and to the admin's labels.
7. **Moderation:** the first submit of an imported listing goes to `pending_review`, with the reason `imported`.

## Apps

- **udozo.com:**
  - Profile > **Linked stores** (`/account/profile/linked-stores`):
    - Jiji: "We found your Jiji store …" with Link it, or how to confirm their mobile first;
    - Konga: paste the merchant page, then the result of the match;
    - Facebook: Continue with Facebook;
    - each linked store with Unlink.
  - Post an ad offers **Import your ads**: until a store is linked it leads to Linked stores. After that it shows **Choose ads to import** (as text, ticked), then what was read, then continues in the wizard. Next to it is **Import a spreadsheet**: Udozo's template, the upload and the row-by-row report.
  - My listings shows imported drafts marked "Imported: add photos".
  - A help page, `/help/import`, says what is imported, that photos never are, how each store is proved, and why.
- **Udozo admin:** Reports > **Imports**:
  - imports by platform and market;
  - failures by platform and code;
  - drafts posted against drafts left;
  - linked stores by platform and method, stores refused as not matched, and stores released.
  - The switches and the two limits sit on Limits and words.
- **Legal:** the terms say a seller may import only their own ads and is responsible for them. The privacy notice says what an import keeps, the phone match against Udozo's own records, and how long it is all kept. Bump `legalVersion`.

## Phases (one commit each, each tested)

0. **This plan**, saved and linked from AGENTS.md.
1. **Linked stores and Jiji by phone:** the registry, the tables, Jiji's phone match against Marketing's records, importing its adverts as drafts, and udozo.com's Linked stores and Import screens.
2. **Konga:** the merchant match, its readers, and importing products by page.
3. **Spreadsheet import:** the shared CSV helpers, the template and the row-by-row report.
4. **Facebook:** Login, Page catalogues through the Graph API, and Marketplace linking (spreadsheet for its ads).
5. **Legal and docs:** the terms, the privacy notice and AGENTS.md.

## Owner steps (outside code)

1. Lawyers' view per market on reading Konga's pages at a seller's request, and on how Marketing's Jiji lists were obtained.
2. Confirm the Konga merchant match (or ask for a stronger check).
3. For phase 4, Meta App Review for the catalogue permission on Udozo's Meta app.
4. Switch `classifieds_import` on, then each platform's switch once it is cleared, starting with Nigeria.

## Verification

- **Tests in `apps/udozo-api`:** `imports.test.mjs`, with a fake Konga server serving saved real pages and a fake Graph API. It covers:
  - Jiji:
    - the phone match: no confirmed mobile, no match, a match;
    - a changed mobile unlinking the store;
    - `store_linked_elsewhere`;
    - only that store's adverts imported;
  - Konga:
    - the merchant match passing, and refused for a different name or state;
    - a product of another merchant refused with `import_not_your_ad`;
    - only Konga's hosts, private addresses refused, the size cap;
  - **no image field kept, and no request but the page or API call**;
  - the draft's fields and what is missing, `import_exists`, the limits, the first submit going to review, and the switches.
- `imports-sheet.test.mjs`: rows, column names, photo columns ignored, and the report.
- **Tests in udozo.com:** `import.test.ts` (Linked stores, the ad list as text only, the wizard opening at Photos).
- **Tests in the admin:** `imports.test.tsx`.
- Run each phase's targeted tests only, and build `@udozo/api` before its tests.
