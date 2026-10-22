# Country-localised bitocard.com stores: implementation plan

**Status:** planning complete, sign-off received (22 October 2026) on root-redirect and shared-customer-pool decisions below. No code shipped yet. Stage 1 not started.

This is the implementation source for giving bitocard.com country-localised subdomains (`ng.bitocard.com`, `gh.bitocard.com`, `ke.bitocard.com`, …), one per pilot market, each a fully local storefront (its own catalogue scope, currency, seller of record) hosted the same way a reseller's own store is hosted today. Where this plan differs from `AGENTS.md`, this plan is provisional until merged back into it; `AGENTS.md` wins on everything it already states unless this document explicitly supersedes a line of it (noted inline below).

## Why

A UK (GB) customer bought Nigerian MTN airtime on bitocard.com (a legitimate case: buying airtime for someone abroad) and checkout failed with `conversion_unavailable` ("Conversions to and from GBP are paused"). Root cause, traced in detail during planning: bitocard.com has exactly one global `Store` row (`houseStoreId`) and resolves the seller of record for every purchase as `HouseService.resellerFor(customer.country)` — the **buyer's** country's house account. `PricingService.context()` then prices against that seller's currency (`reseller.countryRef.currency`), so a GB buyer's purchase of an NGN-priced product is forced through a GBP pricing context even though the product itself never needed GBP at all. Same-country purchases already skip FX correctly today (`PricingService.convert()`'s early return when `from === ctx.currency`); the bug only bites when a foreign visitor's country forces a foreign currency context onto a domestic product.

**The fix is routing, not a new FX bypass.** Giving each pilot market its own store (seller of record fixed to that market, not to the visiting customer) means a purchase on `ng.bitocard.com` is always priced through the NG house account regardless of who is buying, so NGN products never need GBP (or any other buyer currency) to be healthy. Cross-border purchases (an NGN buyer paying for a KES product, or a GBP wallet paying an NGN price) still convert at payment time exactly as today — this plan does not eliminate FX, it eliminates *unnecessary* FX forced by buyer-not-product country routing.

## Product decisions (signed off)

- **Root `bitocard.com` redirects.** Once a market has a live country store, choosing that market in the signed-out market dialog (or being a signed-in customer whose fixed country has a live store) redirects into `<country>.bitocard.com` rather than setting the `bc_market` cookie and staying on root. Root remains the global discovery/market-choice shell permanently for any market **without** a live country store yet (so bitocard.com never regresses for un-piloted markets).
- **Customer accounts are not fragmented.** Unlike reseller stores ("an account at one store does not exist at another", `AGENTS.md`), country stores share bitocard.com's single existing customer pool. A customer's account is the same whether reached through root or their country's subdomain; only which store/seller context serves their purchases changes. This is a deliberate, documented deviation from the reseller multi-store isolation pattern — do not accidentally apply `CustomerGuard`'s per-store session scoping to country stores.
- **DNS mechanism is Cloudflare, not Vercel.** The original proposal named "the Vercel API to add the subdomain"; corrected during planning. bitocard.com's zone lives on Cloudflare (`AGENTS.md`, "Store addresses on bitocard.com"); Vercel's Domains API only adds a domain to the storefront's Vercel *project* for TLS/routing and cannot create the DNS record. Country subdomains are provisioned with the exact same two calls `StoreHostsService.sync()` already makes for reseller stores: `cloudflare.createRecord(...)` then `vercel.addToProject(...)`. No wildcard DNS or certificate, consistent with the existing "No wildcard record or wildcard certificate" rule.
- **Pilot markets are the existing three**: Nigeria, Ghana, Kenya, matching `AGENTS.md`'s pilot markets. No other market gets a country store until these three are validated in production through a full billing/payout cycle.
- **No new Prisma tables.** Country stores are `Store` rows (the existing multi-store/template machinery from M14b), owned by each market's existing house `Reseller` row, with `template: 'all_in_one'`. The schema already supports this; several specific call sites that assumed exactly one house store do not (see Stage 2).

## Stages

### 1. Per-market house store + lifted hosting skip — not started

- [ ] Add `HouseService.storeFor(countryCode)`: resolves (or creates) one `Store` row per house reseller, `subdomain = countryCode.toLowerCase()`, `template: 'all_in_one'`, owned by that market's house `Reseller`. Backfill NG, GH, KE via migration; new markets get theirs the moment `HouseService.resellerFor(countryCode)` first creates their house reseller (mirrors how a reseller's first store is provisioned today — no separate admin action required for this to work, though an explicit "activate now" admin action is still useful, see Stage 4).
- [ ] Lift the house-account skip in `StoreHostsService.sync()` (`if (!store || store.reseller.house) return null;`) and its retry job (`where: { reseller: { house: false } }`) **but keep the single root `bitocard` store excluded by store ID**, not by `reseller.house`, so root's own address provisioning is never touched by this change.
- [ ] Provision NG's `ng.bitocard.com` (Cloudflare CNAME + Vercel project domain) through the existing, unmodified `StoreHostsService` mechanism. Confirm `ready` status and TLS before Stage 2.
- [ ] New feature switch `country_stores` (off by default; global or per-country scope, consistent with `switchDefinitions`): gates whether any country-store behaviour is reachable at all. Ship Stage 1 entirely dark (switch off everywhere) — infrastructure only, no customer-visible change.
- [ ] Tests: extend `store-hosts.test.mjs` for a house-reseller-owned store; a new test asserting root's store is never touched by the lifted skip.

### 2. Replace the single `houseStoreId` sentinel — not started

`apps/api/src/checkout/house.service.ts`'s `houseStoreId` constant is read as "this is BitoCard's own store" in roughly 8–11 call sites across support (`support/bots.service.ts`, `support/chats.service.ts`, `support/knowledge.ts`, `support/replies.service.ts`, `support/tickets.service.ts`), customers (`checkout/store-customers.ts`, `customers/customers.service.ts`), and top-ups (`top-ups/manual-top-ups.service.ts`). Each needs individual judgement, not a mechanical find-replace:

- [ ] Audit each call site and classify its real intent: "any BitoCard-owned store" (→ `reseller.house === true`) vs. "specifically the single global root shell" (→ keep comparing against the root store's fixed ID). Record the classification per file in this plan before changing code, so a reviewer can check the reasoning, not just the diff.
- [ ] Apply the reclassified checks. Each change ships with its own test (per repo convention: "A new or changed endpoint ships with its response docs and a real-response check in the same change" — apply the same discipline here even though these aren't new endpoints).
- [ ] Full regression pass on support tickets, chat and the platform assistant across at least two house stores (root and NG) to confirm scoping didn't bleed between them.

### 3. Pricing/seller routing fix — not started

This is the change that actually closes the GB/NGN bug.

- [ ] `StoreSellers.sellerFor()` / `seller()`: when resolving the seller for a request on a country store (`store.reseller.house && store.subdomain !== 'bitocard'`), use that store's own house reseller as the seller of record — never the *visiting customer's* country's house account. Root bitocard.com keeps today's behaviour (seller resolved from the customer's country) unchanged, since root's whole purpose is serving customers whose market has no store yet.
- [ ] Add a regression test reproducing the exact reported bug: a GB-country customer, on `ng.bitocard.com`, buying NGN-priced MTN airtime, with GBP's `currencySetting` deliberately paused — assert the purchase succeeds and no `fx.rate('GBP')` call occurs.
- [ ] Add a genuine cross-border test that must keep working: an NGN-wallet customer on `ng.bitocard.com` buying a USD-face gift card (still needs FX, by design) and an NGN-wallet customer topping up a KES number (cross-border top-up, still needs FX) — confirm both still succeed when their respective currencies' rates are live, proving this stage removes *unnecessary* FX only, not FX itself.

### 4. Storefront routing and the root redirect — not started

- [ ] `apps/storefront/lib/store.ts`: extend `storeHost()`/`HostedStore` to carry `house: boolean` (read from the API's `reseller.house`, never inferred from the subdomain string client-side). `ownHosts` stays `{'www', 'bitocard'}` — a country subdomain is a real store context, not "no store," so it must not be added there.
- [ ] `onResellerStore()` stays `false` for a house country store (it hides BitoCard's own pages — reseller landing page, etc. — for the same reason root already hides them, not because the store is foreign to BitoCard).
- [ ] Confirm `lib/market.ts`'s existing `if (await storeSubdomain()) return "global"` already does the right thing once `storeHost()` correctly reports `ng` as a store subdomain — planning found this needs no change, which is worth re-verifying with a test once Stage 1–3 land, not assuming it still holds after other changes.
- [ ] Root's market-choice dialog and the signed-in redirect path: once a chosen/fixed market has `country_stores` on and a `ready` store, redirect (not just cookie-set) to `https://<country>.bitocard.com`. Markets without a live store keep today's cookie-only behaviour.
- [ ] Check `order-access.service.ts`'s host-building logic (keys off `store.subdomain !== 'bitocard'` today) for correctness once country stores exist, so order links and receipts resolve to the right host.
- [ ] Enable `country_stores` for NG only. Validate end-to-end in production (or a close staging equivalent) before Stage 5.

### 5. Expand to GH and KE, then general rollout — not started

- [ ] Repeat Stage 1–4's NG-specific validation for GH and KE once NG has run a full billing/payout cycle without incident.
- [ ] Extend `HouseService.resellerFor(countryCode)`'s first-checkout auto-creation to also auto-provision that market's `Store` row and address (Stage 1's `storeFor`), so a new market's country store comes up automatically without a separate admin step.
- [ ] Add an explicit admin action (Settings > Markets, reusing `StoreHostsService.sync()`) to provision a country store ahead of that market's first checkout, for admins who want to redirect a market before its first sale.

## Explicit deviations from the original request (for the record)

1. Vercel was proposed as the DNS mechanism; Cloudflare is correct and already built for this exact purpose — see "Product decisions" above.
2. "Same-country purchases should never need FX" was already true before this plan; the actual gap was seller/store routing, not a missing FX bypass. Stage 3 is a routing fix, not an FX-service change.
3. Customer accounts deliberately do **not** adopt the reseller-store "scoped to one store" isolation model for country stores — see "Product decisions" above.

## Critical files

- `apps/api/src/checkout/house.service.ts`
- `apps/api/src/checkout/store-sellers.ts`
- `apps/api/src/stores/store-hosts.service.ts`
- `apps/api/src/catalogue/pricing.service.ts`
- `apps/api/src/orders/order-access.service.ts`
- `apps/storefront/lib/store.ts`
- `apps/storefront/lib/market.ts`
- `apps/api/prisma/schema.prisma` (`Reseller`, `Store`, `Country`)
