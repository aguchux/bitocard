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
| Ready | Udozo | The buyer is told by inbox, push, email and, where switched on, WhatsApp, with the centre's address, hours, the 72 hours they have to collect free, and the demurrage after them |
| Collected | centre | The buyer pays any demurrage due, then shows their 6-digit release code; staff enter it (5 tries) and hand the item over; UdozoPay pays the seller as on release today, and the centre its fee |
| Not collected | centre | Daily demurrage from 72 hours after Ready; at 7 days the return to the seller is due and the centre requests it (see Return requests below) |
| Returned | seller | Once the return is accepted, the seller collects it with their return code and the trade is settled |

- **Order statuses:** the existing ones plus `at_centre` and `returning`. Each step is a shipment event with `reported_by: 'centre'`.
- **Concurrency:** each step claims the order in one conditional update, as Safe pay's steps do.
- **Inspection at collection:** whether the buyer can refuse the item at the counter is an open question.
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
  - the seller gets a 6-digit **return code** and collects the item at the centre; staff enter or scan it on the
    Release screen, marked as a return;
  - the order moves to `returning`, then, once collected, settles as the reason requires: refunded to the buyer for an
    item refused at check-in or damaged; for one the buyer did not collect, refunded less the buyer's demurrage (and
    what else the open questions decide).
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
  is told before it is listed. What the sale raises pays what is owed (demurrage, penalties, and the cost of the
  auction and moving it).
- **What is left over is the seller's, but only on a claim:** the seller files a **claim request** (on the order page;
  `connect_auction_claims`), Udozo's finance checks it and pays the rest into the seller's UdozoPay earnings, audited.
  Without a claim nothing is paid out (how long a seller has to claim is an open question below).
- Each step is in the order's timeline and Udozo's audit log, and is claimed once by the `classifieds` job.

**Who receives it:** demurrage and Loss of care penalties are split between the **Connect Centre** that holds the item
and **Udozo**, **70% to the centre and 30% to Udozo** by default (`centre_share_bps`, default 7,000; Udozo has the
rest). The centre's share goes to its earnings, and Udozo's to `connect_revenue`.

**Taking the money:** the buyer's demurrage is paid before collection. The seller's demurrage and penalties come out of
what UdozoPay owes them, else their wallet, else they are owed and must be paid before the seller trades through
Connect again. Each day's charge is its own ledger entry (`connect_demurrage:<order>:<day>`), so it is charged once.

**Udozo warehouses and Final Return Addresses (FRA):**
- **Udozo runs its own warehouses** (`connect_warehouses`: address, state, hours, contact; admin Connect >
  **Warehouses**, operations).
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

- **Paid in:** the buyer pays price + shipping + the UdozoPay buyer fee.
- **Paid out on collection:** the seller gets the price and the shipping, less the UdozoPay seller fee and any Connect
  fee. The centre gets its handling fee into its earnings, paid to its bank through the customer payouts.
- **Connect fee:** how much the centre's fee is and who pays it are open questions.
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

- **Terms:** a new Connect section covering what a centre does and does not do, the 72 free hours, demurrage, returns
  due at 7 days, Loss of care (the centre no longer liable, daily demurrage with no cap, and the daily penalty of 2.1% of the
  shipping charge capped at ₦500; the centre still responsible for the item), abandonment at 30 days, Udozo's pickup to a
  Udozo warehouse, auction from 90 days, and claiming what is left over, damage
  and loss while an item is at a centre, inspection, and prohibited items for centres. Lawyers to confirm the
  Loss of care penalty and the end of liability are enforceable in each market.
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
5. **Uncollected items** (answered: 72 hours free, then daily demurrage, the return due at 7 days; still open, see 10 and 11).
6. **Approving centres:** is the online review enough, or does Udozo visit an office (or ask for a video tour) before
   approving it? Does a centre pay a deposit or need insurance?
7. **Home delivery:** does it stay alongside Connect, or does Connect replace it?
8. **First market:** Nigeria only, and which cities should take applications first?
9. **Returns, still open:** can the seller ask the centre to send a return by courier instead, and who pays?
   (Answered: the seller accepts or an admin approves, auto-accepted after 48 hours, everyone told; 7 days to collect,
   then Loss of care.)
10. **Auction claims:** how long a seller has to file a claim for what is left over after an auction (for example 90
    days), and what happens to it if they never do. Does the auction run on udozo.com or elsewhere? Lawyers must
    confirm selling abandoned goods is allowed in each market, and what notice the seller must be given.
11. **Warehouses:** where the first one is, and the cost of pickups: is it part of what the auction recovers, or also
    charged to the seller who collects from the warehouse?
(Answered on 9 November 2026: demurrage 2.1% of the shipping charge daily, no cap, the same for buyer and seller; the
seller's 7 free days counted from acceptance, admin approval or automatic acceptance, demurrage after them; the split
70% centre, 30% Udozo; the Loss of care penalty 2.1% of the shipping charge, capped at ₦500 a day; abandoned at 30
days, Udozo picking it up to the centre's Final Return Address (a Udozo warehouse), auctioned from 90 days, what is left
over the seller's on a claim request; Loss of care ends the centre's liability, not its responsibility.)
