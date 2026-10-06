---
title: Webhooks
description: Receive signed events from BitoCard when orders, top-ups and payouts change, and catch up on anything you missed.
---

# Webhooks

BitoCard sends an HTTPS `POST` to your endpoint when something happens to your orders, wallet top-ups or payouts. Use webhooks to update your own system without polling.

Webhooks are a fast signal, not the record. The [events API](#catch-up-with-get-v1events) (`GET /v1/events`) and the objects themselves (`GET /v1/orders/{id}`) are the source of truth.

- Every event type, with its full payload, is in the [event reference](/reference/webhook-events).
- Sandbox endpoints (created with a `bc_test_…` key, or in test mode in the dashboard) receive sandbox events only. Live endpoints receive live events only.
- Webhooks never carry secrets: no gift card codes, PINs or electricity tokens. When `order.completed` arrives, fetch the order to get them.

## Step by step

### 1. Create an endpoint

Your endpoint must use `https://` and be reachable from the public internet. Addresses on private or internal networks are refused, both when you save the endpoint and on every delivery.

```bash
curl https://api.bitocard.com/v1/webhook-endpoints \
  -H "Authorization: Bearer bc_test_…" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/webhooks/bitocard", "events": ["order.completed", "order.failed"]}'
```

The response includes `secret` (`whsec_…`). **It is shown only once.** Store it like a password, for example in an environment variable. Use `"events": ["*"]` (the default) to receive every event type, including types added later.

You can have up to 16 endpoints in each mode.

### 2. Verify the signature

Every delivery has a `BitoCard-Signature` header:

```
BitoCard-Signature: t=1790000000,v1=176911993deece29e405d1b9d8e596d8ecc3de54476ef03eba4e466088f27de7
```

- `t` is when BitoCard signed the delivery, in Unix seconds.
- `v1` is the hex HMAC-SHA256 of `<t>.<raw request body>`, keyed with your whole endpoint secret (including `whsec_`).
- During a [secret rotation](#rotate-the-secret) there are two `v1` values, one for each secret. Accept the delivery if either matches.

To verify a delivery:

1. Read the **raw** request body, exactly as received. Parsing and re-serialising the JSON changes it and breaks the signature.
2. Compute the HMAC of `t + "." + body` and compare it with each `v1`, using a constant-time comparison.
3. Reject the delivery if `t` is more than 300 seconds (5 minutes) from your clock. This stops someone replaying an old delivery.

Respond `400` to deliveries that fail verification.

### 3. Acknowledge fast, process later

Reply with any `2xx` status within 10 seconds. Do the real work (updating your database, emailing your customer) after replying, for example from a job queue. A slow reply counts as a failure and is retried.

Redirects (`3xx`) are not followed and count as failures.

### 4. Ignore duplicates

BitoCard delivers each event **at least once**, so you may receive the same event more than once (for example, if your reply was lost). Every event has a unique `id`. Record the IDs you have handled and skip any you have seen.

### 5. Handle events out of order

Deliveries are not guaranteed to arrive in order. An `order.refunded` could arrive before `order.completed` if the first delivery was retried. Each object carries `updated_at` (or `completed_at`); keep the newest version and ignore older ones. When in doubt, fetch the object from the API.

### 6. Catch up with GET /v1/events

If your endpoint was down, catch up from the events API. Store the `id` of the last event you processed, then:

```bash
curl "https://api.bitocard.com/v1/events?since=7d6f1b8e-2c4a-4f57-9a3e-1b2c3d4e5f60" \
  -H "Authorization: Bearer bc_live_…"
```

Events come back oldest first, up to 100 at a time. Keep calling with the last `id` while `has_more` is `true`. You can also pass a time, such as `since=2026-10-06T09:00:00Z`, and filter with `type=order.completed`.

Events are kept for 30 days and appear in the list a few seconds after they happen. API keys need the `events:read` scope; managing endpoints needs `webhooks:manage`.

## Code

Each example reads the raw body, verifies the signature and checks the timestamp.

### Node.js

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

/** True if `header` (BitoCard-Signature) is a valid signature of `rawBody` (a string or Buffer) made within 5 minutes. */
export function verifyBitoCardSignature(rawBody, header, secret, now = Math.floor(Date.now() / 1000)) {
  const parts = String(header ?? '').split(',').map(part => part.trim().split('='));
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > 300) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex'));
  return parts.some(([key, value]) => key === 'v1' && value?.length === expected.length && timingSafeEqual(Buffer.from(value), expected));
}
```

With Express, take the raw body for this route only:

```js
import express from 'express';
import { verifyBitoCardSignature } from './verify-bitocard.js';

const app = express();

app.post('/webhooks/bitocard', express.raw({ type: 'application/json' }), (req, res) => {
  const body = req.body.toString('utf8');
  if (!verifyBitoCardSignature(body, req.get('BitoCard-Signature'), process.env.BITOCARD_WEBHOOK_SECRET)) {
    return res.sendStatus(400);
  }
  const event = JSON.parse(body);
  res.sendStatus(200); // Acknowledge first...
  queue.add('bitocard-event', event); // ...then process (skip event.id values you have already handled).
});
```

### Python

```python
import hashlib
import hmac
import time


def verify_bitocard_signature(raw_body: bytes, header: str, secret: str, now: int | None = None) -> bool:
    """True if header (BitoCard-Signature) is a valid signature of raw_body made within 5 minutes."""
    now = int(time.time()) if now is None else now
    parts = [part.strip().split("=", 1) for part in (header or "").split(",")]
    timestamp = next((value for key, *value in parts if key == "t" and value), [None])[0] if parts else None
    if timestamp is None or not timestamp.isdigit() or abs(now - int(timestamp)) > 300:
        return False
    signed = timestamp.encode() + b"." + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return any(key == "v1" and value and hmac.compare_digest(value[0], expected) for key, *value in parts)
```

With Flask:

```python
from flask import Flask, abort, request

app = Flask(__name__)


@app.post("/webhooks/bitocard")
def bitocard_webhook():
    if not verify_bitocard_signature(request.get_data(), request.headers.get("BitoCard-Signature", ""), WEBHOOK_SECRET):
        abort(400)
    event = request.get_json()
    enqueue(event)  # Process later; skip event["id"] values you have already handled.
    return "", 200
```

### PHP

```php
<?php

/** True if $header (BitoCard-Signature) is a valid signature of $rawBody made within 5 minutes. */
function verifyBitoCardSignature(string $rawBody, string $header, string $secret, ?int $now = null): bool
{
    $now ??= time();
    $timestamp = null;
    $signatures = [];
    foreach (explode(',', $header) as $part) {
        [$key, $value] = array_pad(explode('=', trim($part), 2), 2, '');
        if ($key === 't') {
            $timestamp = $value;
        } elseif ($key === 'v1') {
            $signatures[] = $value;
        }
    }
    if ($timestamp === null || !ctype_digit($timestamp) || abs($now - (int) $timestamp) > 300) {
        return false;
    }
    $expected = hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);
    foreach ($signatures as $signature) {
        if (hash_equals($expected, $signature)) {
            return true;
        }
    }
    return false;
}
```

In plain PHP, read the body with `file_get_contents('php://input')` and the header from `$_SERVER['HTTP_BITOCARD_SIGNATURE']`.

### Laravel

Add the route outside the `web` middleware group (or exclude it from CSRF protection), and verify in the controller:

```php
<?php

namespace App\Http\Controllers;

use App\Jobs\HandleBitoCardEvent;
use Illuminate\Http\Request;

class BitoCardWebhookController
{
    public function __invoke(Request $request)
    {
        $valid = verifyBitoCardSignature(
            $request->getContent(),
            (string) $request->header('BitoCard-Signature'),
            config('services.bitocard.webhook_secret'),
        );
        abort_unless($valid, 400);

        HandleBitoCardEvent::dispatch($request->json()->all()); // Process later; skip IDs already handled.

        return response()->noContent();
    }
}
```

```php
// routes/api.php
Route::post('/webhooks/bitocard', \App\Http\Controllers\BitoCardWebhookController::class);
```

## Signature test vector

Check your verification code against this example. With your clock set to the timestamp below, it must accept the signature; changing any byte of the body must make it fail.

| | |
|---|---|
| Secret | `whsec_test_vector_do_not_use_0123456789` |
| Timestamp (`t`) | `1790000000` |
| Body | `{"id":"7d6f1b8e-2c4a-4f57-9a3e-1b2c3d4e5f60","object":"event","type":"ping"}` |
| Signed string | `1790000000.{"id":"7d6f1b8e-2c4a-4f57-9a3e-1b2c3d4e5f60","object":"event","type":"ping"}` |
| Expected `v1` | `176911993deece29e405d1b9d8e596d8ecc3de54476ef03eba4e466088f27de7` |
| Header | `t=1790000000,v1=176911993deece29e405d1b9d8e596d8ecc3de54476ef03eba4e466088f27de7` |

The body has no trailing newline.

## Delivery details

### Request

`POST` with these headers:

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `User-Agent` | `BitoCard-Webhooks/1.0 (+https://docs.bitocard.com/webhooks)` |
| `BitoCard-Signature` | `t=…,v1=…` (see above) |
| `BitoCard-Event-Id` | The event ID (also in the body) |
| `BitoCard-Event-Type` | The event type, for example `order.completed` |
| `BitoCard-Delivery-Attempt` | `1` for the first attempt, then `2`, `3`… |

The body is the event:

```json
{
  "id": "1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a",
  "object": "event",
  "type": "order.completed",
  "api_version": "2026-10-01",
  "mode": "live",
  "created_at": "2026-10-06T09:15:04.870Z",
  "data": { "object": { "object": "order", "id": "5f0c6a8e-3b1d-4c9a-9e2f-7a1b2c3d4e5f", "status": "completed", "…": "…" } }
}
```

`data.object` is the object as the API returns it (without secrets). Every retry and resend sends exactly the same body, with a fresh signature.

### Retries

A delivery fails if your endpoint does not reply with a `2xx` within 10 seconds, redirects, or cannot be reached. BitoCard then retries after about:

1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours, then every 12 hours,

for up to 3 days after the event. Each wait varies by up to 10% so retries do not arrive together.

### Limits and automatic disabling

- BitoCard sends at most 5 requests to one endpoint at a time.
- If deliveries to an endpoint keep failing for 3 days, the endpoint is disabled and its pending deliveries stop. Your account owner gets an email, and the dashboard shows the endpoint as disabled (`disabled_reason: failing`).
- Fix the endpoint, then enable it again (`PATCH /v1/webhook-endpoints/{id}` with `{"status": "enabled"}`). Catch up on missed events with `GET /v1/events`, or resend deliveries from the log.

### Delivery log, resend and test events

- `GET /v1/webhook-endpoints/{id}/deliveries` lists deliveries, newest first, with their status. Each delivery (`GET …/deliveries/{delivery_id}`) shows every attempt: response status, the start of your response body, any error and the time taken.
- `POST …/deliveries/{delivery_id}/resend` sends the same event again now.
- `POST /v1/webhook-endpoints/{id}/test` sends a `ping` event to that endpoint only. Test events are not retried and are not listed by `GET /v1/events`.

In the sandbox, sandbox orders, top-ups and payouts (including the `simulate` endpoints) send real events to your sandbox endpoints.

### Rotate the secret

`POST /v1/webhook-endpoints/{id}/rotate-secret` returns a new secret (once). The old secret keeps signing alongside the new one for 24 hours by default; set `expire_previous_in_hours` from `0` (stop now) to `168`. Deploy the new secret within that window.

## Troubleshooting

| Problem | Fix |
|---|---|
| Signatures never match | Verify the raw body exactly as received, not re-serialised JSON. Use the whole secret, including `whsec_`. Check against the [test vector](#signature-test-vector). Make sure you are using the secret for this endpoint and mode. |
| Signatures fail intermittently | Your server clock is probably wrong. Keep it synchronised (NTP); timestamps more than 5 minutes off are rejected. |
| Deliveries time out | Reply `2xx` first and process afterwards. Replies after 10 seconds count as failures. |
| `http_301` / `http_302` in the log | Redirects are not followed. Use the final URL (often a missing or extra trailing slash, or `http` to `https`). |
| `blocked_destination` in the log | The host name resolves to a private or internal address. Use a public address. |
| `connection_error` | The server refused or dropped the connection, or its TLS certificate is invalid. Check the certificate chain and firewall. |
| Duplicate processing | Store handled event IDs and skip repeats. Deliveries are at least once. |
| Endpoint disabled | Fix it, enable it again, then catch up with `GET /v1/events`. |
| No events in the sandbox | Sandbox endpoints receive only sandbox events. Create the endpoint with a `bc_test_…` key or in test mode. |

## Versioning

Each event has an `api_version` (currently `2026-10-01`).

- **Not breaking:** new event types, and new fields on existing payloads. Ignore fields you do not recognise, and subscribe to specific types if you do not want new ones.
- **Breaking:** removing or renaming a field, or changing its type or meaning. That needs a new `api_version`, announced in the changelog with time to migrate.

## Changelog

- **2026-10-07:** Added `customer_verification.approved` and `customer_verification.declined` (new event types; same payload version).
- **2026-10-01:** First version: `order.completed`, `order.failed`, `order.refunded`, `top_up.succeeded`, `top_up.failed`, `payout.paid`, `payout.failed`, and the `ping` test event.
