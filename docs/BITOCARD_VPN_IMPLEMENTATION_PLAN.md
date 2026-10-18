# BitoCard VPN implementation plan

**Status:** stages 2–11 implemented on 18 October 2026 (engineering complete). Stage 1's launch blockers and stage 12's pilot remain, so VPN sales stay disabled: the supplier, its markets and any listing are off.

This is the implementation source for VPN access in BitoCard. The earlier `BITOCARD_VPNRESELLERS_CLAUDE_PLAN.md` is background material only. Where they differ, this plan, `PLANS.md`, `DESIGN.md`, and `AGENTS.md` win.

## Product decision

BitoCard will initially sell one prepaid software service: **VPN access — 30 days**. It is a fixed access term, does not renew automatically, and is fulfilled through BitoCard's existing supplier order system. VPNresellers is the first internal supplier and is never named to storefront customers or resellers.

For the MVP, VPN is a `software` subtype rather than a new platform category. Each future term is a separate product and supplier offer. The initial supplier, product, market, and listing remain disabled until every launch gate below is satisfied.

## Design direction

- Use the existing software category colour and catalogue card pattern from `DESIGN.md`.
- Card copy: `VPN access — 30 days`, `Up to 10 devices`, price, and the standard arrow chip.
- Product detail: term, verified device allowance, supported platforms, what is included, exact end behaviour, refund summary, acceptable-use summary, and one pink `Buy VPN access` action.
- Order access: canonical status badge, expiry, `Does not renew automatically`, secure Reveal for credentials, copy controls, client links, setup steps, password reset, and support.
- SHQ uses the existing Catalogue, Pricing, Orders, and Reports areas. There is no separate VPN section for the MVP.
- Admin uses Integrations, Catalogue, pricing rules, the order exception queue, and a subscription health view added in stage 7.
- Never show the supplier, wholesale cost, project ID, routing, raw errors, private keys, or configuration files outside authorised admin operations.

## Stages

### 1. Supplier, commercial, and legal qualification — in progress

Public material checked:

- REST API v4.1 supports account creation, lookup, enable, disable, expiry, password changes, projects, customers, servers, and configurations.
- Supplier billing is daily while an account has Active status; disabled accounts are not charged.
- Public material advertises brandless clients and up to 10 devices per account.
- Supplier credit is prepaid and used credit is generally non-refundable.

These are evidence for engineering only. They are not permission to enable sales or make customer claims.

Launch blockers requiring written answers or an executed agreement:

- [ ] BitoCard may serve independent reseller storefronts and reseller API customers under one central account.
- [ ] Approved sales countries and any sanctions, export, identity, or residency restrictions are recorded.
- [ ] End-user data fields, subprocessors, retention, network logging, abuse handling, and law-enforcement handling are documented and accepted by privacy/legal reviewers.
- [ ] The supplier confirms current device and simultaneous-connection limits.
- [ ] The supplier confirms account expiry, timezone, disable, re-enable, password reset, and deletion behaviour.
- [ ] A deterministic username or BitoCard reference can be searched after an ambiguous create response. If not, uncertain creates must go to manual review and must never be retried automatically.
- [ ] API rate limits, maintenance behaviour, status/outage communication, and support escalation are recorded.
- [ ] Funding minimum, top-up routes and fees, taxes, volume tier calculation, price-change notice, balance endpoint, and low-balance behaviour are recorded in the supplier funding profile.
- [ ] Retail cancellation/refund rules are approved, including what happens before and after credentials are revealed.
- [ ] BitoCard end-user terms, acceptable-use rules, privacy notice, and support procedure are approved. Drafted on 18 October 2026 (terms of use section 5, the privacy notice's VPN access part, the reseller terms' products section); awaiting legal review and the supplier's logging answers.
- [ ] Marketing has evidence for every privacy, security, logging, location, protocol, speed, device, and platform claim. Do not publish “anonymous” or “no logs” without approved evidence.

### 2. Consolidated product decision — started

- Add VPN access to `PLANS.md` as a fixed-term software service.
- VPN is its own category, `vpn` (18 October 2026; it started under `software`), with its own Catalog menu group, `WW` as the catalogue country, and availability gated by the buyer's enabled market (`vpn` is off in every market by migration). Being its own category keeps it to one per order and out of delivery emails, which software allows.
- Use product key `vpn:WW:bitocard:vpn-access-30d` and supplier SKU configured only when stage 5 is ready.
- Snapshot the expected cost for the whole sold term. Reconcile the actual daily supplier cost separately.
- Do not call the product “monthly” or promise automatic renewal.

### 3. Supplier registration and credentials — started

- Supplier code: `vpnresellers`.
- Admin integration fields: bearer token, project ID, expected monthly cost in USD, and API address.
- Secrets use the existing encrypted integration settings and audit trail.
- The database supplier starts disabled with no enabled markets.
- Own supplier integrations are excluded from the MVP.

### 4. Initial supplier adapter — started

- Add `VpnresellersAdapter` to the central adapter registry.
- Implement the authenticated v4.1 transport and account lifecycle calls.
- Normalise supplier account status and expiry without exposing raw responses.
- Do not sync a product or implement `placeOrder` yet. This prevents an administrator from exposing a half-built fulfilment path.
- Add focused adapter tests for authentication, safe error classification, account creation, lookup, expiry, enable, disable, and password replacement.

### 5. Persistence and encrypted delivery — complete

- [x] Add `VpnSubscription`, unique by order and by supplier account.
- [x] Extend supplier fulfilment with `SuppliedVpnSubscription` and optional `vpn` lifecycle methods.
- [x] Add `vpn_account` to encrypted `OrderDelivery` and the Reveal policy.
- [x] Store the password only in encrypted delivery storage. Never log it or include it in webhooks, lists, notifications, or lifecycle rows.
- [x] Generate the password before the create attempt and persist the encrypted value before the network call so a retry uses the same credentials.

### 6. Order provisioning — complete

- [x] Create the fixed 30-day supplier offer and BitoCard product through the existing catalogue sync/linkage (`vpn:WW:bitocard:vpn-access-30d`, SKU `vpn-30-day`, face value and cost the integration's expected monthly cost).
- [x] Provision only from the authoritative paid order transition (`OrdersService.attempt`; the sandbox never calls the supplier).
- [x] Use the existing order attempt, polling, wallet settlement, reversal, and exception queue.
- [x] A clear supplier refusal fails through the existing reversal policy. A timeout stays pending and is reconciled before any retry: `check_username` first, then the project's accounts; the status check never creates.
- [x] Set the expiry explicitly after account creation and verify it from a subsequent read before completing the order. Access ends at the start of the UTC day after 30 full days (`vpnExpiry`), so the customer always gets at least 30 days. An account without an expiry would renew automatically and bill every day, so it never completes.
- [x] Accounts are created inside BitoCard's project under a BitoCard customer record named after the account (`vpn+<username>@bitocard.com`): no end-user data is sent. **Confirm with the supplier** that such customer records are acceptable.

### 7. Lifecycle and reconciliation — complete

- [x] `VpnService` (`apps/api/src/vpn/vpn.service.ts`) syncs what each subscription should be (active within its term while its order is completed; `expired`, `revoked` after a refund, `suspended` by an admin, `failed`) with the supplier, and reads it back before believing it. The `vpn` job runs every 15 minutes.
- [x] Disable at the promised expiry and after refunds, verified; unconfirmed disables retry (5, 15, 60, 180, 360 minutes) and then tell operations (`admin.vpn.attention`).
- [x] Expiry drift (including a missing expiry) is set back to ours and reported; an account the supplier disabled during its term goes to `needs_review`, never re-enabled blindly.
- [x] Daily reconciliation (`vpn-reconcile` job, `vpn_reconciliations`): the project's Active accounts against ours (strays and missing ones, ours checked again at once), the credit (`GET /profile`), the credit used since the previous run, and the runway. `admin.vpn.credit_low` below `LOW_BALANCE_USD` (default 25) or under 7 days of runway.
- [x] Audited password reset for resellers, customers and admins: the new password is stored encrypted as pending before the supplier is asked and sent again until confirmed, so an unclear reply never strands the customer. Customer deletion is not an MVP action.

### 8. Public API and documentation — complete

- [x] Following the eSIM pattern, VPN state is its own resource rather than a field on `Order`: `GET /v1/vpn-subscriptions(?order_id, status)`, `GET /v1/vpn-subscriptions/{id}` (`orders:read`), `POST /v1/vpn-subscriptions/{id}/password-reset` (`orders:write`, owners, admins and support), documented with full examples and checked against real responses.
- [x] `vpn_subscription.updated` reports status only (active, expired, revoked, suspended, needs review); credentials only on `GET /v1/orders/{id}`.
- [x] Guides: Orders > VPN access, the changelog, the reference tag `VPN`.

### 9. Admin experience — complete

- [x] Credentials and the low-credit threshold under Settings > Integrations > Suppliers > VPNresellers.
- [x] Orders > VPN access (`apps/admin/app/(console)/orders/vpn`): health (active, needing attention, credit and runway, billed against expected), every subscription with its supplier state, last and next check and errors, and the reconciliations. Actions: check now, suspend, enable (step-up), password reset, run the reconciliation; all audited.

### 10. Storefront and order access — complete

- [x] The product uses the existing software card and product page.
- [x] Order access (`/a/<token>` and `/account/orders/<id>`): the username and password hidden until Reveal (the username too), with copy; `VpnAccess` shows the status, when access ends, "Does not renew automatically", devices and a password reset that shows the new sign-in once.

### 11. SHQ — complete

- [x] The order page shows the VPN delivery as Username and Password, and a VPN access card with its status, expiry and password reset. Catalogue, pricing and reports use the existing views.

### 12. Verification and controlled launch

- [x] Unit and integration tests: `test/vpnresellers.test.mjs` (lookup, create once, unclear create, refusal, expiry that does not stick, expiry dates, credit and accounts), `test/vpn-lifecycle.test.mjs` (provisioning, reset including an unclear one, expiry, refund, drift, review, suspend and enable, reconciliation, schemas, the supplier never named), `test/vpn-credentials.test.mjs`, storefront `test/vpn-actions.test.ts`.
- [ ] Pilot with internal accounts and a small supplier balance. Reconcile every account and daily charge before enabling one approved market.
- [ ] Check against the live API: `check_username`, `/projects/{id}/accounts` paging and `status` filter, the `customer` record on create, and that `expire_at` ends access at midnight UTC.

## Non-negotiable invariants

1. No payment confirmation means no supplier account.
2. One order creates at most one supplier account.
3. An unclear create result is never treated as failure and never blindly repeated.
4. Customer and reseller surfaces never expose the supplier.
5. Passwords and private configurations are encrypted at rest and revealed only through authorised order access.
6. The full promised term is financially covered before provisioning.
7. Expired access stops supplier billing and is verified by reconciliation.
8. Every capability is available through the versioned reseller API before a BitoCard screen depends on it.

## Handoff state

Engineering is complete through stage 11 (18 October 2026). What is left is not code: the stage 1 launch blockers (written resale and market approval, privacy, acceptable use and refund terms, verified claims, the supplier's answers on lifecycle and limits) and the stage 12 pilot. Until then, keep the supplier, its markets and any listing switched off. Enabling sales means: save the credentials, switch on one approved market, sync, review the price, list it, then switch the supplier on.
