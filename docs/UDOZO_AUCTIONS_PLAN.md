# Udozo auctions: a second way to sell

Decided 10 November 2026, the owner's request: "Auctions happen right in the udozo.com portal. Auction is another
sales method." Udozo Connect's phase 7b built auctions only for items abandoned at Connect Centres, on pages of their
own. This plan makes auction a way to sell any listing on udozo.com, beside a fixed price, and folds Udozo's own lots
into it.

## The owner's answers

- **Who:** any seller, wherever the market's switch allows it (`classifieds_auctions`, Udozo's, global or country,
  off by default).
- **Paying:** the winner pays with UdozoPay as a normal order at the winning bid (wallet, escrow, meet-up, delivery or
  a Connect Centre, fees, disputes: all as for a fixed-price sale). The seller committed by auctioning, so there is no
  seller's accept step.
- **Reserve:** a seller may set a hidden reserve price. Bidders see only "Reserve not met" until a bid reaches it;
  below it the lot does not sell.
- **Udozo's lots:** abandoned items become ordinary auction listings, sold by Udozo's own seller account in their
  market. The storage owed, the seller's claim to what is left over, and collection at the warehouse stay as built in
  Connect's 7b and 7c.

## Rules

- **A listing is sold one way:** `classified_listings.sale_method` is `fixed` (the default) or `auction`. An auction
  listing has one item (stock 1), a starting price (its `price_minor`), an optional reserve (at least the starting
  price) and a length (1, 3, 5, 7 or 10 days). It takes no offers, buy orders or fixed-price UdozoPay requests.
- **The lot** is a row in `connect_auctions` (kind `listing`), made when the listing goes live (`ListingsService.submit`
  or `ModerationService.approve`), opening then and ending its length later. The bidding steps, the late-bid extension
  and the time to pay are the market's (`auction_step_bps`, `auction_step_min_minor`, `auction_extend_minutes`,
  `auction_pay_hours`, set on Connect > Settings).
- **Bidding** is on the listing's page: a confirmed mobile, never the seller, each bid at least the next step. Once a
  lot has bids its price, reserve and length are fixed.
- **Ending:** the highest bid at or above the reserve is offered the item. The winner opens the listing's buy page,
  chooses how they get it, and the UdozoPay order is made at their bid, already accepted, to pay within the time to pay.
  Not paid in time, the order lapses and the next bidder at or above the reserve is offered it, at their own bid. With
  none, the lot is unsold and the listing expires (`expired_reason: auction_unsold`); renewing it starts a new lot.
- **The seller must be ready to accept UdozoPay** (the payout account, and the identity check where the market needs
  it) to post an auction.
- **Udozo's lots** (kind `abandoned`): listing an abandoned item at auction makes an auction listing in the item's
  market under Udozo's seller account there (one per market, made the first time), with the original listing's
  category, words and photos, collected at the warehouse only. Paying keeps Connect's own path: the storage owed is
  paid off, Udozo's costs taken, what is left over held for the seller's claim, and the buyer collects with a code.

## Slices

1. **API, sellers' auctions** (migration, `sale_method` on listings and their checks, lots made at going live, bids on
   listings, the winner's UdozoPay order, lapsing to the next bidder, unsold listings, presenters and the switch).
2. **udozo.com, sellers' auctions** (Post an ad's "How do you want to sell?", the listing page's auction panel, the
   winner's buy page, cards, `/<cc>/auctions` listing every auction listing).
3. **Udozo's lots as listings** (Udozo's seller account per market, abandoned lots made as auction listings, the old
   lot pages redirecting to their listing, the admin's Auctions page over both kinds).
4. **Words and docs** (the auctions terms for sellers' auctions, the plan's As built, AGENTS.md).
