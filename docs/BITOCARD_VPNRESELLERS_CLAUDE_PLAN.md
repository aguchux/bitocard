# BitoCard VPNresellers Catalog Integration Plan

> **For:** Claude Code / implementation agent  
> **Project:** BitoCard, owned by Golojan Ltd  
> **Status:** Implementation plan; confirm supplier account access and commercial terms before production  
> **Last reviewed:** 18 October 2026

## 1. Goal

Add VPN subscriptions to the BitoCard catalog using VPNresellers as the initial supplier. A BitoCard customer or reseller purchases a plan through the existing BitoCard checkout and wallet flow. After confirmed payment, BitoCard provisions a VPN account through the supplier API and delivers setup instructions to the buyer.

BitoCard owns the customer-facing catalog, plan names, retail prices, order, wallet debit, reseller margin, notifications, and support entry point. VPNresellers supplies VPN account infrastructure and connection configurations.

## 2. MVP scope

### Include

- One supplier integration: VPNresellers REST API v4.1.
- One VPN catalog product with BitoCard-defined terms, initially monthly; make 3-month and 12-month terms configurable after expiry and billing behavior is verified.
- BitoCard checkout using the existing wallet/payment and order pipeline.
- Provision a supplier account only after an order reaches the existing paid/confirmed state.
- Associate each supplier account with the BitoCard order and customer.
- Deliver username, password, expiry, client-app instructions, and support details securely.
- Store supplier status and expiry for the order details page and support tooling.
- Admin configuration for supplier activation, plan retail prices, and margins, following existing catalog patterns.
- Reseller availability and pricing rules use BitoCard's existing reseller catalog model.

### Exclude from MVP

- Building BitoCard-branded VPN apps or VPN protocols/client software.
- Customer-selected VPN server routing or manual configuration downloads in the UI.
- Automatic subscription renewal or recurring wallet debits.
- Multiple VPN suppliers or automated supplier routing.
- A reseller-managed VPN supplier API key. All supplier API calls use BitoCard's central supplier account.

## 3. Supplier API capabilities to integrate

Base URL: `https://api.vpnresellers.com/v4_1`

The API documentation describes:

- Account creation, lookup, listing, expiry-date setting, password change, enable/disable, and deletion.
- Customer and project records for associating accounts and separating channels.
- Server listing and OpenVPN, WireGuard, and VLESS configuration retrieval.
- Profile/balance access.

Use the supplier-provided brandless VPNclient apps for the MVP. Public pricing says supported client apps allow up to 10 devices per account. Do not expose protocol configuration files in regular customer flows unless product and security review approves it.

Important commercial behavior: VPNresellers publishes active-account pricing. At the entry tier, it lists $1.99 per active account/month for 1–999 active accounts; accounts are charged based on supplier account status, not actual connection activity. An inactive account has no account charge per its pricing page. Confirm exactly how a set expiry date transitions an account to inactive and stops charges before launching term plans.

Official references:

- [VPNresellers API v4.1 documentation](https://api.vpnresellers.com/docs/v4_1/)
- [VPNresellers API overview](https://www.vpnresellers.com/vpn-reseller-api)
- [VPNresellers pricing](https://www.vpnresellers.com/vpn-reseller-pricing)

## 4. Customer purchase and provisioning flow

1. Customer selects a VPN term from BitoCard Catalog. Display BitoCard retail price, term, device allowance, platform availability, and renewal policy.
2. Existing order service creates a pending order and reserves/debits wallet funds according to current BitoCard payment rules.
3. Existing payment state machine confirms payment. Only this authoritative state may trigger provisioning.
4. Create a durable provisioning job/outbox record using the BitoCard order ID as the internal idempotency key. Prevent duplicate accounts if a worker retries.
5. Create or locate a supplier customer record and create the VPN account, attaching the appropriate supplier project and customer identifier where supported.
6. Set supplier account expiry from the purchased term. If the supplier API creation operation accepts expiry, set it there; otherwise call the expiry endpoint immediately after creation.
7. Persist supplier account ID, username, status, expiry, project/customer IDs, and a secret reference for credentials/configuration. Do not store supplier API tokens in order records.
8. Mark the BitoCard order fulfilled only after the supplier confirms account creation and required expiry state.
9. Deliver credentials and brandless app setup instructions through the existing secure order delivery mechanism. Avoid sending connection private keys in email or logs.
10. On provisioning failure, retry only safe operations; otherwise place the order in an actionable failure state and follow existing BitoCard refund/reversal policy. Do not silently charge twice or create duplicate accounts.

## 5. Catalog and pricing model

Keep the supplier wholesale rate separate from the customer-facing plan price.

Suggested initial BitoCard plans:

| Plan SKU | Customer term | Supplier action |
|---|---:|---|
| `vpn-monthly` | 30 days | Create account and set expiry date |
| `vpn-quarterly` | 90 days, after verification | Set expiry date 90 days from fulfillment |
| `vpn-annual` | 365 days, after verification | Set expiry date 365 days from fulfillment |

Do not hard-code the wholesale supplier rate into the frontend. Maintain it in supplier configuration or a price snapshot on each fulfilled order. Calculate BitoCard reseller/retail pricing through the platform's established pricing rules. Account for days active, payment fees, currency conversion, FX buffer, refund exposure, and supplier prefunding in margin calculations.

Check with VPNresellers whether the expiry date is a hard access cutoff and whether their daily billing is prorated. Do not promise a term or margin until these details are confirmed.

## 6. Data model additions

Adapt names to the current Prisma schema rather than creating parallel order/customer concepts.

### `SupplierConnection`

- `id`
- `supplier` enum/string (`VPNRESELLERS`)
- `status` (`DISABLED`, `SANDBOX`, `ACTIVE`, `SUSPENDED`)
- `baseUrl`
- `credentialsSecretRef` (reference to secret manager/environment only)
- `createdAt`, `updatedAt`

Never store the raw API token in a database field, frontend bundle, job payload, or logs.

### `SupplierProduct` or existing catalog linkage

- supplier connection ID
- supplier product/category identifier if applicable
- BitoCard catalog product ID
- configurable terms and supplier settings
- availability and enablement flags

### `VpnSubscription` (or equivalent fulfillment record)

- BitoCard order ID (unique)
- BitoCard customer ID
- supplier account ID and username
- supplier customer ID and project ID
- status (`PROVISIONING`, `ACTIVE`, `SUSPENDED`, `EXPIRED`, `FAILED`, `CANCELLED`)
- purchased term and expected expiry
- supplier-reported expiry and last sync time
- credential secret reference or encrypted credential fields using the existing application encryption/key-management standard
- last error code/message sanitized of secrets
- created/updated timestamps

Use a unique constraint on the BitoCard order ID and supplier account ID as appropriate. Retain the order's price, currency, and supplier-cost snapshot for financial reconciliation.

## 7. Backend design

Follow the existing BitoCard stack and conventions: NestJS API, Prisma/PostgreSQL, existing authentication, catalog, wallet/order, notification, and job queue patterns.

Implement a provider adapter instead of calling VPNresellers directly from controllers:

```ts
interface VpnSupplierProvider {
  createCustomer(input: CreateVpnCustomerInput): Promise<VpnCustomer>;
  createAccount(input: CreateVpnAccountInput): Promise<VpnAccount>;
  getAccount(accountId: string): Promise<VpnAccount>;
  setExpiry(accountId: string, expiresAt: Date | null): Promise<VpnAccount>;
  setEnabled(accountId: string, enabled: boolean): Promise<VpnAccount>;
  changePassword(accountId: string, password: string): Promise<void>;
  deleteAccount(accountId: string): Promise<void>;
  listServers(): Promise<VpnServer[]>;
}
```

Implement only required methods for the first release; keep protocol configuration methods out of the public API initially. Map supplier errors to stable internal error codes. Treat HTTP 402/insufficient supplier balance as an operational failure with an admin alert, not as a customer payment failure after BitoCard has already collected funds.

Recommended NestJS modules/services, adjusted to current repository structure:

- `VpnCatalogModule`: BitoCard plan and availability reads.
- `VpnProvisioningModule`: order fulfillment orchestration and durable retries.
- `VpnresellersClient`: authenticated HTTP client, DTO validation, timeouts, safe logging.
- `SupplierReconciliationJob`: compare BitoCard fulfillment records against supplier account status/expiry.
- Admin endpoints/UI: connection health, balance check if authorized, failed jobs, account status, and retry/refund actions.

Use the existing queue/outbox implementation. Do not perform slow supplier calls inside the synchronous wallet debit transaction. Persist the order and outbox event atomically, then fulfill asynchronously.

## 8. Frontend and API behavior

Use the existing Next.js App Router, RTK Query, Tailwind, and Radix UI patterns.

Customer/reseller pages:

- Catalog card: VPN plan, term, price, device allowance, app platform badges, and renewal/expiry explanation.
- Product detail/checkout: confirm term and price before wallet debit.
- Order status states: `Processing`, `Ready`, or `Needs support`; do not expose supplier internals.
- Order details: username, expiry, app installation steps, password reset/help path, and a copy action with appropriate reveal controls.
- Reseller storefront displays only BitoCard-approved descriptions and reseller price/margin behavior.

Admin pages:

- Enable/disable VPNresellers catalog availability.
- Configure monthly plan price and permitted reseller markup rules.
- View supplier balance/status if API response and policy support it.
- Review failed provisioning and reconciliation discrepancies.
- Retry fulfillment only when safe; otherwise refund/cancel through existing controls.

The browser must never call VPNresellers directly. All supplier requests stay server-side.

## 9. Security and privacy requirements

- Keep supplier bearer token in the existing secrets manager or deployment secret store; use server-only environment configuration in local development.
- Never expose supplier credentials in frontend responses, logs, analytics, or error traces.
- Treat VPN username/password, WireGuard private key, and generated configs as sensitive secrets. Encrypt at rest or use the project's existing secrets vault; restrict access to the owning customer and authorized support roles.
- Redact request/response bodies for credential-bearing API calls.
- Validate API responses and impose request timeouts and bounded retries.
- Add admin audit events for credential reveal/reset, account suspension, deletion, and manual fulfillment actions.
- Follow BitoCard privacy, retention, refund, and supplier incident procedures.

## 10. Reliability and operations

- Use a transactional outbox or durable job to prevent lost fulfillment after payment.
- Ensure retries cannot provision multiple accounts for one BitoCard order. If VPNresellers does not offer idempotency keys, track local request state and reconcile before retrying an uncertain create call.
- Add a scheduled reconciliation for active, expired, suspended, and failed accounts.
- Alert admins on supplier auth errors, low/insufficient balance, repeated API failures, and account/expiry mismatches.
- Record request IDs and sanitized supplier response codes for support.
- Keep a manual recovery path: locate supplier account, attach it to the BitoCard order, retry delivery, or issue refund through existing order controls.

## 11. Implementation sequence

1. Inspect the repository instructions (`CLAUDE.md`, `AGENTS.md`, package scripts), existing catalog/order/wallet models, payment state transitions, queues, secrets handling, and admin patterns. Follow existing project conventions and avoid duplicating shared concepts.
2. Confirm VPNresellers account, API token, project setup, sandbox/test behavior, rate limits, funding requirement, support escalation, downstream reseller rights, and commercial terms.
3. Add configuration and a server-side VPNresellers API client with unit-level request/response validation and redaction.
4. Add supplier subscription persistence and migrations; add order-to-fulfillment uniqueness and transaction/outbox linkage.
5. Implement create customer/account, read status, set expiry, enable/disable, and delete operations needed for order lifecycle.
6. Implement asynchronous paid-order fulfillment, safe retries, and failure/refund handling.
7. Add BitoCard catalog plans and pricing configuration; seed only the monthly SKU until expiration/billing behavior is verified.
8. Add customer/reseller order delivery and admin failure/reconciliation tools.
9. Add monitoring, audit events, and scheduled reconciliation.
10. Run repository lint/typecheck/tests, apply migrations in a disposable environment, and complete the acceptance checks below before enabling the product in production.

## 12. Acceptance criteria

- A VPN plan can be listed and priced through the existing BitoCard catalog and reseller storefront.
- A paid order triggers one supplier account, never multiple accounts after duplicate events or job retries.
- The created supplier account is attached to the correct customer/project and has the expected expiry.
- An unpaid, cancelled, or failed-payment order never provisions an account.
- Successful fulfillment stores a supplier account reference and shows the buyer usable setup instructions without exposing supplier API details.
- Supplier API failure after payment leads to bounded retry and a visible actionable state; it does not debit the wallet again.
- A repeated fulfillment event is idempotent.
- An account can be disabled or deleted by authorized operations through audited controls.
- Credentials, bearer token, WireGuard private key, and configuration content are absent from application logs and public API responses.
- Reconciliation identifies expired accounts that remain billable/active and flags them for correction.
- Pricing configuration supports BitoCard's retail/reseller prices independently of supplier wholesale cost.
- Automated checks pass and the product remains disabled until supplier expiry/billing behavior and reseller-of-reseller rights are confirmed.

## 13. Questions to resolve with VPNresellers before production

1. Does `expire_at` automatically disable an account and stop active-account charges at the expected time?
2. Is supplier billing prorated daily, and what happens on account creation/deletion mid-day or mid-month?
3. What minimum account credit, prefunding, and low-balance alerts apply?
4. Are API calls idempotent or searchable by a BitoCard reference after a timeout on account creation?
5. What are API rate limits, uptime/support SLAs, and incident notification procedures?
6. Can BitoCard resell to its own downstream resellers and let them set permitted retail prices?
7. Are the brandless VPNclient apps available on the target mobile/desktop platforms in BitoCard's markets, and can login/setup links be included in delivery?
8. What privacy, data processing, retention, and account deletion terms apply to customer data?
9. Are WireGuard and VLESS configurations intended for direct customer delivery, and what additional security guidance applies to their private keys?

## 14. Coding agent instructions

Before editing, inspect the repository's own instructions and current implementation. Reuse the established BitoCard product, wallet, reseller pricing, order fulfillment, notification, queue, and audit patterns. Do not create a parallel checkout or wallet. Do not assume undocumented supplier behavior. If a required API operation or commercial rule is unclear, isolate it behind configuration/provider interfaces and document the unresolved question instead of guessing. Keep all credentials server-side and preserve backward compatibility for existing catalog products.
