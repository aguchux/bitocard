---
title: Pagination
description: Lists return pages of up to 100 items, newest first; pass the last ID as starting_after to get the next page.
---

# Pagination

Endpoints that return lists (orders, wallet transactions, top-ups, payouts, webhook deliveries, events) share one shape:

```json
{
  "object": "list",
  "data": [ { "id": "c3d4…", "…": "…" }, { "id": "a1b2…", "…": "…" } ],
  "has_more": true
}
```

| Parameter | Meaning |
| --- | --- |
| `limit` | Items per page, 1 to 100. Most lists default to 25. |
| `starting_after` | The ID of the last item you already have; the page starts after it. |

Lists are newest first, except `GET /v1/events`, which is oldest first so you can replay in order.

## Getting every page

```python
import os
import requests

def all_orders():
    params = {"limit": 100}
    while True:
        page = requests.get(
            "https://api.bitocard.com/v1/orders",
            headers={"Authorization": f"Bearer {os.environ['BITOCARD_API_KEY']}"},
            params=params,
            timeout=30,
        ).json()
        yield from page["data"]
        if not page["has_more"]:
            return
        params["starting_after"] = page["data"][-1]["id"]
```

The catalogue is the one exception: some products cannot be priced for you and are left out of a page, so use the page's `next_cursor` (not the last item's ID) as `starting_after`.

## Filters

Most lists take filters as query parameters, for example `GET /v1/orders?status=processing&customer_reference=cust_1042`. Keep the same filters on every page. Each endpoint's filters are in the [reference](/reference).
