---
title: Authentication
description: Authenticate with secret API keys sent as Bearer tokens. Test keys reach the sandbox, live keys reach real money; scopes limit what a key can do.
---

# Authentication

Your systems authenticate with **API keys**, sent as a Bearer token on every request:

```http
GET /v1/account HTTP/1.1
Host: api.bitocard.com
Authorization: Bearer bc_live_…
```

There is one address for everything, `https://api.bitocard.com`. **The key decides the mode**:

| Key | Mode | What it touches |
| --- | --- | --- |
| `bc_test_…` | Sandbox | Simulated fulfilment, sandbox wallet, sandbox webhooks. Never real suppliers or money. |
| `bc_live_…` | Live | Real orders, your real wallet, real payouts. |

Test and live data never mix: a test key cannot see live orders, and a live key cannot see sandbox ones.

## Creating keys

Keys are created in **SHQ → Developers → API keys** by the account owner, an admin or a developer. You choose:

- **Mode:** test, or live once your business is verified.
- **Scopes:** what the key may do. By default a key has every scope; give each system only what it needs.

The secret is shown **once**. BitoCard keeps only a hash of it, so it cannot be shown again: if you lose it, roll the key.

## Scopes

| Scope | Allows |
| --- | --- |
| `catalogue:read` | Products, prices and your markups |
| `quotes:write` | Creating quotes |
| `orders:read` | Reading orders and receipts |
| `orders:write` | Placing orders |
| `wallet:read` | Balances, transactions, top-ups, fees |
| `wallet:write` | Starting top-ups and payouts |
| `webhooks:manage` | Webhook endpoints, deliveries and test events |
| `events:read` | The events API |
| `stores:manage` | Your hosted store and its listings |
| `customers:verify` | Customer identity checks |
| `disputes:read` | Read disputes and their messages |
| `disputes:write` | Open disputes, reply, escalate to BitoCard and resolve customer disputes |

Each endpoint in the [API reference](/reference) shows the scope it needs. A key without it gets `403` with `code: not_permitted`; a scope switched off by your plan gets `code: plan_restricted`.

## Dashboard-only endpoints

Some endpoints exist for SHQ itself and accept only a signed-in dashboard session, never a key: signing in, managing API keys, your team, notifications and your own integrations. They are documented under **Dashboard (SHQ)** in the reference so you know what SHQ does, but your systems cannot call them. A key that tries gets `403`.

## Keeping keys safe

- Keep live keys on your server only. Never put a key in a mobile app, a browser or a public repository.
- Read keys from an environment variable or a secrets manager, never from source code.
- **Roll** a key (SHQ, or `POST /v1/api-keys/{id}/roll` from the dashboard) to replace it without downtime: the old key keeps working for an overlap you choose, up to 72 hours.
- **Revoke** a key at once if it may have leaked.
- Suspended reseller accounts cannot use any key.

## The "Try it" token in these docs

The **Try it** panels in this documentation do not use your API keys. When you sign in with your SHQ account, the docs ask BitoCard for a short-lived token (`bc_docs_…`):

- valid for 15 minutes and only while your SHQ session lasts; signing out ends it at once;
- for one reseller account and one mode, sandbox or live;
- read-only on request, and always read-only for staff who cannot create API keys;
- kept in your browser's memory only, never stored, and never sent to the docs website (requests go straight from your browser to the API).

See [Try it](/guides/try-it) for how live mode is protected.
