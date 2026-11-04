# Udozo: watermarked listing photos (plan and contract)

Status: **approved 4 November 2026** (the owner's choices: resellers' own text where admins allow it; originals made
private; a corner mark plus a faint one across the centre). Build in `apps/udozo-api`, `apps/udozo`, `apps/udozo-admin`,
`apps/udozo-shq` and `packages/api-client` only.

## Why

Listing photos are public files on Spaces (`classified_media.url`, `public-read`), linked from every page, the
structured data and the sitemaps, so anyone can copy them for fake listings elsewhere. From now on people only ever
receive copies with a watermark drawn into the image, and the originals stop being public.

## How it works

- **Photos are served by udozo.com** at `/img/<media id>.jpg?m=<mark version>[&w=480|960|1600]`
  (`apps/udozo/app/img/[file]/route.ts`), which reads the private original from Udozo's API, resizes it (never larger
  than the original), draws the watermark and answers a JPEG with `Cache-Control: public, max-age=31536000, immutable`
  (the address carries the mark's version, so a new text gets new addresses). On a reseller's store the same path is
  served on the store's own address (the proxy names the store in `x-udozo-store`), with the store's mark.
- **The mark:** the text in the bottom-right corner (white, with a soft dark shadow, about 3.5% of the image's width
  high), and the same text large and faint (about 16% opacity, slightly rotated) across the middle. Drawn from Inter
  (bundled), never the server's fonts.
- **Which text:** udozo.com and everything outside a store: Udozo's text, set by admins (default `udozo.com`). A
  reseller's store: the reseller's own text where the `store_watermarks` switch allows it (global, country or
  reseller; off by default) and they set one; otherwise Udozo's.
- **Switching on:** `photo_watermarks` (Udozo's, global only, off by default). Off: everything as today. On: the API
  returns the watermarked addresses everywhere, new uploads are stored private, and the `classifieds` job makes
  existing originals private (500 a run). Turned on by an admin once udozo.com's image route is live.

## API contract

1. **Switches** (`settings.service.ts`, Udozo's only): `photo_watermarks` (global) and `store_watermarks` (global,
   country, reseller).
2. **Udozo's text:** `GET /v1/admin/classifieds/watermark` and `PUT … { text }` (operations; support reads; audited
   `watermark.changed`): 2 to 30 characters of letters, digits, spaces and `. - _ @`; every change adds 1 to its
   `version`. Kept in a one-row table `watermark_settings` (text, version, updated_by, updated_at), seeded `udozo.com`, 1.
3. **A store's text:** `stores.watermark_text` (null or the same rule, refused words refused, `text_refused`) and
   `stores.watermark_version` (adds 1 on every change). Seller HQ: `PATCH /v1/stores/:id { watermark_text }` (owners
   and admins, sessions only) refused with 403 `store_watermark_unavailable` unless `store_watermarks` is on for the
   reseller; the store's answer carries `watermark_text` and `watermark_allowed`. Admins clear one:
   `DELETE /v1/admin/stores/:id/watermark { reason }` (operations, audited `store.watermark_cleared`, the reseller told).
   Admins list stores with their own text: `GET /v1/admin/classifieds/watermark/stores`.
4. **Public mark lookup** (udozo.com's image route): `GET /v1/classifieds/watermark?store=<store id>` (public,
   `max-age=60`): `{ object: 'watermark', text, version }`: the store's text when allowed and set, else Udozo's;
   without `store`, Udozo's. `version` is a string that changes whenever the text shown changes (`u<udozo version>` or
   `u<udozo version>s<store version>`).
5. **Originals for udozo.com's server only:** `GET /v1/classifieds/media/:id/original` with
   `Udozo-Media-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<id>" keyed with STORE_SERVER_SECRET>` (five minutes
   either side; anything else answers as unknown, 404): the photo's bytes and type, read with credentials from storage,
   for photos (never videos) of listings that are not removed or deleted; `Cache-Control: private, no-store`.
6. **Addresses in answers:** one helper `photoUrl(media, context)` used by every presenter that returns a listing photo
   (listing pages, cards, search, home, sitemaps, resale shops, Seller HQ's resale catalogue, the admin):
   while `photo_watermarks` is on, `https://udozo.com/img/<id>.jpg?m=<version>` (`UDOZO_URL`/`STOREFRONT_URL` base),
   and for a resale shop's own pages the store's live address (its primary domain, else its subdomain) with the store's
   version; off, the stored `url` as today. Cards may ask for `w=480`.
7. **Private originals:** while on, new photos are stored without `public-read`; the `classifieds` job sets existing
   ones private (`classified_media.private_at`), 500 a run, logging failures and retrying next run. Video files and
   posters are unchanged (not watermarked). Internal readers (the shop assistant's Fill from photos, moderation,
   duplicates) read originals with credentials, never by their public address.

## Owner steps once deployed

1. Settings > Feature switches: turn on `photo_watermarks`. Optionally `store_watermarks` for resellers.
2. DigitalOcean > Spaces > the CDN endpoint: Purge cache for `udozo/classifieds/*`, so copies the CDN still holds of the
   originals stop being served (browsers and search engines may keep old copies).
