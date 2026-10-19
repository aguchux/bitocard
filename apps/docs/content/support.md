---
title: Support tickets
description: Answer your customers' questions, pass them to BitoCard, ask BitoCard your own, and work with your support assistant's drafts.
---

# Support tickets

A **support ticket** is a question: a customer's to your store, or yours to BitoCard. Problems with an order's money are **disputes** instead (see [Orders](/guides/orders)).

Every ticket has a reference people quote (`T-000123`) and two things that tell you where it stands:

- **`queue`**: who answers. `reseller` (you, for your customers) or `bitocard` (your own questions, and customers' tickets you passed on).
- **`status`**: whose turn it is. `open` (whoever answers), `pending` (the requester) or `resolved`. A requester's reply reopens a resolved ticket.

You need the `support:read` scope to read tickets and `support:write` to open and answer them.

## Your customers' tickets

Customers on your hosted store open tickets from their account. You can also log one for a customer on your own systems:

```bash
curl https://api.bitocard.com/v1/support/tickets \
  -H "Authorization: Bearer $BITOCARD_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{ "requester": "customer", "customer_reference": "cust_42", "category": "product", "subject": "Which gift card works in Ghana?", "message": "My customer asks which cards work in Ghana." }'
```

Then:

1. **Answer** with `POST /v1/support/tickets/{id}/messages` (`visibility: "all"`): the ticket becomes `pending`, waiting for the customer. A **staff note** (`visibility: "staff"`) is seen only by your team and BitoCard and changes nothing.
2. **Resolve** it with `POST /v1/support/tickets/{id}/resolve`, optionally with a last message (`note`).
3. Or **pass it to BitoCard** with `POST /v1/support/tickets/{id}/escalate` and a note on what you found. BitoCard answers the customer from there and may send it back to you.

Set the priority or assign it to a team member with `PATCH /v1/support/tickets/{id}`.

## Your own questions to BitoCard

Open a ticket with `requester: "reseller"`. BitoCard answers; you are told when it does. Reply on the ticket to continue, and resolve it once you have your answer.

## Your support assistant's drafts

If your store's assistant replies to tickets with **drafts**, a ticket's messages include `"draft": true` replies. Customers never see them. Send one as it is (it goes out as the assistant's words) or with your changes (`body`, then it is yours), or discard it:

```bash
curl -X POST https://api.bitocard.com/v1/support/tickets/$TICKET/drafts/$DRAFT/send \
  -H "Authorization: Bearer $BITOCARD_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{ "body": "Your token is on your order page: press Reveal." }'
```

`POST /v1/support/tickets/{id}/drafts/{draft}/discard` removes it. An assistant that replies by itself writes as `author: "bot"`, and stays out of a ticket once a person has written on it.

## Webhook events

- `support_ticket.created`: a ticket was opened.
- `support_ticket.updated`: its `status` or `queue` changed (answered, reopened, passed to BitoCard, sent back, resolved).
- `support_ticket.message_received`: the customer or BitoCard wrote.

Events carry the ticket without its messages: read them with `GET /v1/support/tickets/{id}`. See [Webhooks](/guides/webhooks) for signatures and retries.
