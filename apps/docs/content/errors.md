---
title: Errors
description: Every error has the same shape, with a stable code to branch on, a plain message and a request ID. Which errors to retry, and which never to.
---

# Errors

BitoCard uses standard HTTP status codes, every error has the same body, and its `type` always matches its status:

```json
{
  "error": {
    "type": "conflict_error",
    "code": "quote_expired",
    "message": "This quote has expired. Create a new one.",
    "param": "quote_id",
    "request_id": "req_8f2c1a7d4e6b"
  }
}
```

| Field | Meaning |
| --- | --- |
| `type` | The kind of error (below). |
| `code` | A stable, machine-readable code. **Branch on this**, never on the message. |
| `message` | Plain English, safe to show to your staff. Never contains internal details. |
| `param` | The request field the error is about. Only present when there is one. |
| `request_id` | Quote it when you contact support. Also sent as the `Request-Id` header. |

## Types

| `type` | Usual status | Meaning |
| --- | --- | --- |
| `invalid_request_error` | 400, 402, 422 | The request cannot be done as asked: a bad or missing field, too little in the wallet. |
| `idempotency_error` | 400, 409, 422 | A problem with the `Idempotency-Key`: missing, reused for another request, or still in progress. |
| `authentication_error` | 401 | No valid API key or session. |
| `permission_error` | 403 | Valid key, but not allowed: a missing scope, a plan restriction, an unverified business for live, or a dashboard-only endpoint. |
| `not_found_error` | 404 | Nothing with that ID belongs to your account (and mode). |
| `conflict_error` | 409 | The current state does not allow it: an expired or used quote, an order refunded twice, live-only actions in the sandbox. |
| `rate_limit_error` | 429 | Too many requests. Wait for `Retry-After` seconds. |
| `api_error` | 500, 502, 503 | Something failed on BitoCard's side or a partner's. |

## Common codes

| `code` | When | What to do |
| --- | --- | --- |
| `parameter_invalid` | A field is missing, malformed or not allowed (`param` names it). | Fix the request. |
| `insufficient_funds` | The wallet cannot cover the wholesale cost. | Top up, then retry with a **new** quote if the old one expired. |
| `quote_expired` | The quote is older than 10 minutes. | Create a new quote. |
| `quote_used` | The quote already placed an order. | Fetch that order instead of ordering again. |
| `reseller_not_verified` | Live mode before your business is verified. | Verify in SHQ, or use the sandbox. |
| `plan_restricted` | Your plan switches this feature off. | Change plan in SHQ. |
| `livemode_not_allowed` | A sandbox-only call (`…/simulate`) with a live key. | Use a test key. |
| `idempotency_key_reused` | The same key with a different request. | Use a new key for a new request. |
| `idempotency_in_progress` | The first request with this key is still running. | Retry shortly with the **same** key. |

Each endpoint in the [reference](/reference) lists the statuses it can return.

## Retrying safely

| Situation | Retry? |
| --- | --- |
| Network error or timeout (no response) | **Yes, with the same `Idempotency-Key`.** You get the original result, never a second order. |
| `429` | Yes, after `Retry-After` seconds. |
| `500`, `502`, `503` | Yes, with the same key, backing off (1 s, 2 s, 4 s…). |
| `400`, `401`, `403`, `404`, `409`, `422` | **No.** The same request will fail the same way; fix it first. |

An order that comes back `processing` is not an error and must not be retried: see [Orders](/guides/orders).
