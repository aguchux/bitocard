---
title: Idempotency
description: Every POST needs an Idempotency-Key, so a retried request returns the original result instead of charging or ordering twice.
---

# Idempotency

Networks fail. When a request times out you cannot tell whether BitoCard received it, and retrying a payment or an order blindly could do it twice. **Idempotency keys** make retries safe.

Every `POST` must send an `Idempotency-Key` header: a unique value you generate for each new action, such as a UUID.

```bash
curl -X POST https://api.bitocard.com/v1/orders \
  -H "Authorization: Bearer $BITOCARD_API_KEY" \
  -H "Idempotency-Key: 0b6c1f0e-7a24-4c7e-9d3e-5f1a2b3c4d5e" \
  -H "Content-Type: application/json" \
  -d '{"quote_id": "…"}'
```

## How it works

- The first request with a key runs, and its response is stored for **24 hours**.
- A retry with the **same key and the same body** gets the stored response, with the header `Idempotent-Replayed: true`. Nothing runs twice.
- The same key with a **different** body is refused: `422`, `code: idempotency_key_reused`.
- A retry while the first request is still running gets `409`, `code: idempotency_in_progress`. Wait a moment and retry with the same key.
- A `POST` without the header gets `400`, `code: idempotency_key_required`.

Keys are 1 to 255 printable characters and belong to your API key: two of your systems cannot collide.

## Doing it right

```js
import { randomUUID } from "node:crypto";

// Generate the key once per action, and keep it for every retry of that action.
const key = randomUUID();

for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    const response = await fetch("https://api.bitocard.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.BITOCARD_API_KEY}`,
        "Idempotency-Key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ quote_id: quoteId }),
    });
    if (response.status < 500 && response.status !== 429) return await response.json();
  } catch {
    // Network error: retry with the same key.
  }
  await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
}
```

- **One key per action**, not per attempt. A new key means a new action.
- Store the key with your own record of the sale (for example on your order row) before sending, so a crash and restart can retry with it.
- `GET`, `PUT`, `PATCH` and `DELETE` are naturally safe to repeat and need no key.
