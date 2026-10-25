# BitoCard Shop UI designs

Mockups for BitoCard Shop (Classifieds), drawn for `docs/BITOCARD_CLASSIFIEDS_PLAN.md`. The live canvas is the private artifact <https://claude.ai/artifact/1jGHRf5zizCEdduZCsPAsx>; these files are a copy of its 41 artboards, kept here as the reference for building the screens. They are design references, not app code: each `.dc.html` is a Design Component page (inline styles, sample data in its `renderVals()`), and they render only on the canvas, which supplies `support.js`. `canvas.json` is the canvas's layout.

Colours and type follow the storefront's tokens (`packages/ui/src/styles/tokens.css`: navy 900 `#070f4c`, pink 500 `#ff2382`, pink 700 `#c00b58` for pink text and buttons, Inter), with green `#0b7a5c` for Safe pay. Photos are coloured placeholders; names, prices and counts are sample data. Fee rates show as `[x]%` and `[y]%`; the admin settings screen uses 2% capped at ₦20,000 for the buyer and 3% capped at ₦30,000 for the seller only as an example.

| File | Screen | Where it lives |
|---|---|---|
| `Components.dc.html` | Component library: colours, type, buttons, chips, badges, statuses, inputs, feature fields, cards, notices, flags, navigation, empty states | all |
| `Main.dc.html` | A country's home: search with the area, categories, local-first results, Sell | `shop.bitocard.com/ng` |
| `Category.dc.html` | Category results with filter chips and result tiers | `/ng/c/<category>` |
| `Filters.dc.html` | Filters sheet: price, condition, feature filters, sellers and delivery | `/ng/c/<category>` |
| `Location.dc.html` | Choose your area, with Use my location | `shop.bitocard.com` |
| `Listing.dc.html` | Listing: gallery and video, price, features, description, seller, Safe trade, actions | `/ng/l/<id>-<slug>` |
| `Seller.dc.html` | Seller profile with badges, reviews and listings | `shop.bitocard.com` |
| `SafeTrade.dc.html` | Safe Trade Guide checklist with category checks | `/safe-trade` |
| `SignIn.dc.html` | Sign in, with "Continue as" (the handoff) | `shop.bitocard.com` |
| `SafePay.dc.html` | Buy with Safe pay: steps, meet-up or delivery, price, fee and total, wallet | `/ng/l/<id>/buy` |
| `Offer.dc.html`, `PhoneReveal.dc.html`, `Report.dc.html` | Make an offer, Show phone, Report sheets | listing and chat |
| `Global.dc.html`, `SwitchPrompt.dc.html` | Global showcase without prices, and the switch-country prompt (from the second country) | `shop.bitocard.com` |
| `ShopTab.dc.html` | The Shop tab: sub menu, stats, my listings, the six tabs | `ng.bitocard.com/shop` |
| `Post.dc.html` | Post an ad: photos and video, condition, registry features, rich text | `/shop/post` |
| `Messages.dc.html`, `Chat.dc.html` | Conversations and a chat with its offer card | `/shop/messages` |
| `Orders.dc.html` | Safe pay orders, buying and selling | `/shop/orders` |
| `SellerAccept.dc.html` | Seller accepts a request: their fee and payout, first-time set-up | `/shop/orders/<id>` |
| `BuyerOrder.dc.html` | Buyer's order: release code, progress, cancel, report a problem | `/shop/orders/<id>` |
| `EnterCode.dc.html` | Seller enters the release code | `/shop/orders/<id>` |
| `Dispute.dc.html` | Open a dispute | `/shop/orders/<id>` |
| `SafePaySetup.dc.html` | Identity check and payout account, to be paid | `/shop/safe-pay` |
| `Favourites.dc.html` | Favourites with price-drop and sold labels | `/shop/favourites` |
| `AdminModeration.dc.html` | Moderation queue | admin Classifieds |
| `AdminFeatures.dc.html` | Feature registry: key, icon, data type, unit, default, placeholder, limits, search words, sellers' suggestions | admin Classifieds |
| `AdminSafePay.dc.html` | Safe pay settings per country: both rates and caps, time limits, worked examples | admin Classifieds |
| `AdminDispute.dc.html` | A dispute: both sides, the decision and its money | admin Classifieds |
| `AnjioPanel.dc.html` | Ask Anjio: the assistant panel with the language menu, the search it ran, listing cards from its tools, Talk to a person | `shop.bitocard.com/ng` |
| `AnjioListing.dc.html` | Ask Anjio about a listing: price range, the category checklist, the Safe pay fee and a draft first message | `/ng/l/<id>-<slug>` |
| `AnjioLanguage.dc.html` | Choosing the language, and Ada (a Nigerian assistant) answering in Pidgin | `shop.bitocard.com/ng` |
| `AnjioFill.dc.html` | Fill from photos: suggestions to accept or edit, features from the registry, a price range | `/shop/post` |
| `AnjioSeller.dc.html` | Improve this listing, and Suggest a reply in a chat | `/shop/listings`, `/shop/messages` |
| `AdminAssistants.dc.html` | Shop assistants with Anjio as the default, and the coverage by country and language | admin Support > Assistants |
| `AdminAssistantEdit.dc.html` | A shop assistant: roles, model, languages with greetings, countries per language, knowledge per country, limits | admin Support > Assistants |
| `AdminAnjioReview.dc.html` | Anjio's reported answers and evals (current model against a candidate) | admin Support > Assistants |
| `ShopPage.dc.html`, `Deals.dc.html`, `B2B.dc.html` | Phase 2: a business shop, deals with honest "was" prices, a B2B listing with price tiers and a request for quote | `/ng/s/<shop>`, `/ng/deals` |

Reviews on the seller profile and the shop page are phase 2 (`classified_reviews`).
