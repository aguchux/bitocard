# Udozo Connect: collection centres, shipping and tracking

Status: **planned** (9 November 2026, the owner's request). Nothing is built yet. Open questions are at the end; the
owner's answers go into this file before the work starts.

## What it is

Udozo Connect is a network of **collection centres** across each market that Udozo registers and approves. Sellers
send items to a centre, the centre receives them, and the buyer collects them there. Buyers never give a home address:
a buyer who wants an item shipped chooses an approved centre.

- **Sellers**, when they list, switch on **shipping** and tick the **states** they ship to and the **centres** they can
  send to. Buyers who want it shipped then see which centres they can choose and what shipping costs.
- **Every Connect trade is paid with Udozo SurePay** (today's Safe pay, renamed below). Udozo holds the money until the
  buyer collects the item, so neither side pays the other directly.
- **Tracking:** buyer and seller follow each step, from paid to sent, received at the centre, ready to collect and
  collected.

## What exists today

Safe pay already does most of the money side. Each listing below gives the file (or schema model) first, then what it
has.

- **Listings** (`ClassifiedListing`): `delivery` (`none | state | nationwide`), `pickup` (a meet-up with a release
  code), and `delivery_fee_state_minor` and `delivery_fee_nationwide_minor`, which the seller sets in Post an ad's
  Location and delivery step.
- **Orders** (`ClassifiedOrder`, `SafePayService` in `apps/udozo-api/src/classifieds/safe-pay.service.ts`):
  - `fulfilment` is `meet_up | delivery`;
  - a delivery stores `delivery_state_id`, the encrypted address, `delivery_fee_minor`, the courier and tracking, and
    the dispatch photos (at least two);
  - shipment events (`classified_shipment_events`, `reported_by` seller, courier or Udozo) give `in_transit`,
    `out_for_delivery`, `delivered`, `failed_attempt` and `returned`;
  - deadlines are `handover_by` and `confirm_by` (`transit_days`, `confirm_days`); the `classifieds` job releases or
    refunds when they pass.
- **Release codes:** a meet-up's buyer holds a 6-digit code, encrypted and checked in constant time with 5 tries, and
  the seller enters it to be paid.
- **Couriers:** an admin list of names and tracking-link patterns per market. `CourierAdapter` exists only in a plan.
- **Areas** (`classified_areas`): states and areas with centre points, so a centre can sit in an area.
- **Help menu:** "Pickup centres" is listed and marked Soon (`apps/udozo/lib/help.ts`).

Connect adds a third way to hand over an item, **at a centre**, to the meet-up and the delivery Safe pay has today.

## Design

### 1. Centres (`connect_centres`)

- **What a centre records:** country, state, area, name, street address, landmark, opening hours, phone, map position
  and photos.
- **Status:** `draft`, `active`, `paused` (taking nothing new while it finishes what it holds) or `closed`.
- **Holding limits:** the most items it can hold and how many days it keeps an item (default 7).
- **Who runs it:** Udozo itself or a partner (see the open questions).
- **Admin:** Udozo's admin gets Connect > **Centres** to add, approve, pause and close centres, audited.
- **Public:** `GET /v1/connect/centres?country=&state=` lists the active centres. udozo.com's **Collection centres**
  page replaces the help menu's "Pickup centres (Soon)" and shows each centre with its map and hours.

### 2. Centre staff

- **Who they are:** people at a centre who receive items and hand them over. They work only for their own centres.
- **Where they work:** a new admin role, `connect_centre`, signs in at admin.udozo.com and sees only the centres it is
  assigned to.
- **Screens:** built for phones, three of them: **Receive** (check an item in), **Hand over** (release an item to its
  buyer), and **At this centre** (what is held, what is due and what is overdue).

### 3. Listings: shipping through Connect

- **Post an ad, Location and delivery step:**
  - a new **Ship through Udozo Connect** switch;
  - the **states** the seller ships to, with **All states** as one tick;
  - the **centres** in those states, with every centre in a ticked state chosen unless the seller unticks some;
  - the shipping charge (see the open questions).
- **Stored:** `classified_listings.connect` (on or off), `classified_listing_connect_states` and
  `classified_listing_connect_centres`. The API checks that each centre is active and sits in a state the seller ticked.
- **Shown to buyers:** the listing page shows "Ship to a Udozo Connect centre" with the states it reaches, and the
  structured data marks the offer as shipped.

### 4. Buying through Connect

- **Choosing a centre:** Buy with SurePay gets a third choice, **Collect at a Udozo Connect centre**. The buyer picks a
  state, then one of that listing's centres there (nearest first, from the buyer's area), and sees the shipping charge
  and the total before paying.
- **On the order:** `fulfilment: 'connect'`, `connect_centre_id`, and the shipping charge in `delivery_fee_minor`. No
  address is kept.
- **Only through SurePay:** an order with `connect` cannot be paid any other way, and the API refuses one without a
  centre (`centre_required`) or with a centre the listing does not ship to (`centre_unavailable`).

### 5. The trade, step by step

| Step | Who | What happens |
|---|---|---|
| Paid | buyer | SurePay holds the money; the seller has `handover_days` to send the item |
| Sent | seller | Dispatch photos (at least two), then the courier and tracking, or "dropping it off myself" |
| Received | centre | Staff find the order by its number, check the item against the listing and its photos, take photos at check-in, and mark it received or refused (wrong item, damaged, missing parts); refused means a dispute |
| Ready | Udozo | The buyer is told by inbox, push, email and, where switched on, WhatsApp, with the centre's address, hours and the date it is held until |
| Collected | centre | The buyer shows their 6-digit release code; staff enter it (5 tries) and hand the item over; SurePay pays the seller as on release today |
| Not collected | Udozo | Past the holding days the buyer is reminded, then, after a grace period, the item goes back to the seller and the buyer is refunded less the shipping (see the open questions) |

- **Order statuses:** the existing ones plus `at_centre`. Each step is a shipment event with `reported_by: 'centre'`.
- **Concurrency:** each step claims the order in one conditional update, as Safe pay's steps do.
- **Inspection at collection:** whether the buyer can refuse the item at the counter is an open question.
- **Deadlines** (the `classifieds` job):
  - not sent in time: refund and a seller strike, as today;
  - sent but not received within `transit_days`: the seller is asked and operations are told;
  - not collected within the holding days: reminders, then the return.

### 6. Tracking

- **Buyer and seller:** the order page shows a timeline (paid, sent with the courier link, received at the centre with
  its photos, ready to collect, collected).
- **Centre staff:** every step they take is recorded with who did it and when, and is audited.
- **Couriers:** a seller's courier stays as today (name and tracking link). Couriers' own tracking feeds (the
  `CourierAdapter` of the reselling plan) can come later, behind the same events.

### 7. Money

- **Paid in:** the buyer pays price + shipping + the SurePay buyer fee.
- **Paid out on collection:** the seller gets the price and the shipping, less the SurePay seller fee and any Connect
  centre fee.
- **Connect centre fee:** paid to the centre or kept by Udozo. Who pays it and how much is an open question.
- **Ledger:** fees go in their own ledger account (`connect_revenue`), never mixed with Safe pay's.

### 8. Udozo SurePay (the rename)

Safe pay is renamed **Udozo SurePay** in every word people read: udozo.com, Seller HQ, the admin, emails, notices, the
assistants' knowledge, help, terms and privacy.

- **One constant:** the name is put in one place (`payName` in `@bitocard/api-client/classifieds` and its twin in the
  API), so it is never hard-coded again. Today it is written out about 550 times across the four apps.
- **Unchanged:** codes, routes and data (`safe_pay`, `/v1/classifieds/safe-pay`, `classified_safe_pay_settings`, order
  numbers `SP-000123`), so no client breaks.
- **Addresses:** `/account/safe-pay` moves to `/account/surepay` with a permanent redirect, and
  `/safe-trade#safe-pay` to `#surepay`.
- **Terms:** a new version (`legalVersion`, `shopTermsVersion`), so people accept the renamed terms once.
- **First, check the name:** confirm "SurePay" is free to use as a payment name in each market (see the legal list).

## Phases

1. **SurePay rename**: words only, as above.
2. **Centres and staff**: the centres table, the admin's Centres page, the `connect_centre` role and its three phone
   screens, and udozo.com's Collection centres page.
3. **Listings**: shipping states and centres in Post an ad, and the listing page's shipping line.
4. **Orders**: buying with a centre, received, ready, collected with the code, not collected, and the timeline.
5. **Reports and alerts**: what each centre holds and its overdue items, uncollected rates, and seller and centre
   problems.

Each phase is behind the switch `connect_shipping` (Udozo's own, global or per country, **off by default**), with
tests in the API, the site and the admin, as the other Udozo plans are.

## Legal owed before it opens

- **Terms:** a new Connect section covering what a centre does and does not do, holding periods, uncollected items,
  damage and loss while an item is at a centre, inspection, and prohibited items for centres.
- **Privacy notice:** the buyer's name and phone shown to centre staff, check-in photos, and how long they are kept.
- **Centre partners:** if partners run centres, a centre agreement covering custody, liability, insurance and data.
- **The name:** a trademark check for "SurePay" in each market.

## Open questions for the owner

1. **Who runs the centres?** Udozo's own staff, partner shops (for example a phone shop or courier office), or both?
   This decides whether staff are Udozo admins with a centre role or partners with their own sign-in.
2. **Who carries the item to the centre?** The seller (dropping it off, or by any courier they choose), or Udozo
   through couriers it contracts between centres?
3. **Shipping charge:** does the seller set it (one price per state, or one for all states), or does Udozo set it per
   route? Is there a Udozo Connect fee on top, and who pays it?
4. **Inspection at the counter:** can the buyer look at the item at the centre and refuse it there (opening a dispute)
   before entering the code?
5. **Uncollected items:** how many days a centre keeps them, and whether the buyer is refunded in full or less the
   shipping.
6. **Do Connect and today's home delivery live side by side**, or does Connect replace home delivery?
7. **Which markets first?** Nigeria only, with which states and cities for the first centres?
