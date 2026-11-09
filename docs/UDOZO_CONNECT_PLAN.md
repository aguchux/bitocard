# Udozo Connect: UdozoPay, logistics and Connect Centres

Status: **planned** (9 November 2026, the owner's request). Nothing is built yet. Open questions are at the end; the
owner's answers go into this file before the work starts.

## Udozo's two halves

- **Udozo Marketplace** is buying and selling: listings, search, chats, offers, sellers' pages, reviews and the rest of
  udozo.com today.
- **Udozo Connect** makes sure buyers and sellers exchange goods and money safely. It has three parts:
  - **UdozoPay**: payments. This is today's Safe pay under its new name. Udozo holds the buyer's money until they have
    the item, then pays the seller.
  - **Logistics**: shipping and tracking. Items go to a Connect Centre the buyer chose, and both sides follow every step.
  - **Connect Centres**: shipment offices run by members of the public. They **apply** to have their office used as a
    Connect Centre, and Udozo approves them. A centre receives items from sellers and hands them to buyers.
- **connect.udozo.com** is Udozo Connect's dashboard, where centres apply and then run their office: items on their
  way, receiving, shelving, releasing, updates and returns to sellers.

A buyer who wants an item shipped chooses an approved Connect Centre, never a home address. **Every Connect trade is
paid with UdozoPay.**

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
- **Payouts:** sellers are paid to their bank through the customer payouts (`/v1/store/cash`); a centre's earnings can
  use the same route.
- **Identity checks:** Udozo Verify checks customers (optional for Udozo customers by default, the
  `customer_identity_check` switch).
- **Couriers:** an admin list of names and tracking-link patterns per market. `CourierAdapter` exists only in a plan.
- **Areas** (`classified_areas`): states and areas with centre points, so a centre can sit in an area.
- **Help menu:** "Pickup centres" is listed and marked Soon (`apps/udozo/lib/help.ts`).

Connect adds a third way to hand over an item, **at a Connect Centre**, to the meet-up and the delivery Safe pay has
today.

## Design

### 1. Applying to be a Connect Centre

Anyone with a confirmed Udozo account can apply to have their office used as a Connect Centre, at **Become a Connect
Centre** on connect.udozo.com (linked from udozo.com's footer, help menu and Connect Centres page).

- **What they give:**
  - the business name, and its registration number where it has one;
  - the office's address, state, area, landmark and map position;
  - opening hours, a phone number, and how many items the office can hold;
  - photos of the shopfront, the counter and where items are kept;
  - the person in charge.
- **What they must pass:** the applicant's identity check (Udozo Verify), required for centres whatever the
  `customer_identity_check` switch says, a confirmed mobile number, and the Connect Centre agreement.
- **Stored:** `connect_centre_applications`, numbered `CA-000123`. Statuses are `submitted`, `in_review`,
  `changes_requested`, `approved` and `rejected`, with the reason.
- **Udozo's review** (admin Connect > **Applications**, operations): read the application, its photos and the identity
  check, ask for changes, approve or reject, all audited. Approving can include a visit (see the open questions). The
  applicant is told at each step by inbox, push and email.
- **Approved:** the application becomes a **centre** (`connect_centres`), owned by the applicant, its **partner**.

### 2. Centres (`connect_centres`)

- **What a centre records:** its partner (the customer who applied), country, state, area, name, address, landmark,
  opening hours, phone, map position and photos.
- **Status:** `active`, `paused` (taking nothing new while it finishes what it holds; the partner can pause for a
  holiday, Udozo for a problem) or `closed`.
- **Holding limits:** the most items it can hold and how many days it keeps an item (default 7).
- **Admin:** Connect > **Centres** to see each centre's load and record (on time, refused, uncollected, disputes) and to
  pause or close one with a reason, audited.
- **Public:** `GET /v1/connect/centres?country=&state=` lists the active centres. udozo.com's **Connect Centres** page
  replaces the help menu's "Pickup centres (Soon)" and shows each centre with its map and hours.

### 3. The Connect dashboard (connect.udozo.com)

A Next.js app of its own, `apps/udozo-connect` (package `@udozo/connect`, Vercel project `udozo-connect`, private and
never indexed), built mobile first, since centre staff work from a phone at the counter. It is built like Seller HQ on
the shared console (`ConsoleShell` with Udozo's light sidebar, `@bitocard/admin-ui`, `@bitocard/api-client`).

- **Who signs in:** partners and their staff, with their ordinary **Udozo account**: email and password, Google,
  Facebook or WhatsApp, as on udozo.com. They are never admins. The dashboard's server keeps the session in its own
  host-only cookie.
- **Roles per centre:**
  - `owner`: the partner who applied, with staff, settings and earnings;
  - `manager`: everything but earnings and staff;
  - `staff`: receive, shelve, release and update.

  The owner adds staff by email (Udozo accounts with a confirmed mobile) and removes them. One person can work at
  more than one centre and picks the centre in the menu.
- **API:** `/v1/connect/...`, open only to the centre's own people by role (`centre_unknown` for anyone else), every
  step recorded with who did it and when.

**What the dashboard does:**

| Screen | What it is for |
|---|---|
| **Overview** | Today at the centre: items expected, waiting to be received, on the shelf, due for collection today, overdue, and returns to send back |
| **Expected** | Orders on their way to this centre: the order number, the item and its listing photos, the seller, the courier and tracking, and when it was sent, with late ones marked |
| **Receive** | Find the order by its number or by scanning the label's QR code; check the item against the listing and the seller's dispatch photos; take check-in photos; **Received** or **Refuse** with a reason (wrong item, damaged, missing parts, not allowed at centres). Refusing opens a dispute and a return |
| **Shelve** | Put a received item in a storage place: the centre sets up its places (`A-01`, `Shelf 3`, `Back room`), each with how much it holds. An item is not "ready to collect" until it is shelved, and every move is kept, so staff always know where it is |
| **Release** | The buyer gives their 6-digit code (or shows its QR code); staff enter or scan it, see the item, its shelf and check-in photos, hand it over and confirm. Five wrong codes lock it for Udozo to look into |
| **Updates** | Notes and photos on any item to the buyer, the seller or Udozo (for example "Box was wet on arrival", "Buyer came, will return tomorrow"). Buyer and seller read them on the order's timeline |
| **Returns** | Request a return to the seller (not collected in time, refused at check-in, or damaged), with why and photos. The seller accepts it, or Udozo approves it; unanswered after 48 hours it is accepted automatically (see Return requests below). The seller then collects it with their own **return code** |
| **Stock check** | List what should be on each shelf and mark what is there; anything missing is flagged to Udozo at once |
| **History** | Every item the centre has handled, with its steps, photos and who did each |
| **Centre** | Opening hours, holiday closures (pausing new orders), phone, photos, capacity, holding days, and staff |
| **Earnings** | Fees earned per item, what is held and what can be paid out, and payouts to the bank (through the customer payouts) |

- **Labels:** every Connect order has a printable **label** with a QR code (the order number and centre, never the
  buyer's details). The seller prints it or writes the number on the parcel, and centres scan it to receive.
- **Notifications:** the centre's people are told of new expected items, items arriving late, collections due, return
  requests and Udozo's decisions (inbox and push in the dashboard, and email for what matters).
- **Udozo's admin** (admin.udozo.com, Connect section) keeps oversight: applications, centres, every centre's items and
  shelves, overdue and lost items, disputes, returns, centres' records, pausing and closing.

### 4. Listings: shipping through Connect

- **Post an ad, Location and delivery step:**
  - a new **Ship through Udozo Connect** switch;
  - the **states** the seller ships to, with **All states** as one tick;
  - the **centres** in those states, with every centre in a ticked state chosen unless the seller unticks some;
  - the shipping charge (see the open questions).
- **Stored:** `classified_listings.connect` (on or off), `classified_listing_connect_states` and
  `classified_listing_connect_centres`. The API checks that each centre is active and sits in a state the seller ticked.
- **Shown to buyers:** the listing page shows "Ship to a Udozo Connect Centre" with the states it reaches, and the
  structured data marks the offer as shipped.

### 5. Buying through Connect

- **Choosing a centre:** Buy with UdozoPay gets a third choice, **Collect at a Connect Centre**. The buyer picks a
  state, then one of that listing's centres there (nearest first, from the buyer's area), and sees the shipping charge
  and the total before paying.
- **On the order:** `fulfilment: 'connect'`, `connect_centre_id`, and the shipping charge in `delivery_fee_minor`. No
  address is kept.
- **Only through UdozoPay:** an order with `connect` cannot be paid any other way, and the API refuses one without a
  centre (`centre_required`) or with a centre the listing does not ship to, or one that is not active
  (`centre_unavailable`).

### 6. The trade, step by step

| Step | Who | What happens |
|---|---|---|
| Paid | buyer | UdozoPay holds the money; the seller has `handover_days` to send the item |
| Sent | seller | Dispatch photos (at least two), then the courier and tracking, or "dropping it off myself" |
| Received | centre | Staff scan the label or find the order by its number, check the item against the listing and its photos, take photos at check-in, and mark it received or refused (wrong item, damaged, missing parts); refused means a dispute and a return |
| Shelved | centre | Staff put it in one of the centre's storage places |
| Ready | Udozo | The buyer is told by inbox, push, email and, where switched on, WhatsApp, with the centre's address, hours and the date it is held until |
| Collected | centre | The buyer shows their 6-digit release code; staff enter it (5 tries) and hand the item over; UdozoPay pays the seller as on release today, and the centre its fee |
| Not collected | centre | Past the holding days the buyer is reminded; after a grace period the centre requests a return to the seller (see Return requests below) |
| Returned | seller | Once the return is accepted, the seller collects it with their return code and the trade is settled |

- **Order statuses:** the existing ones plus `at_centre` and `returning`. Each step is a shipment event with `reported_by: 'centre'`.
- **Concurrency:** each step claims the order in one conditional update, as Safe pay's steps do.
- **Inspection at collection:** whether the buyer can refuse the item at the counter is an open question.
- **Deadlines** (the `classifieds` job):
  - not sent in time: refund and a seller strike, as today;
  - sent but not received within `transit_days`: the seller is asked and operations are told;
  - not collected within the holding days: reminders, then the return.
- **A centre's record:** items refused in error, lost or handed to the wrong person count against the centre. Past a
  limit, Udozo pauses it, as seller strikes do today.

### 6a. Return requests

The owner's rules (9 November 2026):

- **Who asks:** a centre requests a return to the seller on its dashboard, with the reason (not collected in time,
  refused at check-in, damaged) and photos. It is stored in `connect_return_requests` (`RR-000123`), with the order, the
  centre, the reason, who asked and when.
- **Who answers:**
  - the **seller** sees the request in their account (inbox, push, email and the order page) and **accepts** it;
  - **Udozo's admins** see every request in the admin (Connect > **Returns**) and can **approve** it at any time;
  - whichever comes first settles it, claimed in one conditional update so it is decided once.
- **Unanswered after 48 hours:** if neither the seller nor an admin has answered, the `classifieds` job **accepts it
  automatically** (`decided_by: auto`). The 48 hours are a setting per market, default 48.
- **Everyone is told** when a return is requested and again when it is accepted, approved or auto-accepted:
  - the **seller**, with what to do next and their return code;
  - the **buyer**, with what it means for their money;
  - the **centre**, which keeps the item for the seller;
  - **Udozo's admins** (operations and support).

  By inbox and push, and by email (WhatsApp where switched on). An auto-acceptance says it was accepted because nobody
  answered in 48 hours.
- **After it is accepted:**
  - the seller gets a 6-digit **return code** and collects the item at the centre; staff enter or scan it on the
    Release screen, marked as a return;
  - the order moves to `returning`, then, once collected, settles as the reason requires: refunded to the buyer for an
    item refused at check-in or damaged; for one not collected, as the open question on uncollected items decides.
- **Records:** every request and decision is in the order's timeline and Udozo's audit log. A seller whose returns
  pile up, or who does not collect an accepted return, is told and counted, as strikes are today.

### 7. Tracking

- **Buyer and seller:** the order page shows a timeline (paid, sent with the courier link, received at the centre with
  its photos, ready to collect, collected).
- **Centres:** every step they take is recorded with who did it and when.
- **Couriers:** a seller's courier stays as today (name and tracking link). Couriers' own tracking feeds (the
  `CourierAdapter` of the reselling plan) can come later, behind the same events.

### 8. Money

- **Paid in:** the buyer pays price + shipping + the UdozoPay buyer fee.
- **Paid out on collection:** the seller gets the price and the shipping, less the UdozoPay seller fee and any Connect
  fee. The centre gets its handling fee into its earnings, paid to its bank through the customer payouts.
- **Connect fee:** how much the centre's fee is and who pays it are open questions.
- **Ledger:** Connect's fees and centres' earnings have their own ledger accounts (`connect_revenue`,
  `connect_centre_earnings`), never mixed with UdozoPay's.

### 9. UdozoPay (the rename)

Safe pay is renamed **UdozoPay** in every word people read: udozo.com, Seller HQ, the admin, emails, notices, the
assistants' knowledge, help, terms and privacy.

- **One constant:** the name is put in one place (`payName` in `@bitocard/api-client/classifieds` and its twin in the
  API), so it is never hard-coded again. Today it is written out about 550 times across the four apps.
- **Unchanged:** codes, routes and data (`safe_pay`, `/v1/classifieds/safe-pay`, `classified_safe_pay_settings`, order
  numbers `SP-000123`), so no client breaks.
- **Addresses:** `/account/safe-pay` moves to `/account/udozopay` with a permanent redirect, and
  `/safe-trade#safe-pay` to `#udozopay`.
- **Terms:** a new version (`legalVersion`, `shopTermsVersion`), so people accept the renamed terms once.
- **Where it belongs:** UdozoPay is presented as part of Udozo Connect, for example "UdozoPay, by Udozo Connect" on
  the payment pages and help.

## Phases

1. **UdozoPay rename**: words only, as above, with Udozo Connect named as the home of payments and logistics.
2. **Connect Centre applications**: the apply page on connect.udozo.com, identity and mobile checks, the admin's review,
   and the agreement.
3. **Centres and the dashboard**: the centres table, connect.udozo.com (sign-in, centre roles and staff, Centre,
   shelves), the admin's Centres page, and udozo.com's Connect Centres page.
4. **Listings**: shipping states and centres in Post an ad, and the listing page's shipping line.
5. **Orders**: buying with a centre, labels, and on the dashboard Expected, Receive, Shelve, Release, Updates, Returns
   and Stock check; the order timeline, and centre earnings and payouts.
6. **Reports and alerts**: what each centre holds and its overdue items, uncollected rates, and seller and centre
   problems.

Each phase is behind the switch `connect_shipping` (Udozo's own, global or per country, **off by default**), with
tests in the API, the site and the admin, as the other Udozo plans are. Applications can open before shipping does, so
centres are ready on the day it switches on.

## Legal owed before it opens

- **Terms:** a new Connect section covering what a centre does and does not do, holding periods, uncollected items,
  damage and loss while an item is at a centre, inspection, and prohibited items for centres.
- **Connect Centre agreement** (accepted when applying, recorded by version): custody of items, liability for loss and
  damage, any insurance or deposit, fees and payouts, staff, keeping buyers' details private, pausing and closing.
- **Privacy notice:**
  - what an application keeps (the business, the office's photos, the identity check);
  - the buyer's name, phone and order shown to centre staff;
  - check-in photos;
  - how long each is kept.
- **The name:** a trademark check for "UdozoPay" and "Udozo Connect" in each market, and lawyers' confirmation that
  holding payments through licensed partners still covers UdozoPay.

## Open questions for the owner

1. **Who carries the item to the centre?** The seller (dropping it off, or by any courier they choose), or Udozo
   through couriers it contracts between centres?
2. **Shipping charge:** does the seller set it (one price per state, or one for all states), or does Udozo set it per
   route?
3. **The centre's fee:** how much a centre earns per item, and who pays it (buyer, seller or Udozo's share of the
   UdozoPay fees)?
4. **Inspection at the counter:** can the buyer look at the item at the centre and refuse it there (opening a dispute)
   before entering the code?
5. **Uncollected items:** how many days a centre keeps them, and whether the buyer is refunded in full or less the
   shipping.
6. **Approving centres:** is the online review enough, or does Udozo visit an office (or ask for a video tour) before
   approving it? Does a centre pay a deposit or need insurance?
7. **Home delivery:** does it stay alongside Connect, or does Connect replace it?
8. **First market:** Nigeria only, and which cities should take applications first?
9. **Returns, still open:** how long a seller has to collect an accepted return, and what happens if they never
   do. Can the seller ask the centre to send it by courier instead, and who pays? (Answered: the seller accepts or an
   admin approves, auto-accepted after 48 hours, everyone told; see Return requests.)
