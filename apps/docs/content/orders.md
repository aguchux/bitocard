---
title: Orders
description: How quotes, wallet holds and fulfilment fit together, why a processing order is not a failed one, and how to handle every outcome safely.
---

# Orders

Every sale follows the same path: **quote → order → outcome**.

## 1. A quote locks the price

`POST /v1/quotes` locks, for **10 minutes**:

- the price your customer pays (`price`), and your wholesale cost (`wholesale`), in your wallet currency;
- the exchange rate, if the product is priced in another currency;
- any tax BitoCard collects as seller of record;
- the recipient check: a valid mobile number for airtime and data, or the smartcard or meter number for pay-TV and bills (the quote returns the `account_name` so your customer can confirm it).

Show your customer the quote before they pay. An expired quote cannot be used: create a new one.

## 2. The order holds your wallet

`POST /v1/orders` with the `quote_id`:

1. Holds the wholesale cost plus tax (`charged`) from your wallet. With too little available, the order is refused with `402` and `code: insufficient_funds`, and nothing happens.
2. Sends the order for fulfilment.
3. Returns the order with its status.

The hold is captured only when fulfilment is confirmed, and released if the order fails.

## 3. The outcome

| Status | Meaning | What to do |
| --- | --- | --- |
| `completed` | Delivered. | Give your customer `deliveries` (code, PIN, token or confirmation). |
| `processing` | Sent, not yet confirmed. | **Wait.** Do not place the order again. |
| `failed` | Not delivered; hold released. | Tell your customer; optionally quote again. `failure_reason` says why. |
| `refunded` | A completed order BitoCard refunded to your wallet. | Reverse it in your system. |

### Processing is not failed

A timeout or an unclear answer from a supplier leaves the order `processing`. BitoCard keeps checking with the same supplier and only fails it once the supplier confirms. **Never place a second order for the same sale while one is processing**: your customer could receive, and you could pay for, both.

To learn the outcome:

- listen for the `order.completed` and `order.failed` [webhooks](/guides/webhooks), or
- fetch the order (`GET /v1/orders/{id}`) every few seconds for a minute, then less often.

Orders that stay unclear are reviewed by BitoCard's operations team.

## Secrets in deliveries

Gift card codes, PINs, licence keys and electricity tokens are encrypted at rest and returned **only** by `POST /v1/orders` and `GET /v1/orders/{id}` for your account. They never appear in order lists, webhooks or receipts. Fetch the single order when you need them, and treat them like cash.

## Your reference, your customer

Pass `customer_reference` on the quote (your own ID for the customer). It is copied to the order, searchable with `GET /v1/orders?customer_reference=…`, and used for [customer identity checks](/reference/customers). Customers never need BitoCard accounts.

## Receipts

`GET /v1/orders/{id}/receipt` returns the receipt for a completed order: numbered, naming BitoCard's regional company as the seller of record, and your store as `sold_through`.
