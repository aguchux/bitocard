---
title: Sandbox and live
description: Build and test against the sandbox with simulated fulfilment and payments, then switch to a live key once your business is verified.
---

# Sandbox and live

Every reseller has a **sandbox**: the same API, the same address, with simulated money and fulfilment. Build your whole integration there, then change one thing, the key, to go live.

## What the sandbox simulates

| Area | In the sandbox |
| --- | --- |
| Orders | Never call a supplier. Complete at once with `SANDBOX-` codes, unless you ask otherwise with `simulate`. |
| Top-ups | No payment page is charged. Finish one with `POST /v1/wallet/top-ups/{id}/simulate`. |
| Reserved bank accounts | Opened without a BVN. Pay into one with `POST /v1/wallet/reserved-accounts/{id}/simulate-deposit`. |
| Payouts | No money moves. Settle one with `POST /v1/payouts/{id}/simulate`. |
| Customer checks | No identity provider. Decide one with `POST /v1/customers/{reference}/verification/simulate`. |
| Webhooks | Sandbox endpoints receive sandbox events only. |

The `…/simulate` endpoints work only in the sandbox: a live key gets `400` with `code: livemode_not_allowed`.

## Rehearsing order outcomes

Pass `simulate` when placing a sandbox order to rehearse what your system must handle:

```json
{ "quote_id": "…", "simulate": "pending" }
```

| `simulate` | Result |
| --- | --- |
| *(omitted)* or `completed` | Completes at once with `SANDBOX-` codes. |
| `pending` | Stays `processing`. Finish it later with `POST /v1/orders/{id}/simulate`. |
| `failed` | Fails; the wallet hold is released. |

## Going live

1. **Verify your business** in SHQ (an identity check of the owner). Live keys and live "Try it" are refused with `reseller_not_verified` until then.
2. **Fund your live wallet** with a top-up, or a transfer into your reserved bank account where offered.
3. **Create a live key** with only the scopes your system needs.
4. **Create live webhook endpoints.** Sandbox endpoints never receive live events.
5. Swap the key in your configuration. Nothing else changes.

## Things that differ in live

- Fulfilment is real and can be **slower**: an order may stay `processing` while the supplier confirms. Handle it as described in [Orders](/guides/orders).
- Some products need checks that the sandbox only imitates: the smartcard or meter number for pay-TV and bills is validated with the supplier, and `0000000000` is never recognised.
- Live quotes in taxable categories include tax that BitoCard collects as the seller of record.
