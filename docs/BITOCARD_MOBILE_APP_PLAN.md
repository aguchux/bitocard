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
- Next: phase 1.
