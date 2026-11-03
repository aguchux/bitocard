# Udozo home pages: rows of blocks

## Context

udozo.com's home pages (`/` and each `/<cc>`) are a flat list of sections on a 12/6/1-column grid (`apps/udozo-api/src/classifieds/home/`, admin Site › Home pages). The owner wants every part of the page to belong to a **row**. Admins stack rows and add **blocks** of content to each row. A row can hold masonry grids, smooth **marquee sliders** of chosen listings or stores, and **banners linked to a category**.

Decisions taken:
- This phase covers udozo.com's home pages only. Resale shops' own home pages move to rows in a later phase.
- Listing marquees take hand-picked listings, topped up from a source.
- Existing pages are converted automatically and keep their look.
- The stores marquee shows Resale shops that Udozo admins pick, or that fill automatically.

## Data model (API, `apps/udozo-api/src/classifieds/home/layout.ts`)

**Page envelope.** It becomes `{ layout, rows: HomeRow[] }`, still kept in `storefront_pages` under `home:global` / `home:<CC>`, with versions as today.

**HomeRow:**
- `id`, `hidden`
- `title` text(80) default `''` and `subtitle` text(200): the row's heading.
- `viewAll: homeLink | null`: a "See all" link for the row.
- `background`: none, soft, navy, brand or image. `image` is an `imageUrl` and required when the background is image.
- `width`: contained or full (edge to edge).
- `spacing`: tight, normal or loose.
- `blocks: HomeBlock[]`: 1 to 6 blocks.

**HomeBlock.** Every existing section type becomes a block, with the same fields, `span` (lg/md) and `hidden`. New types:
- `listing_marquee`:
  - `title`
  - `picks`: up to 24 listing refs, in order.
  - `fill`: `{ by: none | newest | trending | category | deals, value }`. Only `none`, `newest` and `trending` are allowed on the global page.
  - `limit` 6 to 30, `speed` slow/normal/fast, `direction` left/right, `cards` standard/compact.
- `store_marquee`:
  - `title`
  - `picks`: up to 24 store ids.
  - `fill`: none, most_listings or newest.
  - `limit`, `speed`, `direction`.
  - It only ever shows published Resale shops in the page's countries.
- `masonry_grid`: up to 16 tiles, each with a `size` (sm/wide/tall/lg) and an optional image. A tile is one of:
  - `{kind: category, slug}`
  - `{kind: listing, ref}`
  - `{kind: image, image, title, link: homeLink}`
- `category_banner`:
  - `category` slug, required.
  - `title` and `body`: an empty title shows the category's name.
  - `image`: null takes a live listing photo from the category.
  - `tone`, and `style` split or overlay.
  - `cta` (default "Shop now"), and `showCount`.
  - It always links to the category.

`category_masonry` and `banner` stay as they are, so converted pages are unchanged.

**Limits:**
- 20 rows, 6 blocks per row, 40 blocks per page.
- Ids must be unique across rows and blocks.
- `layout_invalid` names the field as `rows[2].blocks[1].title`, by extending `invalidLayout` paths.
- The scope rules move to blocks: no `deals_rail` on the global page, no `country_tiles` on country pages, no search links on the global page, and the existing `listing_group` rule.

**Converting old pages** (`rowsFromSections` in `layout.ts`, used by `readEnvelope` in `home.service.ts`):
- An old `{sections}` envelope (draft, published or any version) is converted when read.
- Consecutive sections whose `lg` spans fit within 12 are packed into one row. A hero gets a row of its own, full width.
- Rows get no title and no background, so the page renders as before.
- Saves always write rows.
- No SQL migration is needed: restoring old versions keeps working.

## API changes

- **`layouts.ts`:** starter pages rewritten as titled rows for marketplace, deals and explorer. They use the new blocks: a trending marquee, two category banners side by side, and a stores marquee on country pages.
- **`home.service.ts`:**
  - `PUT /v1/admin/classifieds/home/:page/draft { rows }`. It also accepts `{ sections }` and converts them, so the old admin keeps working during deploy.
  - Layout replace and reset use rows.
  - `sections_allowed` becomes `blocks_allowed`. `sections_allowed` is still sent for one release.
- **`home-resolver.ts`:**
  - Resolves blocks row by row, in order: Sponsored first across the whole page, as today, and the same page-wide `taken` dedupe.
  - **Listing picks:** `cardsByRefs(refs, countries)` keeps their order and drops listings that are not live. `fill` then tops up to `limit`. Picks are exempt from dedupe against later blocks.
  - **Stores:** `storeCards({ ids | fill, countries, limit })`.
    - Matches `Store` rows with `template='resale_shop'`, `status='published'`, a non-house reseller that is not suspended, and the reseller's country in the page's countries.
    - Each card is `{ id, name, logo_url, primary_color, url, listings, country }`.
    - `url` is the store's active primary domain, otherwise `https://<sub>.<STORE root>`, built with the same rule as `lib/store-host.ts` / `resale-trade.service.ts:361`.
    - `listings` counts `ResaleStoresService.onSale`.
  - **Category banners:** the category's name, its count and a cover photo, reusing `covers()`.
  - **Masonry grid tiles:** categories via `covers()`, listings via `cardsByRefs`, images as given.
  - **Global page:** no prices.
  - **Public response:** `rows: [{...row, blocks: resolved}]`, plus a flattened `sections` for one release so the current udozo.com keeps working.
- **Admin pickers** (`home.controller.ts`, operations and support):
  - `GET /v1/admin/classifieds/home/stores?country&q` lists published Resale shops to pick.
  - Listings are picked through the existing admin listing search (`/v1/admin/classifieds/listings?q`, which already finds SKUs). It gets a `status=active&country=` filter if it lacks one.
- **Client types** (`packages/api-client/src/home.ts`): `HomeRow`, the new block types, `ResolvedHomeRow` and `HomeStoreCard`. Hooks in `packages/api-client/src/admin/` gain the store search.

## Admin editor (`packages/admin-ui/src/storefront/rows/`, new; used by `apps/udozo-admin/app/(console)/home-pages/page.tsx`)

- **Don't change `SectionsEditor`.** It is still used by bitocard.com's storefront and Seller HQ stores. Pull its toolbar, autosave, versions, publish and preview logic into a shared `usePageDraft` hook and `EditorToolbar`, and have both editors use them.
- **`RowsEditor`** (generic over a `SectionRegistry` of block types, so Resale shops can reuse it later):
  - **Canvas:** rows stacked vertically.
    - Each row is a card with a drag handle, its title and background swatch, and buttons for hide, duplicate, move up/down and delete.
    - Inside each row, its blocks sit on the 12/6/1 grid with the existing width and two-rows controls (`grid.ts` helpers reused).
    - Blocks can be dragged within a row and across rows, using dnd-kit multiple containers with keyboard support.
    - Each block also has a "Move to row…" menu.
  - **Adding:**
    - "Add row" sits between rows and at the end, with presets: empty, one full, two halves, three thirds, four quarters, and a hero row.
    - "Add block" on each row opens the type menu, filtered by `blocks_allowed`.
  - **Inspector:**
    - Selecting a row shows its settings: title, subtitle, see-all link, background with image upload (`home_image`), width and spacing.
    - Selecting a block shows that block's form from Udozo's registry.
  - Desktop, tablet and phone views, as today.
- **Udozo registry** (`apps/udozo-admin/components/home/registry.tsx`): new forms, built from the existing `CategorySelect`, `LinkField`, `ItemList`, `NumberField` and `ImageField`:
  - `ListingPicker`: search by title or SKU, showing photo, title, SKU and price; reorder and remove.
  - `StorePicker`: search the market's Resale shops.
  - A fill source select, and speed and direction controls.
  - Masonry tile editor.
  - Category banner form, with a live preview of the default title and photo.

## Live content preview in the editor (owner's request: admins, and Seller HQ later, see what they add as they add it)

**Real page beside the rows.** The editor is split: rows and blocks with the inspector on one side, and the **real page** on the other (`RowsEditor` `preview` slot).
- It shows udozo.com's `/home-preview?page=&token=` in an iframe, so the preview is exactly what visitors will see: the same renderer and data.
- The width follows the Desktop, Tablet and Phone toggle (1280, 768 and 390 px, scaled to fit).
- On small screens, the preview is a tab instead of a split.
- A preview token is asked for once (30 minutes) and renewed before it runs out (`usePreviewToken`).

**Updates on save.**
- After each autosave succeeds, the editor posts `{type: "refresh"}` to the frame.
- The preview page re-renders in place (`router.refresh()`) and keeps its scroll position. There is no full reload or flash.
- A "Saving…" or "Up to date" chip shows on the frame.

**Click to edit.**
- In preview mode, udozo.com wraps each row and block in `data-home-row` / `data-home-block` attributes (only on `/home-preview`).
- A small client script (`components/home/preview-bridge.tsx`) outlines blocks on hover. A click posts `{type: "select", row, block}` to the parent, and the editor selects it and opens its form.
- Selecting a block in the editor posts `{type: "focus", id}`, and the preview scrolls to that block and highlights it.
- Every message is checked against the other side's origin: `ADMIN_APP_URL` on udozo.com, the storefront origin in the admin app.
- Links inside the preview do not navigate while it is embedded.

**Framing.** udozo.com allows `frame-ancestors` admin.udozo.com, and later shq.udozo.com, **only on `/home-preview`**, through `next.config.ts` headers. Every other page stays `frame-ancestors 'none'`.

**Content in the cards too.** Each block card on the editor's canvas shows a thumbnail of its real content:
- the listings' photos and store logos it will show, or the banner's image and title;
- "Empty: nothing to show here" when it resolves to nothing.

These come from `POST /v1/admin/classifieds/home/:page/resolve { rows }` (operations and support; not cached; the same `HomeResolver`), called after each save. Admins can therefore see a sold-out pick or an empty category before publishing.

**Built generic.** The preview is built so Resale shops' editor in Seller HQ can reuse it in the later phase: the frame source and allowed origin are props.

## udozo.com renderer (`apps/udozo/components/home/`)

- **`HomeRows`:** each row is a `<section>` with its background, width, spacing, heading and see-all link. Inside it, the existing 12/6/1 grid of blocks uses the current `One` switch for the old types.
  - A first row that is a hero runs edge to edge, as now.
  - If the API answers without `rows`, it falls back to `sections`.
- **`components/marquee.tsx`**, a new shared primitive:
  - **Movement:** a CSS keyframe translates a track whose content is duplicated. The copy is `aria-hidden`, `inert` and has no tab stops.
  - **Speed:** set from the item count and the `speed` setting.
  - **Pausing:** it pauses on hover and when something inside has focus. A visible Pause/Play button covers WCAG 2.2.2.
  - **Reduced motion:** no animation; it renders as the existing manual `Slider`.
  - **Width:** never wider than the screen (overflow clipped, `contain-inline-size`).
- **Cards and blocks:**
  - `StoreCard`: the logo, or initials on the store's colour; the name, its listing count and "Visit store".
  - `CategoryBanner`: split or overlay style; the whole banner is one link to the category.
  - `MasonryGrid`: reuses the masonry tile styles.
- **Structured data:** `firstListingSection` reads blocks inside rows.

## Docs and legal

- **AGENTS.md:** rewrite the home pages bullet for rows, blocks, the new block types, conversion, the stores marquee and the marquee's accessibility.
- **Legal:** check the terms' section 2 on ranking. Hand-picked listings and stores are a new kind of placement, so state that admins choose them (not paid). Sponsored stays labelled as it is.

## Later phase (not in this plan)

Resale shops' own home pages move onto `RowsEditor`, edited by the reseller in Seller HQ and by Udozo admins.

## Part B: Hospital and medical equipment category (owner's request, 3 November 2026)

**What exists today:**
- There is no Medical equipment category. `medical-equipment` was dropped on 31 October by migration `20270201500000_category_remodel`: deleted where it had no listings, switched off where it had some.
- Udozo does have **Health and mobility aids** (`health-equipment`) under Beauty and personal care, with:
  - features `batteries` and `max_weight`;
  - 14 brands: Omron, Accu-Chek, OneTouch, Philips, Beurer, Microlife, Rossmax, Medisana, Invacare, Drive Medical, Yuwell, Contec, On Call Plus, Braun;
  - 47 models.

**Migration `20270209000000_medical_equipment`.** It is idempotent and keyed by slug.

**Top category.** `medical-equipment`, **Hospital and medical equipment**, lucide `stethoscope`, placed after Beauty and personal care. A disabled `medical-equipment` row is reused (made top-level and switched back on), so any old listings come back under it.

**Subcategories:**

| Slug | Name | Covers |
|---|---|---|
| `health-equipment` | Home care and monitoring | Moved here from Beauty and personal care; the slug is kept, so links, listings and brands stay. BP monitors, glucometers, thermometers, pulse oximeters, nebulisers, oxygen concentrators. |
| `mobility-patient-care` | Mobility and patient care | Wheelchairs, walkers, crutches, hospital and home-care beds, commodes, pressure mattresses. |
| `clinic-hospital-equipment` | Clinic and hospital equipment | Patient monitors, ECG, ultrasound, autoclaves, examination couches, dental chairs, suction machines. |
| `lab-equipment` | Laboratory equipment | Microscopes, centrifuges, haematology and chemistry analysers, incubators. |
| `medical-supplies` | Medical supplies and PPE | Gloves, syringes, masks, dressings and test kits, new and sealed only. |

**Category settings:**
- Each subcategory gets an icon, a unique SKU prefix (checked against `classified_category_sku_prefixes`, e.g. MED, MOB, CLN, LAB, MSP) and suggested features.
- The category is opened in every market as the other categories are, so it appears in each market's category list. It stays closed wherever the marketplace is closed.

**Features.** Existing registry keys are reused where they fit: `brand`, `model`, `batteries`, `max_weight` and the product registration number key. New filterable keys only where buyers ask:
- `power_source` (mains, battery, both);
- `certification` (CE, FDA, ISO 13485), where it exists;
- `sterile` (yes/no), `pack_size` and `expiry_date`, for supplies.

**Brands** (`classified_brands` and `classified_brand_categories`, most bought first; existing brands are linked, not duplicated):
- **Home care and monitoring:** keeps its 14.
- **Mobility and patient care:** Invacare, Drive Medical, Sunrise Medical, Karma, Ottobock, Permobil, Medline.
- **Clinic and hospital equipment:** Mindray, Philips, GE HealthCare, Siemens Healthineers, Edan, Contec, Welch Allyn, Riester, Dräger, Nihon Kohden, Biolight, Comen, Yuwell.
- **Laboratory equipment:** Olympus, Mindray, Sysmex, Abbott, Roche, Beckman Coulter, Thermo Fisher, Eppendorf, Hettich.
- **Medical supplies and PPE:** 3M, BD, Nipro, Terumo, Medline, Ansell, Hartmann, Mölnlycke, Top Glove, Supermax.
- **Logos:** brands in Simple Icons get bundled logos (`apps/udozo/scripts/brand-logos.mjs`); the rest show initials.

**Models** (`classified_brand_models`, per brand and category, best known first). These are written from knowledge of these markets and reviewed by sampling, as before: sellers can still type their own, and admins turn wrong ones off. Examples:
- Mindray: iMEC 8/10/12, uMEC 10/12, ePM 10/12, BC-30s, BC-5150, BS-240.
- Edan: iM50/60/70, M3.
- Contec: CMS50D, CMS8000.
- Yuwell: 7F-5, 403A.
- Philips: EverFlo, SimplyGo.
- Olympus: CX23, CX43.
- Sysmex: XP-300, XN-350.
- Hettich: EBA 200.
- Invacare and Drive Medical: their common wheelchair and bed models.
- Omron's and Accu-Chek's existing models stay.

**Rules.** Medical devices are regulated (NAFDAC, FDA Ghana, PPB Kenya):
- The Safe Trade Guide gets checks for the category: test it before paying, check seals and expiry, and ask for the registration number.
- Refused words for things that may never be sold: used syringes or needles, opened single-use items, prescription medicines.
- The terms' prohibited items get the same, with a line that sellers must hold any licence their country requires.
- Shop assistants pick all of this up from the generated country knowledge.
- The lawyers' review owed for this category is noted in AGENTS.md.

**Tests:**
- `apps/udozo-api/test/classifieds-foundation.test.mjs`: the tree, `health-equipment` now under the new top category, a unique SKU prefix for each subcategory, and the category open in every market.
- `classified-brands.test.mjs` and `classified-models.test.mjs`: the new links, and model detection, e.g. "Mindray iMEC 10" in a title.
- udozo.com `test/brands.test.ts`: the filter and logos for one new category.
- **Docs:** update AGENTS.md's Udozo categories bullet: "15 top categories", plus the list of what was dropped.

## Saving this plan

On implementation, copy this plan to `docs/UDOZO_HOME_ROWS_PLAN.md`, with Part B included, and commit it with the work.

## Verification

- **API** (`apps/udozo-api/test/classified-home.test.mjs`, extended; PGlite and `npm run test:docker`):
  - Rows parse, and `param` paths come back in the `rows[i].blocks[j]` form.
  - The limits and the scope rules per block hold.
  - Old drafts, published pages and versions convert, and resolve to the same blocks as before.
  - Picks keep their order, sold listings drop out and `fill` tops up.
  - Dedupe holds and the global page shows no prices.
  - The stores marquee shows only published Resale shops in the country, with own-domain URLs.
  - The category banner uses its default title and photo.
  - Draft PUT accepts the old `sections` shape.
  - Store search roles: support reads, finance is refused.
  - `openapi.json` is unchanged, since these are admin and excluded routes.
- **Editor:**
  - `packages/admin-ui/test/rows-editor.test.tsx`: add a row from a preset, add a block, move a block across rows by keyboard, row settings, and the autosave payload `{rows}`.
  - `apps/udozo-admin/test/home-pages.test.tsx`: the listing and store pickers, the category banner, and the support role read-only.
- **Preview:**
  - The frame is told to refresh after an autosave.
  - A `select` message from the preview's origin opens that block's form; one from any other origin is ignored.
  - Block cards show their resolved thumbnails.
  - udozo.com's `test/home-preview.test.ts`: the bridge posts `select` only to the admin origin, and links are not followed while embedded.
  - `frame-ancestors` is allowed only on `/home-preview` (header test reads `next.config.ts`).
  - API: `resolve` matches what publishing would show, and is refused for finance.
  - `SectionsEditor`'s existing tests still pass (bitocard and Seller HQ unchanged).
- **udozo.com** (`apps/udozo/test/home-sections.test.ts`, plus new `marquee.test.ts`):
  - Rows render with headings and backgrounds.
  - The marquee's copy is hidden and inert, the Pause button works, and the reduced-motion CSS is present.
  - Store card links are right, and the category banner links to `/<cc>/c/<slug>` (or `/c/<slug>` on the global page).
  - The old `sections` fallback still works.
  - `mobile-width.test.ts` passes at 320/360/390 px.
- **Manually:**
  - `npm run dev:admin` against the local API: build a page with each block, publish it, open the preview on udozo.com (`npm run dev` in `apps/udozo`).
  - Check phone width, and the marquee with reduced motion turned on.
- Run `npm run check` for the touched workspaces before committing. Commit only own files, then push.

## As built (3 November 2026)

- Part A and Part B are built as planned, with these differences:
  - `RowsEditor` is a new component beside `SectionsEditor` rather than sharing a refactored toolbar hook, so bitocard.com's and Seller HQ's editor are untouched.
  - Rows have no presets: a new row starts with the block chosen, and blocks added to a row share its width evenly (up to four); widths stay adjustable per block.
  - Blocks move between rows from their card's row menu; dragging works within a row, and rows drag among themselves.
  - Stores marquees show only Resale shops live on their own domain (sandbox stores have no public address to send visitors to).
  - Medical brands have no bundled logos yet (initials show).
