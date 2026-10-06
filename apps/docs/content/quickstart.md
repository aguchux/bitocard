---
title: Quickstart
description: Make your first sandbox sale with the BitoCard API in five calls: check your key, find a product, lock a price, place the order and read what was delivered.
---

# Quickstart

This guide takes you from a new sandbox key to a completed order. Everything happens in the **sandbox**: nothing touches real money or real suppliers, and orders complete with `SANDBOX-` codes.

## Before you start

1. [Sign up as a reseller](https://shq.bitocard.com/signup) and open **SHQ** (Seller Head Quarters).
2. Go to **Developers → API keys** and create a **test** key. It starts with `bc_test_` and is shown **once**: copy it now.
3. Keep it out of your code. Put it in an environment variable:

```bash
export BITOCARD_API_KEY="bc_test_…"
```

Every request in this guide goes to `https://api.bitocard.com`. Sandbox and live use the same address; the key decides which one you reach.

## 1. Check your key

`GET /v1/account` is the simplest call: it tells you which reseller account and mode your key belongs to.

```bash
curl https://api.bitocard.com/v1/account \
  -H "Authorization: Bearer $BITOCARD_API_KEY"
```

```json
{
  "object": "account",
  "reseller": { "object": "reseller", "id": "8b1f…", "name": "Ada Digital", "country": "NG", "status": "pending" },
  "plan": { "object": "plan", "code": "standard", "name": "Standard", "…": "…" },
  "authenticated_as": { "type": "api_key", "api_key_id": "3c9e…", "mode": "test", "scopes": ["catalogue:read", "…"] }
}
```

## 2. Fund your sandbox wallet

Orders are paid from your pre-funded wallet. In the sandbox, start a top-up and simulate the payment:

```bash
curl -X POST https://api.bitocard.com/v1/wallet/top-ups \
  -H "Authorization: Bearer $BITOCARD_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"amount": 5000000}'
```

Amounts are always **integer minor units** of your wallet currency: `5000000` is ₦50,000.00. Then, with the top-up's `id`:

```bash
curl -X POST https://api.bitocard.com/v1/wallet/top-ups/TOP_UP_ID/simulate \
  -H "Authorization: Bearer $BITOCARD_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"outcome": "succeeded"}'
```

`GET /v1/wallet` now shows the funds as `available`.

## 3. Find a product

```bash
curl "https://api.bitocard.com/v1/catalogue/products?category=airtime&country=NG" \
  -H "Authorization: Bearer $BITOCARD_API_KEY"
```

Each product carries its `pricing`: the face values you can sell and your price for each, in your wallet currency. Pick a product `id`.

## 4. Lock the price with a quote

A quote locks the price, your wholesale cost and the recipient check for **10 minutes**. Airtime and data need a mobile number for the product's country:

```bash
curl -X POST https://api.bitocard.com/v1/quotes \
  -H "Authorization: Bearer $BITOCARD_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "product_id": "PRODUCT_ID",
    "face_value": 100000,
    "recipient": { "phone": "+2348031234567" },
    "customer_reference": "cust_1042"
  }'
```

Show your customer the quote's `price`. If they agree within 10 minutes, place the order.

## 5. Place the order

```bash
curl -X POST https://api.bitocard.com/v1/orders \
  -H "Authorization: Bearer $BITOCARD_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"quote_id": "QUOTE_ID"}'
```

BitoCard holds your wholesale cost from the wallet and fulfils the order. The response is the order:

- `completed`: delivered. `deliveries` holds what your customer receives (a code and PIN for a gift card, a confirmation for airtime).
- `processing`: the supplier has not confirmed yet. **This is not a failure.** Wait for the `order.completed` or `order.failed` webhook, or fetch the order again.
- `failed`: nothing was delivered and your wallet hold was released.

In the sandbox you can rehearse each outcome with `"simulate": "pending"` or `"simulate": "failed"` on `POST /v1/orders`.

## 6. Read what was delivered

Codes, PINs and tokens are secrets: they are **only** on the single order, never in lists or webhooks.

```bash
curl https://api.bitocard.com/v1/orders/ORDER_ID \
  -H "Authorization: Bearer $BITOCARD_API_KEY"
```

## Next steps

- [Handle orders properly](/guides/orders): processing orders, retries and refunds.
- [Receive webhooks](/guides/webhooks) instead of polling.
- [Errors](/guides/errors) and [idempotency](/guides/idempotency): make every request safe to retry.
- [Go live](/guides/sandbox-and-live) once your business is verified.
- Prefer clicking to typing? Every endpoint in the [API reference](/reference) has **Try it**: sign in and call it against your sandbox.
