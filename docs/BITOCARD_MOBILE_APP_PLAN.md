# BitoCard mobile app: plan

The owner's request (19 November 2026): a simple app for bitocard.com's own customers to buy and sell airtime, buy
data, and buy and sell gift cards. The approved screens are the design canvas "BitoCard mobile app"
(https://claude.ai/artifact/Bdn5PHYM17dQEvS4XJWEKZ, 30 screens).

## Shape

- **Expo (React Native) at `mobile/bitocard`**, outside the npm workspaces, like `mobile/udozo`: its own
  `package.json`, lockfile and tests (`npm test`, `npm run typecheck`, `npx expo lint`); packages added with
  `npx expo install`; `ios/` and `android/` never edited by hand (generated).
- **App IDs:** `com.golojan.bitocard.android` on Android (the Play listing's), `com.golojan.bitocard.ios` on iOS; URL scheme `bitocard`.
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

- ~~**Forgot password in the app.**~~ Done in phase 6 (`/forgot-password`).
- ~~**App icons and splash.**~~ Done in phase 5 (`scripts/brand-assets.py`, `MOBILE`).
- **`BitoCard-App` header.** The app sends it, but BitoCard's API ignores it. Read it if the API should tell app calls apart (sign-up journeys, counts).
- **Tried on a phone.** Nothing has run on a real device or against the live API yet. Run it in a development build before a store build.

From phase 1:

- **Data plans with several fixed values.** A data product with more than one fixed face value is offered at its `from` value only. Show its `denominations` (from `GET /v1/store/products/:key`) as separate plans.
- **Ghana account numbers.** `POST /v1/store/wallet/reserved-accounts` takes `phone` for Ghana; the app sends only the BVN (Nigeria). Ask for the phone where the market is GH.
- ~~**Adding and removing wallets.**~~ Done in phase 6 (`/wallets`).
- **Transactions per wallet.** `GET /v1/store/wallet/transactions` has no currency filter; the app filters the page it loaded, so a wallet's list can look short. Add `currency` to the API, or keep loading until there are enough rows.
- ~~**Bank deposit history.**~~ Done in phase 6 (`/bank-deposit/all`).
- **Pull to refresh** on Home and the Wallet tab (Orders has it).
- **Paying by card for an order.** Orders are paid from the wallet only (`method: 'wallet'`). Where a market has wallets switched off (`wallet_required: false`), offer its checkout methods (`GET /v1/store/payment-methods`) and open the gateway's page as Add funds does.
- **Cancelling an unpaid checkout or top-up** (`POST …/cancel`) from its page.

From phase 3:

- **Dialling the transfer code on iPhones.** iOS refuses `tel:` links holding `*` or `#`, so Dial it may do nothing there; Copy code is beside it. Hide Dial it on iOS once tried on a phone.
- **All of a customer's trades.** The exchange shows the latest ten; the API lists 50 of each with no paging. Add a full list with paging when there are more.
- **Numbers outside Nigeria** are shown as the API sends them (`localNumber` writes only Nigerian ones locally), and amounts are whole units, as Nigeria's exchange takes. Check both when another market opens.
- **The seller's standing** (strikes, when they expire) is shown only when selling is paused; add it to the exchange page.

From phase 4:

- **Native Google and Apple sign-in** were left out on purpose: bitocard.com's customers have no Google sign-in, and Apple asks for Sign in with Apple only when an app offers another company's sign-in. Add both together (the API's `…/google/native` and `…/apple/native`, as udozo-api has) if Google sign-in comes to bitocard.com.
- **Real push needs keys.** Android needs Firebase's `google-services.json` in the app (`android.googleServicesFile` in `app.json`) and the service account in Settings > Integrations > Phone push; iPhones need the APNs key there. Until then `registerPush` gets no token and the inbox still works.
- **Chat and ticket attachments** sent by BitoCard's team show as "(sent a file)": the app cannot open them yet (`GET /v1/store/support/chat/:id/files/:file` with the session).
- **Settings:** Face ID before every payment is always on; a switch to skip it for small amounts is not built.
- **Spin and win's wheel** is checked in tests with reduced motion only; watch the turn on a phone.
- **The update gate** blocks only once admins set the minimum versions (Settings > Integrations > Mobile app); set them and the store links before the first store build.

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
- **Phase 3 built (19 November 2026):**
  - **Mobile numbers** (`/phones`, from Account and the exchange): the confirmed numbers, the default first; adding one
    with its texted code (`POST /v1/store/account/phones`, then `…/verify`), making another the default, removing one.
  - **The exchange** (`/airtime`, from the Mobile tab): the live pool per network (available, the sell and buy rates,
    what moved in 24 hours; asked again every 20 seconds), Sell and Buy, and the customer's latest trades.
  - **Selling** (`/airtime/sell`, Home's Sell airtime): an open network, the confirmed number it comes from (the default
    first), a whole amount within the network's limits (`src/lib/airtime.ts`), the payout quoted first, the warning
    that airtime from any other number is lost, then the sale with a kept Idempotency-Key.
  - **The sale** (`/airtime/sale/[id]`): BitoCard's number with copy, the network's transfer code with Dial it and
    copy, the time left, "I've sent it" after a confirmation (a sale said sent that never arrives is a strike), Cancel;
    then checked (asked again every 10 seconds), paid after the hold, or not received and why; sandbox sales decided.
  - **Buying** (`/airtime/buy`, Home's Buy unused airtime): a network with airtime in the pool, the confirmed number it
    goes to, the price quoted, then Face ID or PIN and that price paid (`expected_price`) with a kept key; a short wallet
    offers Add funds. **The purchase** (`/airtime/purchase/[id]`): followed until sent or refunded.
  - Tests: `test/airtime.test.ts`, `test/screens/airtime.test.tsx`.
- **Phase 4 built (19 November 2026):**
  - **API** (`apps/api`, migration `20270213000000_mobile_app`: `DeviceChannel` `fcm` and `apns`, `devices.app_version`, `customers.deleted_at`):
    - phone push (`src/notifications/native-push.ts`, ported from udozo-api: FCM HTTP v1 and APNs over HTTP/2), `POST /v1/store/account/devices/phone { kind: fcm|apns, token, app_version? }`, the token encrypted and found by its hash; Settings > Integrations > **Phone push (FCM and APNs)**;
    - `GET /v1/app/config?platform=&version=` (`src/app-config/`: `update` none, available or required, the store link, bitocard.com and the legal pages); Settings > Integrations > **Mobile app**;
    - deleting the account (`src/customers/account-deletion.ts`): `GET /v1/store/account/delete` (`can_delete`, `password_required`, `blockers`: money held, open orders, gift card sales being checked, airtime trades, bank deposits, payouts on their way) and `POST …/delete { confirm: "DELETE", password? }` (personal details removed, sessions ended, devices forgotten; orders and the ledger stay).
    - Tests: `test/phone-push.test.mjs`, `test/app-config.test.mjs`, `test/account-deletion.test.mjs`.
  - **App:**
    - **Notifications** (`/notifications`, the bell on Home with the unread count): newest first, opening one marks it read and goes to its screen (`appLink` in `src/lib/links.ts` turns bitocard.com paths into the app's), Mark all read, and Turn on notifications.
    - **Push** (`src/lib/push.ts`, `PushListener`): the phone's own token (expo-notifications, never Expo's push service) registered once the email is confirmed; a notice in front refreshes the inbox; a tap opens its screen.
    - **Help** (`/help`): chat (the assistant's greeting, polled every 3 seconds, Talk to a person, End chat) and questions to BitoCard (`/help/new`, from an order with Ask us about this order; `/help/ticket/[id]` with replies and Close).
    - **Search** (`/search`, from Home): gift cards open in the app, airtime and data on the Mobile tab, anything else on bitocard.com.
    - **Settings** (`/settings`): push on or off, which notices are pushed (security ones locked), the theme (phone, light or dark, kept on the phone), mobile numbers, terms and privacy, the version, and **Delete your account** (`/delete-account`: what stands in the way, else the password and DELETE typed; then signed out).
    - **Spin and win** (`/spin`, from Home's card): the wheel stops on what the server decided (`landingRotation` in `src/lib/spin.ts`), still for reduced motion; rewards moved to a wallet at the amount shown first.
    - **The update gate** (`UpdateGate`): blocks below the minimum version, offers the update below the latest.
    - Tests: `test/links.test.ts`, `test/spin.test.ts`, `test/screens/staying.test.tsx`, `test/screens/delete-account.test.tsx`.
- **Phase 5 built (19 November 2026), everything but the builds:**
  - **Opening bitocard.com links in the app:** bitocard.com serves `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` (`apps/storefront/lib/app-links.ts`), only on bitocard.com and only once `BITOCARD_IOS_APP_IDS`, `BITOCARD_ANDROID_PACKAGE` and `BITOCARD_ANDROID_CERT_SHA256` are set (404 before, and always on resellers' stores). They claim only pages the app has screens for: orders, wallet and deposits, gift card sales, the airtime exchange, help, the identity check, notifications and gift card pages (`/p/gift_cards…`). The app's `associatedDomains` and Android intent filters (`app.json`) list the same, checked by `apps/storefront/test/app-links.test.ts`; `+native-intent.tsx` turns each link into its screen (`incomingRoute` in `src/lib/links.ts`), anything else Home.
  - **Icons and splash** from `assets/logo.png` by `scripts/brand-assets.py` (`MOBILE`): the store icon, Android's adaptive layers (white mark on the logo's navy, and the monochrome layer) and the splash mark.
  - **Legal:** the privacy notice's "When you use BitoCard's app" (the phone's secure store, Face ID checked by the phone, push tokens through Apple and Google, the camera only for selling a gift card, deleting the account in the app), Apple and Google as recipients, and retention (deleting in the app is at once; push tokens until signed out); `legalUpdated` 19 November 2026. bitocard.com's `/delete-account` explains deleting, for Google Play (never on resellers' stores).
  - **Stores:** listing copy, screenshots, Google's Data safety and Apple's App Privacy answers, review notes and the checklist before the first build are in `docs/BITOCARD_MOBILE_APP_STORES.md`.
  - **Builds:** not started. They wait for the owner's go, after the checklist in that file.
- Next: the checklist in `docs/BITOCARD_MOBILE_APP_STORES.md`, then builds on the owner's go.
- **Phase 6 built (20 November 2026), matching bitocard.com for customers:**
  - **Every product in the app:** bills, pay-TV, electricity, software and VPN open a product screen (`/product/[key]`,
    rules in `src/lib/products.ts`): the meter, smartcard or account number; pay-TV's renew or change of package (the
    API's `recipient.transaction_type`); the value or amount in range; how many and where codes are emailed (software).
    Lists by category (`/browse`, Bills holding electricity and pay-TV), from Home's Pay bills and TV, Software and VPN
    tiles (shown only where `GET /v1/store/navigation` says something is on sale) and from search, which no longer
    sends anything to bitocard.com.
  - **Confirm payment shows whose meter or smartcard it is** before paying: the API's checkout preview now returns the
    quote's `recipient` (account name, address, current package, as the provider's check gave them).
  - **VPN orders:** the username and password masked until Reveal, and VPN access (status, when it ends, never renewed,
    Reset password after Face ID; `src/components/vpn.tsx`). Codes show licence terms, serials and token units.
  - **Reported problems** (`/disputes`, `/disputes/new` from an order's Report a problem, `/disputes/[id]`;
    `src/lib/disputes.ts`).
  - **Account** is a menu of its places as on bitocard.com; **Profile** (name, email, the country chosen once by an
    older account), **Security** (change password), **Forgot password** on sign-in (the emailed code, then a new
    password, which signs in).
  - **Your wallets** (`/wallets`: add one in an opened market's currency, remove an empty added one), **Gift cards you
    sold** (`/sold`) and **every bank deposit** with filters (`/bank-deposit/all`, `src/lib/deposits.ts`).
  - bitocard.com's links to these open the app (`appLinkPaths` in `apps/storefront/lib/app-links.ts`, the intent
    filters in `app.json`, `src/lib/links.ts`).
  - Tests: `test/products.test.ts`, `test/links.test.ts`, `test/screens/more.test.tsx`; the API's in
    `apps/api/test/customer-wallets.test.mjs`.
