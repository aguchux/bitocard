---
title: Changelog
description: Changes to the BitoCard API and its webhooks. Additions are not breaking; removing or renaming a field needs a new version.
---

# Changelog

The API is versioned in its path (`/v1`). Within a version:

- **Not breaking:** new endpoints, new optional request fields, new response fields, new event types, new values in fields documented as open lists. Build your code to ignore fields it does not know.
- **Breaking:** removing or renaming a field, changing a field's type or meaning, or making an optional request field required. These only ever come with a new version, announced here first.

Webhook payloads carry their own `api_version`; see [Webhooks → Versioning](/guides/webhooks#versioning).

## October 2026

- **Full API reference.** Every endpoint now documents its response schema with a complete example, the scopes it needs, and the errors it can return.
- **Try it.** Signed-in resellers can call the API from these docs against their sandbox or live account, using a short-lived token instead of an API key. See [Try it](/guides/try-it).
- **`GET /v1/account`** can report `authenticated_as.type: "docs_token"` for calls made from the docs.
- **Pricing.** Each product sells as a discount product (never above face value; you choose how much of your discount your customer gets) or a markup product (your markup, or a fixed price per product). `PUT /v1/pricing/markups` accepts a general setting (no `category`), `customer_discount_bps` and, for one product, `fixed_price`; fields you leave out are kept and `null` clears one. New: `GET /v1/catalogue/products/{id}/price-preview` shows one sale's price and your profit, with settings you are trying. Before launch we removed `earning` from `GET /v1/pricing` (discount products now always earn the discount), and markup fields in its `markups` can be `null`.

## Earlier

- Webhooks with signed deliveries, retries for 3 days, a delivery log and the events API (`GET /v1/events`).
- Orders with "unclear is not failed" handling: a `processing` order is checked with the same supplier until it completes or fails.
- Sandbox for every reseller, with `simulate` on orders, top-ups, deposits, payouts and customer checks.
