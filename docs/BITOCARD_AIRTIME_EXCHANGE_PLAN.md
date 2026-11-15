# Airtime exchange: buy and sell unused airtime (plan, 15 November 2026)

**Status:** built 15 November 2026 as option B (a desk, phases 1 and 2); see **As built** and **Still open** at the end. Local only, not deployed; behind `airtime_exchange`, off.

## What the owner asked

1. On the Mobile catalogue page, split **Quick top-up** into four tiles: **Buy airtime**, **Buy data**, **Sell unused airtime**, **Buy unused airtime**.
2. **A P2P market for unused airtime:**
   - A buyer posts a request for cheap airtime, and BitoCard locks the buyer's money.
   - A member with unused airtime accepts and transfers it to BitoCard's **collector number** on that network.
   - BitoCard checks it arrived, sends it on to the buyer from its own line, and releases the money to the seller's wallet.
   - Each trade finishes within **one hour**.

## Part 1: the four tiles (small, safe, can go first)

| Tile | Goes to | Notes |
|---|---|---|
| Buy airtime | `/account/topup?kind=airtime` | the existing Quick top-up (`app/(app)/account/topup`), opened on airtime |
| Buy data | `/account/topup?kind=data` | the same page, opened on data bundles |
| Sell unused airtime | `/account/airtime/sell` | marked **Soon** until Part 2 is live in the customer's market |
| Buy unused airtime | `/account/airtime/buy` | marked **Soon** likewise |

- **Layout:** a 2 × 2 grid on phones and four across from `lg`, each tile with its icon. This replaces the single navy band in `app/(app)/account/catalog/page.tsx` (`group === "mobile"`).
- **Gating:** the two exchange tiles follow a new switch, `airtime_exchange` (global or country, off by default). They show Soon, never a dead link, while it is off.

## Part 2: can the exchange work? What the networks allow

| Network (Nigeria) | Service | What third-party guides report (unconfirmed by the operators) |
|---|---|---|
| MTN | Share 'n Sell, `*600#` / `*777#` | a PIN (default 0000) to set first; ₦50 to ₦5,000 a transfer; about ₦50,000 a day (guides range from ₦10,000 to ₦500,000); free or up to ₦10 a transfer |
| Airtel | Me2U, `*432#` | ₦50 to ₦5,000 a transfer; about ₦50,000 a day, said to depend on the line's history |
| Glo | Easy Share / Me2U, `*131#` | no reliable cap found |
| 9mobile | Transfer, `*223#` | ₦10 fee; very high limits reported (doubtful) |

**What this means for the design**

1. **Same network only.** Every transfer service works only between lines of one network. BitoCard needs at least one collector line per network, and the same line (or another of that network) sends the airtime on to the buyer.
2. **Daily limits cap throughput.** At about ₦50,000 a day sent per line, one line can resend only about ₦50,000 a day to buyers. Volume therefore needs a **pool of lines per network**, plus records of what each line received and sent today. Received amounts may be capped too; that has to be confirmed with each operator.
3. **Manual sending does not scale.** Each resend is a USSD session with a PIN, typed on a phone. Automating it (Android USSD automation) is fragile and very likely outside the operators' terms.
4. **The market exists already.** Airtime-to-cash platforms (AirtimeFlip, Gosub, Recharge2Cash and others) buy airtime at about 75% to 90% of face value. Some take it by manual transfer to their number, others by an OTP flow that debits the line. So sellers already have an outside price, and BitoCard's buying price must compete with it.
5. **Buyers already get cheap airtime.** BitoCard sells airtime through VTpass at face value less the operators' commission, about 3% to 4% (`VTPASS_COMMISSIONS`). "Cheap unused airtime" only makes sense if it is clearly cheaper than that: at least about 8% to 10% off face value.

**Rough economics, per ₦1,000 of airtime**

- The seller gets ₦800 (competitive with airtime-to-cash).
- The buyer pays ₦880 (12% off; clearly better than a normal top-up).
- BitoCard keeps ₦80 gross, and pays from it: staff time for checks and resends, transfer fees (up to ₦10 a transfer), lines and phones, and **fraud losses**.

It can pay, but the margin is thin, and fraud decides whether it does.

## The blockers and risks

### 1. Operators' terms and line barring (the biggest commercial risk)

- **Personal use only?** Prepaid lines are sold for personal use, and transfer services are meant for friends and family. A line receiving and sending hundreds of transfers a day looks like an unlicensed reseller or a fraud mule, and operators can bar it, possibly with its balance on it.
- **Reversals:** operators can reverse transfers from a line reported stolen. The NCC's rules let a customer ask for airtime back if it was used after they reported the SIM stolen.
- **Recommendation:** before building, ask MTN, Airtel, Glo and 9mobile in writing about commercial use of P2P transfer for a registered business. Use **corporate lines in Golojan's name**. The clean route is the operators' **dealer or bulk-airtime agreements**, or a licensed VAS aggregator. Several airtime-to-cash firms reportedly work with aggregators that debit the seller's line through an OTP, instead of using phone transfers.

### 2. Fraud: stolen or dirty airtime (the biggest money risk)

**Where bad airtime comes from**

- **Stolen phones and SIM swaps:** the airtime is drained to us, then the victim reports the SIM and the operator reverses it.
- **Card fraud:** airtime bought with stolen cards and laundered through us, which is the same reason airtime-to-cash services are attractive to fraudsters.
- **Borrowed airtime:** airtime lending is an operator loan, and its rules changed in April 2026, when lending was suspended and partly restored by late May. A transfer of borrowed airtime may be refused or reversed.

**Controls**

- **Only the seller's own line sells.** A seller sends only from a mobile number confirmed on their BitoCard account (an SMS code). The collector's "received from 0803…" message must name that number, or the trade fails.
- **Credit the spend-only wallet.** Credit the seller's `customer_wallet`, never withdrawable cash. It cannot be cashed out, which removes most of the reason to launder through us. Any later cash-out is a separate decision with a payout hold.
- **A hold before the credit is spendable** (for example 24 hours, then released by a job), so a reversal within that time costs us nothing. This is longer than the one hour the owner suggested. The buyer's side can still finish within an hour.
- **Limits:**
  - new sellers: low daily and per-trade limits;
  - every seller: a passed identity check above a threshold;
  - a line may sell at most N times a day;
  - strikes for "sent" claims that never arrived.
- **Records:** each collector line's balance is reconciled daily against what our records say it holds.

### 3. Checking receipt: from manual to automatic

- **Manual at first:** staff read the collector phones' SMS and press **Received** in the admin app. It is slow, error-prone, and stops outside staffed hours.
- **Recommended:** an **SMS forwarder on each collector phone.** This is an Android app, ours or an off-the-shelf SMS gateway, that sends each operator SMS ("You have received ₦1,000 from 23480…") to a signed API webhook.
- **Matching:** the API matches each SMS to the open trade by **network, sender number, amount and time**. A match completes the receipt step with no person involved; anything else goes to an exceptions queue.
- **Checking balances** by USSD stays manual, as part of daily reconciliation.

### 4. Sending to the buyer

- **Manual sending** is the weakest link: limits, PINs, human error, and staffed hours.
- **Better: buyers get their airtime from BitoCard's normal suppliers.** The buyer is served through VTpass or Reloadly as any top-up, at a discount BitoCard funds from the spread, so there is no resend from a phone at all. The airtime collected from sellers then has to be used up some other way, with these options:
  - (a) staff calls, SMS and data for operations (small);
  - (b) resale through an aggregator that buys bulk airtime;
  - (c) still resending to buyers, but only from a capped pool.
- **This separates the two sides.** BitoCard becomes an **airtime desk**: it buys from sellers at a posted rate and sells cheap airtime from stock. Buyers no longer wait for a matching seller, and the one-hour promise is easy to keep. **I recommend the desk over request matching** (below).

### 5. Regulation and legal (lawyers' review before the switch goes on)

- **CBN:** is taking airtime in exchange for wallet value a payment or e-money activity? Airtime used as a store of value is a recurring CBN and NCC topic, and the 2026 CBN–NCC draft framework on airtime and data transactions should be read.
- **NCC:** reselling airtime commercially may need an operator dealership or a VAS licence.
- **Tax:** VAT on BitoCard's margin. VAT was already charged when the airtime was first sold.
- **AML:** this is a known laundering channel, so identity checks and monitoring above thresholds, and record keeping.
- **Terms:** new sections in the terms of use: who may sell, sending only from one's own line, holds, reversals, what happens to airtime sent to the wrong number or network (lost), and limits. The privacy notice must cover sellers' numbers and the SMS records.

### 6. Number portability and the wrong network

A number's prefix no longer tells its network, because ported numbers keep it. Both sides choose the network explicitly. Airtime sent to the wrong collector, or on the wrong network, may be lost; the screens say so before sending, and we show the right collector number for the chosen network only.

## Two ways to run it

| | **A. Request matching (as asked)** | **B. Airtime desk (recommended)** |
|---|---|---|
| Buyer | posts a request; money locked; waits for a seller | buys at once at the posted discount, if stock or the supplier allows |
| Seller | accepts a buyer's request; sends within the window | sells any time at the posted rate (like **Sell gift cards**) |
| Waiting | up to an hour for a counterparty, then refund | none on the buyer's side; the seller waits only for the receipt check |
| Pricing | per request (needs price rules and limits) | admins post a buy rate and a sell rate per network |
| Matching and disputes | buyer, seller and BitoCard all involved | seller and BitoCard only |
| Who holds the airtime | passes straight through (sent on at once) | BitoCard holds stock per network |
| Fits existing code | a new escrow flow | close to gift card selling (`src/gift-card-sales`) plus the normal top-up checkout |

**Recommendation: B, built in phases.**

1. **Phase 1, Sell unused airtime** (Nigeria; MTN and Airtel first, the largest; Glo and 9mobile after):
   - the seller picks the network and amount, confirms their line, and is shown the collector number and BitoCard's rate;
   - they send by USSD (the steps shown) and press **I've sent it**;
   - the SMS forwarder (or staff) matches it, and the seller's wallet is credited at the rate after the hold;
   - every trade is closed or refunded within one hour of **I've sent it**, or goes to exceptions.
2. **Phase 2, Buy unused airtime:**
   - a discounted top-up at the posted price, delivered through the normal suppliers (no waiting) while the margin covers it;
   - or sent from the collector stock where the line's daily limits allow, with suppliers as the fallback.
3. **Phase 3, only if needed:** buyers' requests at their own price (option A), once volume and fraud data justify it.

## As built (15 November 2026)

The owner chose B (the desk), sellers 80% and buyers 88%, the pool shown to everyone in exact amounts, and several collector lines per network for the limits. Phases 1 and 2 are built; phase 3 (request matching) is not.

| Planned | Built |
|---|---|
| `src/airtime-exchange`, `airtime_trades` (`AT-`) | `src/airtime`; `airtime_sales` (`AS-`) for sellers and `airtime_purchases` (`AP-`) for buyers |
| Buyers served by VTpass or Reloadly at a funded discount | Buyers are sent airtime **from the collector lines by staff** (claim, then mark sent), from a pool kept per network; no supplier fallback |
| A held-credit lot | `airtime_payable` until the hold ends, then the seller's `customer_wallet` (the `airtime` job, every 5 minutes) |
| Margin when used up or resold | On delivery: the pool's average cost out of `airtime_inventory`, the rest of the price `platform_revenue` |
| Reversal debits the seller back, else a loss | Reversal only **inside the hold** (nothing was paid); refused while the pool has promised the airtime |
| `airtime_sms` and the forwarder's webhook | **Not built**: staff mark transfers received or not |
| Orders > Sold airtime | `/account/airtime` lists the customer's sales and purchases |

**Customers' numbers** (added the same day at the owner's request): a customer keeps up to five confirmed mobile numbers (`customer_phones`, migration `20270206000000_customer_phones`), each confirmed by a texted code, one the default (`customers.phone`). Selling takes `from_phone`, one of the seller's confirmed numbers (their default when left out); buying sends only to one of the buyer's confirmed numbers (`phone_not_verified` otherwise). The sell form, the sale page and the terms say plainly that airtime sent from any other number is not refunded, is lost and cannot be claimed.

**Seller controls** (built the same day, the owner's go; migration `20270206100000_airtime_seller_controls`):

- **New sellers:** each network has a lower daily limit for new sellers (`new_seller_daily`, ₦5,000 to start) until `established_after` (3) of their sales are complete (credited); finance sets both with the rates.
- **Strikes:** a sale the seller said they sent but staff marked not received, or a transfer the network reversed, is a strike (`airtime_sales.struck_at`). Three in 90 days pause the seller's selling (`selling_paused`); the seller and operations are told once.
- **Clearing:** operations clear the strikes with a reason, audited as `airtime.strikes_cleared` (`POST /v1/admin/airtime/sellers/:customer/clear`, `airtime_seller_standings`). The admin app's Sales tab shows strikes, Selling paused and New seller; the sell page shows the seller's limit, their strikes, or that selling is paused.

**Fixed in review:**

- A transfer that arrives after its sale's hour can still be marked received (Arrived late in the admin app), so the seller is not left unpaid when we hold the airtime.
- Taking a purchase to send checks that the line holds the airtime and can still send that much today (`line_short`, `line_limit`), and the admin app only offers such lines.
- Purchases taken to send but not sent within the hour are flagged to operations (they used to be flagged only for sales).

## Still open

**Before the switch goes on**

- **Each network's written view** on commercial use of transfers, since lines may be barred.
- **Lawyers' review** (CBN, NCC, AML), and the terms of use section 5a, as drafted.
- **Phones and corporate SIMs** in Golojan's name, and a staff runbook.

**Controls in the plan not built yet**

- **Limits:** there is no identity check above a threshold, and no limit on how many sales a day (only on amounts).
- **No daily line reconciliation report.** Balances are corrected by hand, with a reason.
- **Reversals after the seller was credited:** there is no path to take the money back. This is recorded today as an adjustment by finance.
- **The pool counts all lines together.** A buyer can buy more than any single line holds; staff then refund within the hour.
- **The SMS forwarder** for automatic matching.

## Sources (third-party guides; the operators' own limits must be confirmed)

- MTN Share 'n Sell limits and fees: https://blog-en.doctorsim.com/2026/04/30/how-to-transfer-airtime-on-mtn/ , https://www.legit.ng/1152570-how-transfer-airtime-mtn-mtn.html , https://vtpass.com/blog/how-to-transfer-airtime-from-mtn-to-mtn-in-2026/
- Airtel Me2U: https://www.androidpols.com.ng/2026/01/code-to-transfer-airtime-on-airtel-2026.html
- Airtime lending suspended, April 2026: https://nairametrics.com/2026/04/17/airtel-nigeria-suspends-airtime-data-credit-services-amid-new-lending-rules/
- Airtime-to-cash rates and verification: https://airtimeflip.com/help/airtime-conversion-faq , https://www.zikoko.com/?p=333490 , https://blog.gosub.ng/best-airtime-to-cash-platforms-nigeria
- Stolen SIMs and devices (NCC): https://gazettengr.com/ncc-to-block-cloned-counterfeit-phones-from-nigerian-mobile-networks-registers-231-million-devices/ , https://technext24.com/investigative-report/nigeria-phone-theft-bank-fraud/
