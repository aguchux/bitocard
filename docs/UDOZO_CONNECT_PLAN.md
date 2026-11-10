# Udozo Connect: UdozoPay, logistics and Connect Centres

Status: **being built** (9 November 2026, the owner's request). The owner has answered every open question
(recorded at the end). Phases 1 to 4 are built; nothing is pushed until every phase is (the owner's rule).

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
today. **Home delivery is left as it is for now:** whether Connect replaces it is deferred (the owner, 9 November
2026).

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
- **A deposit:** every centre pays a **deposit** before it is approved (`centre_deposit_minor`, per market, set by
  finance), paid with UdozoPay into its own held ledger account (`connect_centre_deposits`, the centre's, never
  spent). It covers what the centre owes Udozo, buyers or sellers for items it loses or mishandles while liable. When a
  centre closes and holds nothing, the deposit is returned less anything still owed, audited.
- **Stored:** `connect_centre_applications`, numbered `CA-000123`. Statuses are `draft`, `submitted`,
  `changes_requested`, `visit_scheduled`, `visited`, `approved`, `rejected` (with the reason) and `withdrawn`.
- **Udozo's review** (admin Connect > **Applications**, operations), in two parts, both needed before approval:
  1. **Online:** read the application, its photos and the identity check; ask for changes or reject.
  2. **A visit:** **Udozo's own staff or trained agents** visit the office (`visit_scheduled`, then `visited` with the
     visitor's name, notes and photos, and whether it passed), arranged with the applicant on their application page.
     Agents are trained and recorded by Udozo (`connect_visitors`) before they can be assigned a visit.

  Only then can it be **approved**. Every step is audited, and the applicant is told at each one by inbox, push and
  email.
- **Approved:** the application becomes a **centre** (`connect_centres`), owned by the applicant, its **partner**.
- **Where applications are taken:** **every state** of a market where Connect is on, until an admin switches a state
  off (`connect_states`, per state, on by default; admin Connect > **States**, operations, audited). A state switched
  off takes no new applications and its centres take no new orders, while what they hold finishes.

### 2. Centres (`connect_centres`)

- **What a centre records:** its partner (the customer who applied), country, state, area, name, address, landmark,
  opening hours, phone, map position and photos.
- **Status:** `active`, `paused` (taking nothing new while it finishes what it holds; the partner can pause for a
  holiday, Udozo for a problem) or `closed`.
- **Holding limits:** the most items it can hold. How long items are kept, and what that costs, is the market's rule
  for every centre (see Holding times, demurrage and Loss of care).
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
| **Release** | The buyer inspects the item first; if they accept it they give their 6-digit code (or show its QR code), and staff enter or scan it, see the item, its shelf and check-in photos, hand it over and confirm. If they refuse it, staff record why with photos and keep it. Five wrong codes lock it for Udozo to look into |
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
  - a **shipping charge for each ticked state**, set by the seller (with one box to use the same charge for all).
    It covers getting the item to a centre in that state and is the seller's in full; the **Connect fee** is separate
    and paid by the buyer (see Money).
- **Stored:** `classified_listings.connect` (on or off), `classified_listing_connect_states` (state and its shipping
  charge) and `classified_listing_connect_centres`. The API checks that each centre is active and sits in a state the seller ticked.
- **Shown to buyers:** the listing page shows "Ship to a Udozo Connect Centre" with the states it reaches, and the
  structured data marks the offer as shipped.

### 5. Buying through Connect

- **Choosing a centre:** Buy with UdozoPay gets a third choice, **Collect at a Connect Centre**. The buyer picks a
  state, then one of that listing's centres there (nearest first, from the buyer's area), and sees that state's
  shipping charge, the Connect fee and the total before paying.
- **On the order:** `fulfilment: 'connect'`, `connect_centre_id`, the shipping charge in `delivery_fee_minor` and the
  Connect fee in `connect_fee_minor`, fixed when paid. No address is kept.
- **Only through UdozoPay:** an order with `connect` cannot be paid any other way, and the API refuses one without a
  centre (`centre_required`) or with a centre the listing does not ship to, or one that is not active
  (`centre_unavailable`).

### 6. The trade, step by step

| Step | Who | What happens |
|---|---|---|
| Paid | buyer | UdozoPay holds the money; the seller has `handover_days` to send the item |
| Sent | seller | **The seller gets the item to the centre**, by dropping it off or by any courier they choose. Dispatch photos (at least two), then the courier and tracking, or "dropping it off myself" |
| Received | centre | Staff scan the label or find the order by its number, check the item against the listing and its photos, take photos at check-in, and mark it received or refused (wrong item, damaged, missing parts); refused means a dispute and a return |
| Shelved | centre | Staff put it in one of the centre's storage places |
| Ready | Udozo | The buyer is told by inbox, push, email and, where switched on, WhatsApp, with the centre's address, hours, the 72 hours they have to collect free, and the demurrage after them |
| Inspected | buyer | At the counter the buyer pays any demurrage due, then **inspects the item** before giving their code: they accept it, or refuse it with a reason and photos the staff take |
| Collected | centre | Accepted: the buyer shows their 6-digit release code; staff enter it (5 tries) and hand the item over; UdozoPay pays the seller as on release today, and the centre its fee |
| Refused at the counter | buyer | The item stays at the centre, a dispute opens with the reason and photos, and Udozo decides it; a decision for the buyer returns the item to the seller (Return requests below) and refunds the buyer |
| Not collected | centre | Daily demurrage from 72 hours after Ready; at 7 days the return to the seller is due and the centre requests it (see Return requests below) |
| Returned | seller | Once the return is accepted, the seller collects it with their return code and the trade is settled |

- **Order statuses:** the existing ones plus `at_centre` and `returning`. Each step is a shipment event with `reported_by: 'centre'`.
- **Concurrency:** each step claims the order in one conditional update, as Safe pay's steps do.
- **Inspection at collection** (the owner's rule: important): the buyer always inspects the item at the counter
  before the code is entered, and the centre's dashboard asks staff to wait for the buyer's yes or no. The code is
  never entered for an item the buyer refused.
- **Deadlines** (the `classifieds` job):
  - not sent in time: refund and a seller strike, as today;
  - sent but not received within `transit_days`: the seller is asked and operations are told;
  - not collected by the buyer: reminders before the 72 hours end, demurrage after them, and the return due at 7
    days;
  - an accepted return not collected by the seller within 7 days: Loss of care.
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
  - the seller gets a 6-digit **return code** and either **collects the item at the centre**, or has it **shipped to a
    Connect Centre near them** and collects it there; centres never send returns anywhere else (no courier to the
    seller's door);
  - **the seller bears every return fee**: the return shipping (the listing's own shipping charge for the state of the
    centre it goes to, else a rate Udozo's finance sets per market), and the Connect fee of the centre that hands it
    back. It is charged before the item leaves (from what UdozoPay owes them, else their wallet); the centre-to-centre
    trip is tracked like any Connect shipment;
  - at whichever centre they collect, staff enter or scan the return code on the Release screen, marked as a return;
  - the order moves to `returning`, then, once collected, settles as the reason requires: refunded to the buyer for an
    item refused at check-in, refused at the counter (when Udozo decides for the buyer) or damaged; for one the buyer
    did not collect, refunded less the shipping and the buyer's demurrage.
- **Records:** every request and decision is in the order's timeline and Udozo's audit log. A seller whose returns
  pile up, or who does not collect an accepted return, is told and counted, as strikes are today.

### 6b. Holding times, demurrage and Loss of care

The owner's rules (9 November 2026). Every time and rate is a setting per market (Connect settings in Udozo's admin,
finance and operations, audited), with these defaults; admins can change any of them.

**Demurrage** is the charge for keeping an item at a centre past its free time:
- charged **every day**, as a **percentage of the order's shipping charge**, at **the same rate for the buyer and the
  seller**: **2.1%** (`demurrage_bps`, one setting for both, default 210; the owner confirmed 9 November 2026);
- with **no cap**: it runs for as long as the item stays.

**The buyer:**
- **72 hours free** from the moment the item is Ready (`buyer_free_hours`, default 72). Reminders go out before they
  end.
- **After 72 hours, demurrage** is charged to the buyer each day. It must be paid (from their UdozoPay wallet) before
  the release code is accepted, and the order page and dashboard show what is due.
- **At 7 days** from Ready (`return_due_days`, default 7) the **return to the seller is due**: the centre requests it
  and it follows Return requests above (seller accepts or admin approves, automatic after 48 hours, everyone told).
- The buyer's refund is the price less the shipping and less the demurrage that ran up.

**The seller:**
- The seller has **7 days** to collect the return with their return code (`seller_collect_days`, default 7), counted
  from the day the return was **accepted by the seller, approved by an admin or accepted automatically**. Those 7 days
  are free.
- **Not collected in 7 days:** the item goes into **Loss of care**, and from then on, **every day**:
  - the **centre is no longer liable** for any damage to or loss of the item, **but it is still responsible** for it:
    it keeps the item safe where it is shelved, never uses, sells or gives it away, hands it over only against the
    seller's return code (or to Udozo, below), keeps it in its stock checks, and reports anything that happens to it;
  - **demurrage** is charged to the seller (as above, no cap);
  - a **Loss of care penalty** is charged to the seller: **2.1% of the order's shipping charge, capped at ₦500 a day**
    (`loc_penalty_bps`, default 210, and `loc_penalty_cap_minor`, default 50,000 kobo, per market; a percentage of
    the shipping, never of the product's price);
  - the seller, centre and Udozo's admins are told when it goes into Loss of care, and the order's timeline and the
    centre's dashboard mark it.
- A seller can still collect an item in Loss of care, after paying the demurrage and penalties that ran up.

**Abandoned and auctioned** (counted from the day the item went into Loss of care):
- **30 days:** the item is marked **abandoned** (`abandoned_after_days`, default 30). The seller, centre and Udozo's
  admins are told. **Udozo picks it up** from the centre and takes it to the centre's **Final Return Address** (below);
  centres never send items themselves. The centre hands it to Udozo's pickup against a pickup code, with check-out
  photos and a handover record, and Udozo then keeps it. Charges keep running either way, and until the auction the
  seller can still collect it (at the centre, or at the warehouse once it is there) after paying what is owed.
- **90 days:** Udozo **may auction** the item to recover the storage loss (`auction_after_days`, default 90). The seller
  is told before it is listed. **Auctions run on udozo.com** (see Udozo auctions below). What the sale raises pays what is owed (demurrage, penalties, and the cost of the
  auction and moving it).
- **What is left over is the seller's, but only on a claim:** the seller files a **claim request** (on the order page;
  `connect_auction_claims`), Udozo's finance checks it and pays the rest into the seller's UdozoPay earnings, audited.
  The seller has **90 days from the sale** to claim (`claim_days`, default 90), and is told when the item sells and
  again before the 90 days end. Without a claim nothing is paid out: **unclaimed money is Udozo's** after the 90 days
  (moved to `connect_revenue`, audited).

**Udozo auctions (on udozo.com):**
- **What is auctioned:** abandoned Connect items Udozo holds in its warehouses, sold by **Udozo itself** (never the
  seller), each as an auction listing with its photos from check-in and the warehouse, an honest description of its
  state ("sold as seen", from an abandoned shipment) and where it is collected (the warehouse, or shipped through
  Connect like any item).
- **Where:** a section of udozo.com, **Udozo auctions** (`/<cc>/auctions` and each lot's page), linked from the
  market's footer and help, with its own terms.
- **Bidding:** signed-in Udozo accounts with a confirmed mobile, a starting price set by operations (at least what is
  owed, where it can be), bids in steps, an end time extended by a few minutes when a bid comes in at the end, and the
  winner paying with **UdozoPay** within a set time (else the next highest bidder is offered it).
- **Admin:** Connect > **Auctions** (operations list a lot, set its start price and end, cancel it before bids if the
  seller pays up; finance sees what each sale paid off and what is left for the seller), audited.
- The bidding rules (steps, time extension, payment window, a reserve) are settled when this phase is built.
- Each step is in the order's timeline and Udozo's audit log, and is claimed once by the `classifieds` job.

**Who receives it:** demurrage and Loss of care penalties are split between the **Connect Centre** that holds the item
and **Udozo**, **70% to the centre and 30% to Udozo** by default (`centre_share_bps`, default 7,000; Udozo has the
rest). The centre's share goes to its earnings, and Udozo's to `connect_revenue`.

**Taking the money:** the buyer's demurrage is paid before collection. The seller's demurrage and penalties come out of
what UdozoPay owes them, else their wallet, else they are owed and must be paid before the seller trades through
Connect again. Each day's charge is its own ledger entry (`connect_demurrage:<order>:<day>`), so it is charged once.

**Udozo warehouses and Final Return Addresses (FRA):**
- **Udozo runs its own warehouses** (`connect_warehouses`: address, state, hours, contact; admin Connect >
  **Warehouses**, operations). **The first is in Lagos**, and it is every centre's Final Return Address until more
  open.
- **Every centre has a Final Return Address**: the warehouse its abandoned items go to, set by Udozo's operations
  (`connect_centres.fra_warehouse_id`). The centre sees it on its dashboard (Centre and Overview), with the next pickup.
- **Udozo collects:** Udozo's operations schedule pickups from centres (`connect_pickups`: the centre, the items, the
  day, who collects). The centre sees what is due to be picked up; each item is checked out with its pickup code and
  photos, and checked in at the warehouse, so it is never unaccounted for.

**Order statuses** add `loss_of_care` and `abandoned`, and the item's place adds `awaiting_pickup`, `udozo_warehouse` and `auctioned`. The `classifieds` job starts demurrage, makes returns due, moves items into Loss
of care and charges each day, each step claimed once, so a run twice charges nothing twice.

### 7. Tracking

- **Buyer and seller:** the order page shows a timeline (paid, sent with the courier link, received at the centre with
  its photos, ready to collect, collected).
- **Centres:** every step they take is recorded with who did it and when.
- **Couriers:** a seller's courier stays as today (name and tracking link). Couriers' own tracking feeds (the
  `CourierAdapter` of the reselling plan) can come later, behind the same events.

### 8. Money

- **Paid in:** the buyer pays the price + the shipping charge for the centre's state + the **Connect fee** + the
  UdozoPay buyer fee.
- **The Connect fee** is the charge for using a Connect Centre, **paid by the buyer** on every Connect order. Finance
  sets it per market and chooses its kind (`connect_fee_kind`): a **percentage of the order's shipping charge**
  (`connect_fee_bps`) or a **fixed amount** per order (`connect_fee_minor`). Connect does not open in a market until it
  is set.
- **The Connect fee is shared 70:30:** **70% to the Connect Centre** that hands the item over, **30% to Udozo**
  (`centre_share_bps`, default 7,000, the same split as demurrage and penalties). The centre's share goes to its
  earnings, paid to its bank through the customer payouts; Udozo's to `connect_revenue`.
- **Paid out on collection:** the seller gets the price and the **full shipping charge**, less the UdozoPay seller fee.
- **Refunds:** a buyer refunded because the item was refused at check-in, refused at the counter (decided for them) or
  damaged gets the Connect fee back; one who did not collect does not.
- **Pickups** of abandoned items to a Udozo warehouse are **paid by Udozo**, never charged to the seller or recovered
  from the auction.
- **Return fees** are always the seller's (see Return requests).
- **Demurrage and Loss of care penalties:** see Holding times, demurrage and Loss of care.
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

1. **UdozoPay rename** (**built**): words only, as above, with Udozo Connect named as the home of payments and logistics.
   The name is in `payName` and `connectName` for new copy, and a test fails on the old name anywhere in Udozo's code.
2. **Connect Centre applications** (**built**): the apply page on connect.udozo.com, identity and mobile checks, the
   admin's review, and the agreement. As built:
   - **API** (`apps/udozo-api/src/connect/`, migration `20270309100000_connect_applications`; switch `connect_applications`,
     Udozo's, global or country, off by default): customers' `/v1/connect` (`apply` settings, `agreement/accept`,
     `applications` create, read, `PATCH`, photo `uploads` and attach (`connect_photo` purpose), `submit`, `withdraw`,
     `visit/confirm`, `visit/reschedule`); admins' `/v1/admin/connect` (applications with `request-changes`, `visit`,
     `visit/result`, `approve`, `reject`; `visitors`; `states/:country` and `PUT states/:state`; `settings/:country` for
     the deposit, finance with step-up; `centres`). Statuses: draft, submitted, changes_requested, visit_scheduled, visited,
     approved, rejected, withdrawn (`in_review` dropped: a sent application is `submitted` until Udozo acts). The deposit is
     taken from the UdozoPay wallet on first submission into the applicant's own `connect_centre_deposit` account, returned
     on rejection or withdrawal, kept by the approved centre. Approval makes a `connect_centres` row (`CC-000123`). Notices
     `customer.connect.application` and `admin.connect.application`, emails linking to udozo.com's `/connect/application`
     (which redirects to connect.udozo.com). Tests: `apps/udozo-api/test/connect-applications.test.mjs`.
   - **Admin** (admin.udozo.com, Connect: Applications, Visitors, States and deposit, Centres; hooks in
     `@bitocard/api-client/admin` `connect.ts`). Tests: `apps/udozo-admin/test/connect.test.tsx`.
   - **connect.udozo.com** (`apps/udozo-connect`, `@udozo/connect`, port 3013, private): signs in through udozo.com's
     handoff (the API allows `CONNECT_URL`), keeps the session in its own `udz_connect` cookie, the landing page, the apply
     wizard (photos uploaded through its own server), and the application page (timeline, visit confirm or another time,
     withdraw). Tests: `apps/udozo-connect/test/`. Not deployed: its Vercel project and DNS are still to make.
   - **udozo.com:** the Connect Centre agreement (`/legal/connect-centres`, version `2026-11-09` in the API), the privacy
     notice's section 4b and the `udz_connect` cookie, footer links, and `/connect/*` redirected to connect.udozo.com.
     Tests: `apps/udozo/test/connect.test.ts`.
3. **Centres and the dashboard** (**built**): the centres table, connect.udozo.com (sign-in, centre roles and staff,
   Centre, shelves), the admin's Centres page, and udozo.com's Connect Centres page. As built:
   - **API** (`ConnectCentresService`, `centres.controller.ts` in `apps/udozo-api/src/connect/`, migration
     `20270309200000_connect_centres`): `connect_centre_members` (owner, manager, staff; the partner is the owner, made at
     approval, and every centre approved before was given its owner by the migration) and `connect_shelves` (a code
     unique per centre in capitals, a description, how many it holds, in use or not; switched off, never deleted), and on
     `connect_centres` the pause (`paused_by` partner or udozo, its reason and an optional day to reopen) and closing.
     A centre's people (`/v1/connect/centres/mine`, `/:id`, `PATCH /:id`, `/:id/pause`, `/:id/resume`, `/:id/members`
     add, change and remove, `/:id/shelves` add and change; customer sessions; anyone else gets `centre_unknown`):
     owners and managers change the hours, phone, capacity and landmark, pause for a holiday and open again, and set up
     storage places; only the owner adds people (a Udozo account with a confirmed mobile, `account_not_found`,
     `mobile_not_confirmed`, `member_exists`, at most 20), changes their role or removes them; anyone but the owner may
     leave (`owner_fixed`); refusals by role are `centre_role_required` (403). A partner's pause with a day reopens by
     itself when centres are next read (`reopenDue`); Udozo's pause only Udozo lifts (`centre_not_paused_by_you`).
     Admins: `GET /v1/admin/connect/centres/:id` (support, operations, finance), `POST …/:id/pause|reinstate|close
     { reason }` (operations, audited `connect_centre.paused|reinstated|closed`, the owner and managers told, notice
     `customer.connect.centre` with an email); the list carries `paused`. Public: `GET /v1/connect/centres?country=&state=`
     (active centres only, a minute in caches, never the deposit). Tests: `apps/udozo-api/test/connect-centres.test.mjs`.
   - **Admin:** Connect > Centres rows open each centre's page (`/connect/centres/<id>`: the office, photos, its people
     and storage places, the partner and the application, the deposit; Pause, Reinstate or Open it again, and Close, each
     with a reason). Hooks `useConnectCentreQuery`, `useSetConnectCentreStatusMutation`. Tests: `apps/udozo-admin/test/connect.test.tsx`.
   - **connect.udozo.com:** `/centre` (the only centre, a choice of several, or back to the application), and each
     centre's pages under `/centre/<id>`: Overview (whether it takes orders, what it holds, Get ready: storage places and
     staff), Centre (`/settings`: the details, Going on holiday? with a day to reopen, Open again), Staff and Storage
     places (`/shelves`). The header shows **My centre** to people who work at one, and an approved application links
     **Open your centre**. Actions in `lib/centre-actions.ts`, reads in `lib/centre-data.ts`, rules in `lib/centres.ts`.
     **Not on `ConsoleShell`** as planned in section 3: the site keeps its server-held session (the browser never calls
     the API), so its centre layout is its own, mobile first (the menu a row of tabs across the top on phones, a list
     beside the page from tablets up). Tests: `apps/udozo-connect/test/centres.test.ts`, `centre-screens.test.tsx`.
   - **udozo.com:** `/<cc>/connect-centres` (`app/[cc]/connect-centres/page.tsx`, `lib/connect-centres.ts`): the
     market's centres by state (address, landmark, area, hours, a number to call, a map link, the shopfront), a state
     filter (`?state=<slug>`, `noindex`, as is a list with none yet), and Become a Connect Centre. The help menu's
     Pickup centres (Soon) is now **Connect Centres** (`/connect-centres`, which opens the chosen market's list, or the
     only market's, else a choice of markets), and the footer links it. Not in the sitemaps yet: that needs a count of
     centres on the classifieds sitemap API. Tests: `apps/udozo/test/connect.test.ts`, `help.test.ts`.
4. **Listings** (**built**): shipping states and centres in Post an ad, and the listing page's shipping line. As built:
   - **Switch** `connect_shipping` (Udozo's, global or country, off by default), on `GET /v1/classifieds/markets` as
     `connect_shipping`. Off: none can be set (`connect_unavailable`, `param: connect`; turning it off is always
     allowed), and listings keep their choice but buyers see nothing of it.
   - **API** (migration `20270310000000_connect_listings`; `ListingShippingService` in
     `apps/udozo-api/src/classifieds/connect-shipping.service.ts`): `classified_listings.connect` and
     `connect_all_centres` (every active centre in the ticked states, new ones too; the default), and
     `classified_listing_connect_states` (state, the seller's `shipping_minor`) and `classified_listing_connect_centres`
     (when the seller chose centres). Listings take `connect`, `connect_states: [{ state_id, shipping }]` (replacing them
     all) and `connect_centres` (ids, or null for every centre): states of the seller's country (`parameter_invalid`
     naming `connect_states[i].state_id`), not switched off for Connect (`state_unavailable`), each once; centres open,
     in the country and in a ticked state (`centre_unavailable`, `connect_centres[i]`); unticking a state drops its
     chosen centres. A Connect listing needs a price (`connect_price_required`: it is paid with UdozoPay), and past
     draft its states and a centre (`listing_incomplete`, `connect_states` or `connect_centres`, also at submit).
     Connect counts as a hand-over (`fulfilment_required` otherwise; the database check now allows `connect`). The
     seller's listing carries `connect { enabled, states, all_centres, centres }`; the public listing page `connect
     { states: [{ id, slug, name, shipping, centres }] }`, only states open for Connect with an open centre taking it,
     else null. Tests: `apps/udozo-api/test/connect-listings.test.mjs`.
   - **udozo.com:** Post an ad's Location and delivery step has **Ship through Udozo Connect** where the market has it
     (`ConnectShipping` in `components/account/connect-shipping.tsx`, rules in `lib/connect-shipping.ts`; the market's
     centres from `connectShippingFor`): the states with an open centre (and any already ticked), Every state with a
     centre, a charge per state and one for all, then Every centre in the states I ticked or a choice of them; saved as
     the form saves the rest, refusals opening this step (`stepOf`). In person can be left unticked when Connect hands it
     over, and is ticked again when Connect is turned off with no delivery. The listing page's **Ship to a Udozo Connect
     Centre** card (`connectLine`) lists the states and charges with See the centres, and its Product offer carries
     `shippingDetails` (an `OfferShippingDetails` per state). Tests: `apps/udozo/test/connect-shipping.test.ts`,
     `post-wizard.test.ts`.
5. **Orders** (**built**): buying with a centre, labels, and on the dashboard Expected, Receive, Shelve, Release, Updates, Returns
   and Stock check; the order timeline, and centre earnings and payouts. Built in slices:
   - **5a, the API's orders through a centre (built):**
     - **Settings and money:** finance sets each market's Connect fee on Connect > States, deposit and fee (`PUT
       /v1/admin/connect/settings/:country { fee_kind: percent|fixed|null, fee_bps | fee, centre_share_bps,
       buyer_free_hours }`, each field changed only when sent; migration `20270310100000_connect_orders`; audited
       `connect_settings.changed`). Until it is set, buyers cannot choose a centre.
     - **The quote:** `GET /v1/classifieds/listings/:id/safe-pay` offers `fulfilment: connect` with `connect { fee,
       states: [{ shipping, connect_fee, centres }] }` (`ConnectCheckoutService`): only centres the listing ships to,
       open, in a state open for Connect.
     - **The order:** `POST /v1/classifieds/orders { fulfilment: connect, connect_centre_id }` (`centre_required`,
       `centre_unavailable`) keeps the state's shipping charge as `delivery_fee_minor`, `connect_fee_minor` and the
       centre's part (`centre_share_minor`, fixed when asked). The buyer pays them with the price and their UdozoPay
       fee, and gets a release code (as at a meet-up).
     - **The seller's step:** `POST …/orders/:id/sent` with no courier (dropping it off) or with one, after two dispatch
       photos. Nothing is released by the clock (no `confirm_by`), and the buyer cannot confirm it at home
       (`connect_collect_at_centre`).
     - **The centre's counter** (`ConnectCounterService`, `/v1/connect/centres/:centre/orders`, any member of the
       centre; `centre_unknown` for anyone else): `?view=expected|at_centre|done`, `lookup?number=`, `:order`,
       `receive` (status `at_centre`), `refuse { wrong_item|damaged|missing_parts|not_allowed }`, `shelve { shelf_id }`
       (ready, `collect_by` the free hours later, the buyer told), `release { code }` (after the buyer inspected it; 5
       tries, `release_code_wrong`, `order_not_ready` unshelved), `refuse-collection { reason }` and `updates { body }`.
       The refusals are disputes in Udozo's words (`SafePayService.centreDispute`), decided as any other. Each step is
       on the order's timeline (shipment events `reported_by: centre`; `received`, `refused`, `ready`, `collected`,
       `collection_refused`, `note`).
     - **Release:** the seller's price and shipping less their UdozoPay fee; the centre's part of the Connect fee to
       its partner's `connect_centre_earnings`; Udozo's part to `connect_revenue` (in revenue reports as Udozo Connect
       fees). A refund returns everything, the Connect fee too.
     - **Presenter and tests:** orders carry `connect { centre, connect_fee, received_at, ready_at, collect_by }`.
       Tests: `apps/udozo-api/test/connect-orders.test.mjs`, `apps/udozo-admin/test/connect.test.tsx`.
   - **5b, connect.udozo.com's counter (built):** a centre's **Items** (`/centre/<id>/orders`: On their way, At the
     centre, Done; Find by the number on the label) and each item (`/centre/<id>/orders/<order>`, `CounterOrderView` in
     `apps/udozo-connect/components/counter-order.tsx`): Check it in (Received with a note, or Refuse with its reason,
     confirmed), Shelve it in a storage place (or move it), Hand it over (the buyer inspects it first: They accept it,
     then their 6-digit code; They refuse it, with why, confirmed), Post an update, the seller's dispatch photos (read
     through the site's own server, `app/api/centres/[id]/orders/[order]/photos/[photo]/route.ts`, from the API's
     `GET …/orders/:order/dispatch-photos/:photo`) and the item's timeline. The Overview shows today's counts from `GET
     /v1/connect/centres/:centre/orders/summary` (on their way, to shelve, ready, due today, overdue). Scanning a label's
     QR code is the phone's own camera app reading the order number into Find. Tests:
     `apps/udozo-connect/test/centres.test.ts`, `centre-screens.test.tsx`, `counter-photos.test.ts`.
   - **5d, udozo.com (built before 5c, so a Connect order works end to end):**
     - **Checkout:** Buy with UdozoPay offers **Collect at a Udozo Connect Centre** (`SafePayRequest` in
       `components/safe-pay.tsx`): the state, its centres with their address and hours, that state's shipping charge,
       the Connect fee and the free time to collect (`free_hours` on the quote). The request sends `connect_centre_id`.
     - **The order** (`lib/shop.ts` `orderActions`, `orderNext`, `orderSteps`; `order-detail.tsx`, `order-panel.tsx`):
       the buyer's release code from paid until collected, never Received at home; the seller's Get it to <centre> (I
       will drop it off myself, or a courier; dispatch photos first); the steps Sent to the centre, Received at the
       centre, Ready to collect, Inspected and collected; Where you collect it or Where it goes (the centre's address,
       hours, phone, free until); and the centre's events on the timeline (`shipmentLabels`, status `at_centre`).
     - **The parcel label** (`/account/orders/<id>/label`, `lib/connect-label.ts`): the seller prints it for a paid or
       sent Connect order. It carries the order number, its QR code (`SP-000123 CC-000001`, which connect.udozo.com's
       Find reads) and the centre, never the buyer's details.
     - Tests: `apps/udozo/test/connect-orders.test.ts`.
   - **5c, returns to sellers (built):** migration `20270310200000_connect_returns` (`connect_return_requests`, numbered
     **`RT-000123`**: `RR-` was already resale store reports; and the market's `return_due_days` 7, `return_answer_hours`
     48 and `seller_collect_days` 7, set with the Connect fee). `ConnectReturnsService`:
     - **Asking:** a centre asks for a return (`POST /v1/connect/centres/:centre/orders/:order/return { reason, note }`):
       `not_collected` from the due days after it was ready, or `refused_at_check_in`, `refused_at_counter` or `damaged`
       once Udozo decided the dispute for the buyer (`return_not_due` otherwise; one per order, `return_exists`). An item
       refused at check-in now counts as received, as it is at the centre.
     - **Answering:** the seller accepts (`POST /v1/classifieds/orders/:id/return/accept`), operations approve
       (`POST /v1/admin/connect/returns/:id/approve`, audited `connect_return.approved`), or the `classifieds` job accepts
       it after the hours (`decided_by: auto`, everyone told it was because nobody answered); claimed once
       (`return_decided`).
     - **Settling an item not collected:** the buyer gets the price back, the seller keeps the shipping, UdozoPay keeps the
       buyer's fee, and the Connect fee is shared (`SafePayService.settleNotCollected`, order refunded, `end_reason:
       not_collected`).
     - **Collecting:** the seller reads their 6-digit return code (`GET /v1/classifieds/orders/:id/return-code`), and the
       centre hands it back (`POST /v1/connect/centres/:centre/returns/:id/hand-back { code }`, 5 tries), taking the
       centre's Connect fee on the shipping as the return fee from the seller's Udozo money, else their wallet
       (`return_fee_unpaid`, 402, without enough), shared 70:30.
     - **Screens:** connect.udozo.com's Returns (`/centre/<id>/returns`, hand back against the code) and Return it to the
       seller on an item; udozo.com's return panel on the order (Accept the return, Show my return code); admin Connect >
       Returns and the return times on States, deposit and fee.
     - **Notices:** `customer.connect.return`, `admin.connect.return`.
     - **Not built yet:** shipping a return to a Connect Centre near the seller (they collect it at this one for now).
     - Tests: `apps/udozo-api/test/connect-returns.test.mjs`, `apps/udozo-connect/test/`, `apps/udozo/test/connect-orders.test.ts`,
       `apps/udozo-admin/test/connect.test.tsx`.
   - **5e, demurrage and Loss of care (built):** migration `20270310300000_connect_demurrage` (the market's
     `demurrage_bps` 210, `loc_penalty_bps` 210 and `loc_penalty_cap_minor` 50000, set with the Connect fee;
     `connect_return_requests.loss_of_care_at`; `connect_charges`, one row per order, payer, kind and day, `owed` or
     `paid`). `ConnectChargesService`:
     - **Accruing** (`accrue`, the `classifieds` job's `connect_storage`): each full day past the free time is charged once
       (`createMany` with `skipDuplicates`, at most 120 days an order a run): the buyer's demurrage on an item at the
       centre past `collect_by`; the seller's on an accepted return past its `collect_by`, which puts it into **Loss of
       care** (`loss_of_care_at`, the seller and admins told once) with a daily penalty beside the demurrage. Demurrage is
       2.1% of the shipping charge (`demurrageOf`, no cap), the penalty the same capped at ₦500 a day (`penaltyOf`).
     - **Paying:** the buyer pays from their wallet (`POST /v1/classifieds/orders/:id/storage/pay`, 402 without enough)
       before the centre takes their code (`storage_unpaid`, 402, at the counter); an item never collected has it taken
       out of the refund (`settleNotCollected`). The seller's is taken from their Udozo money, else their wallet, before a
       return is handed back (`return_fee_unpaid` while owed), and while they owe any, Connect is not offered on their
       listings. Every payment is shared 70:30 with the centre (`connect_charge:<id>`).
     - **Shown:** the order's `connect.storage_owed` and `loss_of_care_at` (udozo.com's **Pay storage**, and Loss of care
       on the seller's order), the counter's `buyer_owed`, `seller_owed` and `loss_of_care_at` (connect.udozo.com says the
       storage is owed before the hand-over, and that a return is in Loss of care), and the three rates on admin Connect >
       States, deposit and fee.
     - Tests: `apps/udozo-api/test/connect-storage.test.mjs`, `apps/udozo-connect/test/centre-screens.test.tsx`,
       `apps/udozo/test/connect-orders.test.ts`, `apps/udozo-admin/test/connect.test.tsx`.
   - **5f, stock checks and earnings (built):** migration `20270310400000_connect_stock_checks`
     (`connect_stock_checks` with their `connect_stock_check_items`; `classified_orders.connect_missing_at` and
     `connect_seen_at`). `ConnectStockService`:
     - **What should be there** (`GET /v1/connect/centres/:centre/stock`, any of its people): every item received and not
       handed over (at the centre, with Udozo after a refusal, or refunded and kept for its seller until collected,
       `atCentreWhere`), grouped by storage place, those on none last, each with when it was last found and whether it is
       missing.
     - **A check** (`POST …/stock-checks { shelf_id?, found, note? }`, one storage place or the whole centre; `GET
       …/stock-checks` the latest 30): what was found is marked seen; what was not is flagged missing at once
       (`connect_missing_at`, admins told `admin.connect.missing` once a check, linking to Connect > Missing items);
       `nothing_to_check` when nothing should be there, `parameter_invalid` for an item the check does not list. A flag
       clears when a later check finds it, or when it is handed over or collected by its seller.
     - **Earnings** (`GET …/earnings`, the owner only, `centre_role_required` otherwise): the partner's
       `connect_centre_earnings` per mode and currency, what is still inside the market's payout hold (credits in the
       last `payout_hold_days`), what can move, the latest 50 lines, and the centre's items handed over and Connect fees
       earned. **Move to my payouts** (`POST …/earnings/move { mode, currency, amount }`, the accounts locked, 402
       `insufficient_funds` past what can move) is one `connect_earnings_move` entry into their `customer_withdrawable`,
       which udozo.com's Payouts (`/account/payouts`) pays to their bank like UdozoPay money.
     - **Screens:** connect.udozo.com's **Stock check** (`/centre/<id>/stock`: each storage place's items to tick, Save the
       check confirming how many are not ticked, the latest checks) and the owner's **Earnings** (`/centre/<id>/earnings`,
       in the menu only for the owner); admin Connect > **Missing items** (`/connect/missing`, support and operations).
     - Tests: `apps/udozo-api/test/connect-stock.test.mjs`, `apps/udozo-connect/test/centres.test.ts`,
       `apps/udozo-connect/test/centre-screens.test.tsx`, `apps/udozo-admin/test/connect.test.tsx`.
6. **Reports and alerts** (**built**): what each centre holds and its overdue items, uncollected rates, and seller and
   centre problems. As built (`ConnectReportsService` in `apps/udozo-api/src/classifieds/connect-reports.service.ts`, no
   migration):
   - **The report** (`GET /v1/admin/connect/report?country&days=7|30|90|365`, support, operations and finance): now,
     what every centre holds (`heldWhere`: received and not handed over), past its free time, missing, in Loss of care
     and arriving late (sent more than `lateArrivalDays`, 7, ago and not checked in); over the period, Connect orders,
     items handed over, never collected (`not_collected` returns), refused at check-in and at the counter, returns
     collected and the uncollected share (not collected against handed over plus not collected); per currency the
     Connect fees on items handed over, the centres' and Udozo's shares and storage paid by buyers and sellers; each
     centre with the same figures and its **flags** (items missing, full, often not collected from `uncollectedFlagPct`
     20% of at least `uncollectedFlagFrom` 5 tries, Loss of care, arriving late, past their free time, paused, closed),
     those needing attention first; and the 20 sellers with most items refused at check-in or damaged (with storage
     they owe) and the buyers who did not collect or refused at the counter twice or more.
   - **What one centre holds** (`GET /v1/admin/connect/centres/:id/items`): each item with its storage place, past its
     free time, missing, its return and Loss of care, and storage owed.
   - **Alerts** (`alerts`, the `classifieds` job's `connect_alerts`, each keyed by its day, week or item so it is sent
     once): a centre's owner and managers (`customer.connect.centre`) when it is full, what is due to be collected
     today and what is past its free time (daily), and each item arriving late; Udozo's team (`admin.connect.alert`)
     of full centres (daily), late items (once each) and centres whose buyers often never collect (weekly).
   - **Screens:** admin Connect > **Reports** (`/connect/reports`: the period, four figures, the money, every centre
     with its flags, sellers and buyers) and **What it holds** on each centre's page.
   - Tests: `apps/udozo-api/test/connect-reports.test.mjs`, `apps/udozo-admin/test/connect.test.tsx`.
7. **Warehouses, pickups and auctions**: Udozo's warehouses and Final Return Addresses, pickups from centres, Udozo
   auctions on udozo.com, and auction claims. Built in slices:
   - **7a, warehouses, abandonment and pickups (built):** migration `20270310600000_connect_warehouses`
     (`connect_warehouses`; `connect_centres.fra_warehouse_id`; the market's `abandoned_after_days` 30,
     `auction_after_days` 90 and `claim_days` 90, set with the Connect fee; `connect_return_requests.abandoned_at`;
     `classified_orders.connect_place`, `connect_warehouse_id`, `connect_with_udozo_at`, `warehouse_received_at`;
     `connect_pickups`, numbered **`PU-000123`**, and `connect_pickup_items`). `ConnectWarehousesService`:
     - **Warehouses** (`GET|POST /v1/admin/connect/warehouses`, `PATCH …/:id`, operations, support reads; audited
       `connect_warehouse.created|updated`): name, address, state, hours, phone, contact, open or closed. None is seeded:
       operations add the first, in Lagos, and set each centre's **Final Return Address** (`PUT
       /v1/admin/connect/centres/:id/final-return-address { warehouse_id }`, an open warehouse of its country, audited
       `connect_centre.fra_set`).
     - **Abandoned** (`abandon`, the `classifieds` job's `connect_abandoned`): an accepted return the market's days into
       Loss of care, claimed once (`abandoned_at`), the item `connect_place: awaiting_pickup`; seller, centre and admins
       told. **Order statuses are unchanged:** where an abandoned item is lives on `connect_place` (`awaiting_pickup`,
       `in_transit`, `udozo_warehouse`, `auctioned`) beside the order's own status.
     - **Pickups** (`POST /v1/admin/connect/pickups { centre_id, day, collector, note? }`, operations; `fra_missing`
       without a Final Return Address, `nothing_to_pick_up` with nothing abandoned there): every abandoned item at the
       centre not on another pickup, to its Final Return Address, with **one sealed 6-digit pickup code per pickup**
       that Udozo's collector gives the centre (admins see it while it is scheduled; the centre never does). The centre
       ticks what it gives the collector and enters the code (`POST /v1/connect/centres/:centre/pickups/:id/hand-over
       { code, order_ids }`, 5 tries): those items are `in_transit`, off the centre's shelves and stock, their storage
       from then on all Udozo's (`connect_with_udozo_at`); unticked ones stay for the next pickup. Operations check them
       in at the warehouse (`…/pickups/:id/receive { order_ids, missing? }`: `udozo_warehouse`, or flagged missing), the
       pickup then `delivered`; or cancel a pickup not collected (`…/cancel { reason }`). All audited.
     - **Still the seller's to collect:** at the centre while it waits for the pickup (a pickup then goes without it),
       at the warehouse once there (`POST /v1/admin/connect/returns/:id/hand-back { code }`, operations, the seller's
       return code; the return fee then all Udozo's), never at the centre once Udozo has it (`with_udozo`); storage owed
       first, as before. The order's `connect.return` carries `abandoned_at`, `place` and the `warehouse` holding it.
     - **Not built:** check-out photos at the hand-over (a handover record and the code stand in for now).
     - **Screens:** admin Connect > **Pickups** (`/connect/pickups`: waiting at centres with Schedule a pickup, pickups
       with their code, Check in at the warehouse, what the warehouses hold with Hand back to the seller), **Warehouses**
       (`/connect/warehouses`), the Final Return Address on each centre's page and the three day settings;
       connect.udozo.com's **Pickups** (`/centre/<id>/pickups`: the Final Return Address, the next pickup, Hand over);
       udozo.com's return panel says where an abandoned item is and where to collect it (`placeWords`).
     - Tests: `apps/udozo-api/test/connect-warehouses.test.mjs`, `apps/udozo-admin/test/connect.test.tsx`,
       `apps/udozo-connect/test/centres.test.ts`, `apps/udozo-connect/test/centre-screens.test.tsx`,
       `apps/udozo/test/connect-orders.test.ts`.
   - **7b (next):** Udozo auctions on udozo.com.
   - **7c:** claims, and unclaimed money becoming Udozo's.

Each phase is behind the switch `connect_shipping` (Udozo's own, global or per country, **off by default**), with
tests in the API, the site and the admin, as the other Udozo plans are. Applications can open before shipping does, so
centres are ready on the day it switches on. Within a market, every state is open until an admin switches it off
(`connect_states`).

## Legal owed before it opens

- **Terms:** a new Connect section covering what a centre does and does not do, the 72 free hours, demurrage, returns
  due at 7 days, Loss of care (the centre no longer liable, daily demurrage with no cap, and the daily penalty of 2.1% of the
  shipping charge capped at ₦500; the centre still responsible for the item), abandonment at 30 days, Udozo's pickup to a
  Udozo warehouse, auction from 90 days on udozo.com (with Udozo
  auctions' own terms), and claiming what is left over within 90 days, damage
  and loss while an item is at a centre, inspection, and prohibited items for centres. Lawyers to confirm the
  Loss of care penalty and the end of liability are enforceable in each market.
- **Connect Centre agreement** (accepted when applying, recorded by version): custody of items, liability for loss and
  damage, the deposit (what it covers and when it is returned), the centre's 70% of Connect fees, demurrage and penalties, and payouts, staff, keeping buyers' details private, pausing and closing.
- **Privacy notice:**
  - what an application keeps (the business, the office's photos, the identity check);
  - the buyer's name, phone and order shown to centre staff;
  - check-in photos;
  - how long each is kept.
- **The name:** a trademark check for "UdozoPay" and "Udozo Connect" in each market, and lawyers' confirmation that
  holding payments through licensed partners still covers UdozoPay.

## Open questions for the owner

None open. To set before Connect opens in Nigeria (all admin settings): the Connect fee's kind and amount, the
deposit, the return rate where a listing has no charge for a state, and every time and rate above.
(Answered on 9 November 2026: demurrage 2.1% of the shipping charge daily, no cap, the same for buyer and seller; the
seller's 7 free days counted from acceptance, admin approval or automatic acceptance, demurrage after them; the split
70% centre, 30% Udozo; the Loss of care penalty 2.1% of the shipping charge, capped at ₦500 a day; abandoned at 30
days, Udozo picking it up to the centre's Final Return Address (a Udozo warehouse), auctioned from 90 days on udozo.com,
what is left over the seller's on a claim request within 90 days of the sale, unclaimed money Udozo's; the first
warehouse in Lagos; Loss of care ends the centre's liability,
not its responsibility. Also: the seller gets the item to the centre; the seller sets a shipping charge per state;
the buyer inspects at the counter and can refuse; centres are approved
after an online review and a visit; home delivery deferred; applications from every state, admins switching states
off. And: the buyer pays shipping plus a Connect fee shared 70:30 between centre and Udozo; returns are collected at the
centre or shipped to a centre near the seller, every return shipping fee the seller's; lawyers confirm auctions and
unclaimed money; Udozo pays for pickups; visits by Udozo's staff or trained agents. Last: the Connect fee a percentage of shipping or a
fixed amount, as admins choose per market; the seller bears every return fee; centres pay a deposit.)
