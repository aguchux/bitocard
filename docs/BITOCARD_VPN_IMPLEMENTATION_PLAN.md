# BitoCard VPN implementation plan

**Status:** stages 1–5 implemented through 18 October 2026. VPN sales remain disabled.

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
- [ ] BitoCard end-user terms, acceptable-use rules, privacy notice, and support procedure are approved.
- [ ] Marketing has evidence for every privacy, security, logging, location, protocol, speed, device, and platform claim. Do not publish “anonymous” or “no logs” without approved evidence.

### 2. Consolidated product decision — started

- Add VPN access to `PLANS.md` as a fixed-term software service.
- Keep `software` as the MVP category and `WW` as the catalogue country, while availability remains gated by the buyer's enabled market.
- Use product key `software:WW:bitocard:vpn-access-30d` and supplier SKU configured only when stage 5 is ready.
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

### 6. Order provisioning

- Create the fixed 30-day supplier offer and BitoCard product through the existing catalogue sync/linkage.
- Provision only from the authoritative paid order transition.
- Use the existing order attempt, polling, wallet settlement, reversal, and exception queue.
- A clear supplier refusal fails through the existing reversal policy. A timeout stays pending and is reconciled before any retry.
- Set the expiry explicitly after account creation and verify it from a subsequent read before completing the order.

### 7. Lifecycle and reconciliation

- Disable accounts at the promised expiry and verify supplier status.
- Reconcile active accounts, expiry, actual daily cost, and central supplier balance.
- Alert on expiry drift, unexpected active accounts, low balance, and projected runway below the approved threshold.
- Offer audited password reset. Customer deletion is not an MVP action; permanent deletion is restricted to retention-aware admin maintenance.

### 8. Public API and documentation

- Add VPN subscription state to the order presenter and OpenAPI response.
- Add authenticated access and password-reset endpoints with reseller scopes.
- Webhooks report readiness/status only; clients fetch secrets from the authenticated order access endpoint.
- Update API guides and generated examples in the same change.

### 9. Admin experience

- Supplier credentials and connection test under Settings > Integrations.
- Product, offer, term, and market controls under Catalogue.
- Subscription health table with status, expiry, last sync, next sync, order, and safe supplier reference.
- Actions: sync, disable, enable, and password reset with existing audit conventions.

### 10. Storefront and order access

- Add the catalogue card and product detail using existing software components.
- Add VPN order access using the same authentication and Reveal system as licences and eSIMs.
- Status mapping: pending amber, processing blue, ready/active green, needs support amber, expired grey, failed red, refunded pink.
- Support phone widths, 44px controls, keyboard access, screen-reader labels, and no horizontal scrolling.

### 11. SHQ

- Present VPN in existing catalogue eligibility, price, order, customer, and report views.
- Keep supplier identity and cost hidden.
- Show term, customer price, BitoCard wholesale price, reseller profit, fulfilment state, and expiry using existing presenters.

### 12. Verification and controlled launch

- Unit: status mapping, dates, credentials, request bodies, 4xx refusal versus timeout ambiguity.
- Integration: paid provisioning, duplicate worker, lost create response, status polling, expiry, reset, reversal, and insufficient supplier balance.
- End to end: API, parent store, reseller store, SHQ, admin, order access, notifications, and webhooks.
- Pilot with internal accounts and a small supplier balance. Reconcile every account and daily charge before enabling one approved market.

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

Stages 1–5 establish decisions, registration, the supplier client, lifecycle persistence, and pre-call encrypted credentials. They intentionally leave VPN unavailable for purchase. The next implementation agent should begin at stage 6 and must not enable the supplier, its markets, a VPN offer, or a listing before stages 6–7 and the launch blockers are complete.
