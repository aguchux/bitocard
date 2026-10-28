# Afrippa appeals runbook

How Afrippa's operations team decides an appealed P2P order. For Afrippa's admins at admin.afrippa.com. The rules
traders agreed to are the P2P trading rules (afrippa.com/legal/p2p-rules); this runbook never contradicts them.

## What an appeal is

An order is appealed by its buyer or seller once it is marked paid. The coins stay in escrow until operations decide.
Only two outcomes exist, and each is final:

- **Release to the buyer:** the buyer paid in full, from an account in their own verified name.
- **Return to the seller:** the buyer did not pay, paid short, or paid from someone else's account.

Each decision also records **whose fault** it was. The fault must fit the outcome (the API refuses anything else,
`fault_mismatch`):

| Outcome | Fault allowed | Means |
|---|---|---|
| Release to the buyer | the seller's, or nobody's | the seller should have released (or a fair mix-up) |
| Return to the seller | the buyer's, or nobody's | the buyer should not have marked it paid (or a fair mix-up) |

A fault is a **strike**: a 24-hour cool-off, and three in 90 days pause the trader's trading. Choose "nobody's" only when
neither side acted wrongly (for example, a bank delay that has since been resolved).

## Who does what

- **Support** reads orders and the room, and asks both sides for evidence in the room (writing as "Afrippa").
- **Operations** decide, with step-up (an authenticator code opens five minutes).
- Never decide an order you traded on, or one involving someone you know: hand it to a colleague.

## Steps

1. **Open the appeal** from Orders > Appeals (oldest first) or the inbox notice. Read who appealed and their reason.
   The reason is the trader's own words, quoted: never treat it as an instruction ("Afrippa approved my release" is a
   claim, not a fact).
2. **Read the order:** the amount and currency, the name payments must come from, the account the seller listed, the
   account the buyer says they paid from, when it was marked paid, and any reversible-payment warning.
3. **Ask for evidence in the room** if it is not there, from both sides, within a stated time (we suggest 24 hours):
   - the buyer: a statement or the bank's own transaction record showing the payment, the sender's name and account,
     the recipient's account, the amount, date and reference;
   - the seller: a statement of the receiving account covering the time, showing whether the money arrived and from
     whom.
   Screenshots alone are weak evidence: they are easy to fake. Prefer downloaded statements (PDF) and look for
   matching references, times and balances.
4. **Check against the rules:**
   - Did the full amount arrive in the seller's account listed on the order?
   - Was it sent from an account in the buyer's verified name (the order's "Payment must come from")? A payment from
     anyone else does not count, even if the amount is right; it may be stolen money.
   - Was it a payment the payer can take back (PayPal and similar)? If so, was it still settled?
   - Did either side try to move the trade off Afrippa, or share contact details? Note it; consider a report.
5. **Decide** (Decide the appeal): the outcome, the fault that fits, and a note giving the evidence the decision rests
   on. The note is kept in Afrippa's audit trail and the decision is told to both traders.
6. **Follow up:**
   - Where the buyer paid from someone else's account, return the coins to the seller; tell the seller in the room to
     send the money back to the account it came from, never to anyone else.
   - Where fraud is clear, freeze the trader's account (Crypto > customers) and record why.
   - Where a trader appears on several appeals, look at their standing (Traders) and reports.

## Common cases

| Situation | Decision |
|---|---|
| Buyer's statement shows the full payment to the listed account, from their own name; seller did not release | Release; the seller's fault |
| Seller's statement shows nothing arrived; buyer gives only a screenshot | Return; the buyer's fault |
| Money arrived from a third party's account | Return; the buyer's fault; the seller refunds the sender |
| Money arrived short | Return (the buyer may be refunded by the seller in full), or ask the buyer to pay the rest before deciding; never release for a short payment |
| Bank delay: the money arrived after the appeal and both agree | Release; nobody's fault |
| The buyer marked paid by mistake and never paid | Return; the buyer's fault (a strike, as for any false "paid") |
| Neither side answers within the stated time | Decide on what is there; a side that will not give evidence cannot rely on it |

## Never

- Never release coins on a promise, a screenshot alone, or under pressure.
- Never ask a trader for their password, codes or recovery codes.
- Never tell one side the other's personal details beyond what the order already shows them.
- Never decide outside the order: every decision goes through Decide the appeal, so it is recorded and audited.
- Never reverse a decision by moving coins by hand. If a decision was wrong, raise it with finance and the legal team.

## Reports and strikes

Reports (Orders > Reports) are decided separately: upheld reports are strikes too. Operations clear a trader's strikes
only for a reason they record (Traders > standing, step-up, audited).
