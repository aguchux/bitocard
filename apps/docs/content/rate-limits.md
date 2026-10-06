---
title: Rate limits
description: Each API key or session can make 600 requests a minute. Every response says how many remain; a 429 says how long to wait.
---

# Rate limits

Each API key (and each dashboard session) can make **600 requests a minute**. Limits are per caller, so one of your systems cannot use up another's.

Every response carries the current state:

| Header | Meaning |
| --- | --- |
| `RateLimit-Limit` | Requests allowed in the current minute. |
| `RateLimit-Remaining` | Requests left in it. |
| `RateLimit-Reset` | Seconds until the minute resets. |

Past the limit you get `429` with `type: rate_limit_error` and a `Retry-After` header in seconds. Wait that long, then retry (with the same `Idempotency-Key` for a `POST`).

## Staying well inside the limit

- **Use webhooks instead of polling** for order, top-up and payout outcomes.
- **Cache the catalogue.** Products and prices change rarely within a few minutes; refresh every few minutes, not per customer visit.
- **Page with `limit=100`** when reading long lists.
- **Spread background jobs** rather than starting them all on the minute.

If your volume needs more, contact BitoCard with your expected request rate.
