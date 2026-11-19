# BitoCard mobile app: plan

The owner's request (19 November 2026): a simple app for bitocard.com's own customers to buy and sell airtime, buy
data, and buy and sell gift cards. The approved screens are the design canvas "BitoCard mobile app"
(https://claude.ai/artifact/Bdn5PHYM17dQEvS4XJWEKZ, 30 screens).

## Shape

- **Expo (React Native) at `mobile/bitocard`**, outside the npm workspaces, like `mobile/udozo`: its own
  `package.json`, lockfile and tests (`npm test`, `npm run typecheck`, `npx expo lint`); packages added with
  `npx expo install`; `ios/` and `android/` never edited by hand (generated).
- **App IDs:** `com.bitocard.app` on both platforms; URL scheme `bitocard`.
- **Customers only, bitocard.com's own store.** No reseller store, no Seller HQ. The app sends no `BitoCard-Store`
  header, which the API reads as bitocard.com. The account is the same one as on bitocard.com: the same email,
  password, wallet and orders.
- **Same API, no private shortcuts.** It uses the `/v1/store/*` routes bitocard.com's server uses, with the
  customer's session in `BitoCard-Customer-Session`. The session is kept in the phone's secure store and never logged.
  Every POST carries an `Idempotency-Key`; a money step keeps its key until it succeeds or is refused.
- **Look:** bitocard.com's navy `#070f4c` and pink `#ff2382`, Inter, the "b" mark. Light first; dark follows the phone.
- **Five tabs:** Home, Mobile, Gift cards, Wallet and Orders. Account, Notifications and Search open from Home's
  header.
- **Never** show suppliers, costs or routing, as on the website.

## Phases

### Phase 0: foundation (this commit)

- The Expo project: config, EAS profiles (no builds until the owner says go), icons and splash from the "b" mark, Inter.
- The API client (`src/lib/api-core.ts`, tested under `node --test`), the session in the secure store, React Query.
- Signing in, creating an account (name, email, country fixed at sign-up, password) and confirming the email code.
  Signing out.
- The tab shell, with Home reading the real wallet (`GET /v1/store/wallet`) and the account summary
  (`GET /v1/store/account/summary`). The other tabs are placeholders saying what is coming.
- Account: details, the country (fixed) and sign out.

### Phase 1: wallet, airtime and data

- **Wallet:** wallets with a tab each (`GET /v1/store/wallet`, `?currency=`) and transactions.
  - **Add funds:** the market's methods; the gateway's page opens in an in-app browser, and the app polls the top-up.
  - **Your account number:** `reserved-accounts`.
  - **Bank deposits:** `/v1/store/wallet/bank-deposits`.
  - **Move money:** `/v1/store/wallet/conversions`, previewed first.
- **Buy airtime and data:** products by category and market (`GET /v1/store/products`).
  - The number goes in `recipient.phone`, with the network shown from the number.
  - Quote with `preview: true`, then **Confirm payment** (Face ID, fingerprint or PIN) pays the `quote_id` from the
    wallet.
  - **Result:** the checkout is polled while it is processing, then shows delivered, pending or refunded.
- **Orders:** `GET /v1/store/checkouts` (`show=`) and each order's page with its timeline and receipt.

### Phase 2: gift cards

- **Browse:** brands and cards (`/v1/store/products?category=gift_cards`).
- **Buy:** the rate (`/v1/store/products/:key/rate`), the value and quantity, then the checkout as in phase 1.
- **Codes:** hidden until Reveal, with a screen-capture guard while shown.
- **Identity check:** `/v1/store/account/verification`, opened in the browser where the market asks for it.
- **Sell a gift card:** the offers and rate (`/v1/store/gift-card-sales/offers`), the quote, then multipart photos or
  the code (`/v1/store/gift-card-sales`), then the sale's status.

### Phase 3: the airtime exchange

- **Your mobile numbers:** `/v1/store/account/phones`, adding a number with its SMS code.
- **Sell airtime:** start from a confirmed number, then the send step (the number and the network's transfer code),
  then "I've sent it" and the sale's timeline.
- **Buy unused airtime:** the live pool (`/v1/store/airtime/pool`), then the purchase and its status.

### Phase 4: staying in touch, and the rest

- **API work (apps/api):**
  - phone push for BitoCard customers (FCM and APNs, ported from udozo-api's `native-push.ts`), with
    `POST /v1/store/account/devices/phone`;
  - `GET /v1/app/config` (minimum and latest versions, store links), ported from udozo-api;
  - deleting the account from the app (Apple and Google require it);
  - native Google and Apple sign-in.
- **In the app:**
  - Notifications (the existing `/v1/store/account/notifications`) and push;
  - Help: chat (`/v1/store/support/chat`) and tickets;
  - Search;
  - Settings (Face ID, confirm every payment, notification choices, theme);
  - Spin and win (`/v1/store/spins`);
  - the update gate.

### Phase 5: release

- **Opening bitocard.com links in the app:** `apple-app-site-association` and `assetlinks.json` served by bitocard.com,
  for account, order and gift card links.
- **Legal:** the privacy notice gains a section on the app (push tokens, the secure store, the camera for gift card
  photos).
- **Stores:** listings, screenshots and the data safety forms.
- **Builds:** EAS builds only on the owner's go.

## Carried forward (not done yet, to pick up)

Kept here so nothing left open is forgotten. Strike an item out when it ships.

From phase 0:

- **Forgot password in the app.** Sign in only says to reset it on bitocard.com. Use `POST /v1/store/account/password/forgot` and `…/password/reset` (code and new password).
- **App icons and splash.** Phase 0 copied the website's icons. Generate a proper set (adaptive icon foreground, background and monochrome; splash) from `assets/logo.png` with `scripts/brand-assets.py`, as `mobile/udozo` has.
- **`BitoCard-App` header.** The app sends it, but BitoCard's API ignores it. Read it if the API should tell app calls apart (sign-up journeys, counts).
- **Tried on a phone.** Nothing has run on a real device or against the live API yet. Run it in a development build before a store build.

From phase 1:

- **Data plans with several fixed values.** A data product with more than one fixed face value is offered at its `from` value only. Show its `denominations` (from `GET /v1/store/products/:key`) as separate plans.
- **Ghana account numbers.** `POST /v1/store/wallet/reserved-accounts` takes `phone` for Ghana; the app sends only the BVN (Nigeria). Ask for the phone where the market is GH.
- **Adding and removing wallets** (another currency where `customer_foreign_wallets` is open): `GET /v1/store/wallet/currencies`, `POST /v1/store/wallet/wallets`, `DELETE …/wallets/:currency`. The app only shows the wallets already held.
- **Transactions per wallet.** `GET /v1/store/wallet/transactions` has no currency filter; the app filters the page it loaded, so a wallet's list can look short. Add `currency` to the API, or keep loading until there are enough rows.
- **Bank deposit history.** Only open deposits are listed; add the full list (`?show=done` and each status) as bitocard.com's Deposits page has.
- **Pull to refresh** on Home and the Wallet tab (Orders has it).
- **Paying by card for an order.** Orders are paid from the wallet only (`method: 'wallet'`). Where a market has wallets switched off (`wallet_required: false`), offer its checkout methods (`GET /v1/store/payment-methods`) and open the gateway's page as Add funds does.
- **Cancelling an unpaid checkout or top-up** (`POST …/cancel`) from its page.

## Build progress

- **Phase 0 built (19 November 2026):**
  - `mobile/bitocard`: the API client, session, money formatting and palette;
  - the root layout (Inter, React Query following the network and the app's focus);
  - the five tabs, gated on signing in and a confirmed email;
  - Welcome, Sign in, Create your account (the country chosen from `GET /v1/countries`), Confirm your email (send
    again, use another account);
  - Home (the wallet and US dollar balance, "I want to" tiles opening their tabs, the order summary) and Account (sign
    out).
  - Icons are the website's for now; a proper set from `scripts/brand-assets.py` comes with phase 5.
  - Tests: `test/api-core.test.ts`, `test/money.test.ts`, `test/screens/signin.test.tsx`.
- **Phase 1 built (19 November 2026):**
  - **Mobile tab:**
    - Airtime or Data; the network from the number (`GET /v1/store/network-detect`, the customer's choice wins);
    - airtime amounts as chips within the product's range, or typed;
    - data plans as the network's products (each at its `from` value; a plan with several fixed values is not offered
      yet).
  - **Confirm payment** (`/pay`):
    - the quote first (`preview`), with each wallet's price;
    - Face ID, fingerprint or PIN (`confirmOnPhone`), then the quote paid from the chosen wallet with a kept
      Idempotency-Key (`useMoneyKey`);
    - a wallet too low offers Add funds; an expired quote, a new price.
  - **Order page** (`/order/[id]`): the status, timeline (`src/lib/orders.ts`) and receipt, asked again every
    4 seconds while it moves; sandbox orders can be simulated.
  - **Orders tab:** All, On the way, Delivered, Refunded, paged by `starting_after`.
  - **Wallet tab:**
    - a tab per wallet, the balance, Add funds, Move money, Bank deposit;
    - your account number, or getting one (`/account-number`, the BVN in Nigeria);
    - transactions, linking to their order.
  - **Add funds:** the market's methods; the provider's page in an in-app browser, then the top-up followed until it
    settles; sandbox top-ups can be simulated.
  - **Move money:** what arrives first, then the move with `expected_amount`.
  - **Bank deposit:** the open deposits, a new one, and its page (where to pay with copy buttons, "I've paid it" with
    how and the name on it, Cancel).
  - Tests: `test/orders.test.ts`, `test/money.test.ts` (typed amounts, kept keys), `test/screens/buying.test.tsx`,
    `test/screens/wallet.test.tsx`.
- **Phase 2 built (19 November 2026):**
  - **Gift cards tab:** Buy and Sell (`?mode=` from Home's tiles), a search, the cards as a grid with their logo or
    initials (`BrandTile`); Sell lists the customer's latest five sales.
  - **A card to buy** (`/gift-card/[key]`): the day's rate (`GET /v1/store/products/:key/rate`), its values as chips
    with their price (`src/lib/gift-cards.ts`: `valuesOf`, `priceAt` rounding up), 1 to 10 cards, the email the codes
    go to, then Confirm payment.
  - **Codes:** a delivered order's codes, PINs and serials are masked until Reveal and Face ID, fingerprint or PIN;
    screen capture is blocked while they show (`expo-screen-capture`), each with copy (`src/components/codes.tsx`).
  - **Selling** (`/sell/[key]`): the cards Prestmit buys for that product, the form (e-code or photos), the value
    within the offer's limits, "See what you get" (the exact quote), then the code or up to 20 photos (camera or
    library, scaled to 1600 px JPEG, `src/lib/photo.ts`) sent with `expected_payout` and a kept Idempotency-Key
    (`apiUpload`); a lower rate meanwhile clears the quote; an unchecked identity leads to the check.
  - **The sale** (`/sale/[id]`): its status, asked again every 10 seconds while being checked; sandbox sales can be
    decided.
  - **Identity check** (`/identity`): the names as on the ID, the BVN in Nigeria where the provider asks, consent,
    then the check in an in-app browser (start, continue or start again); Confirm payment offers it when checkout
    refuses for it.
  - Tests: `test/gift-cards.test.ts`, `test/screens/gift-cards.test.tsx`.
- Next: phase 3.
