# Udozo mobile app: plan

**Status:** planned on 12 November 2026 (the owner's request). The owner's decisions are taken (below). Nothing built yet.

**Design:** the screens are on the design canvas "Udozo mobile app" (29 phone screens in six flows: get started, find, talk and buy, sell, you, and money, calls and shops at launch). This plan and that canvas go together. Where the canvas and this plan differ, this plan wins until the owner decides.

## What it is

Udozo's marketplace as an iOS and Android app for buyers and sellers. It runs on Udozo's own API (`apps/udozo-api`, `api.udozo.com`), with the same accounts as udozo.com.

**Not in it:**
- Seller HQ, Connect Centres' dashboard and the POS: they keep their own apps (`apps/udozo-pos-windows` for the POS).
- Anything of BitoCard's.

**Why an app, beyond the website:**
- the camera for posting ads;
- push notifications for messages, offers and calls;
- calls that ring when the app is closed;
- biometric confirmation of payments;
- offline drafts;
- a home-screen presence in markets where most people shop on Android phones over mobile data.

## Product decisions (confirmed by the owner, 12 November 2026)

1. **Expo (React Native) with TypeScript, one codebase for iOS and Android**, in this repository at `mobile/udozo`, outside the npm workspaces: Expo's SDK needs a newer React than the websites, so the app has its own `package.json` and lockfile, and the websites' builds and CI never install it.
   - It copies the few pure helpers it needs from `@bitocard/api-client/classifieds` (conditions, money, `sellerPath`, `brandPath`, category matching) and Udozo's words, until the websites move to the same React and it can share them.
   - Builds and store uploads go through EAS Build and EAS Submit. JavaScript-only fixes ship through EAS Update, never anything that changes permissions or native code.
   - Not native Swift and Kotlin: that would be two codebases for one team. Not a wrapped website: it would bring no camera flow, calls or push worth having.
2. **Android first in testing, both stores at launch.**
   - Target Android 8 and up, and iOS 16 and up.
   - Design and test for a 2 GB RAM Android phone on 3G.
3. **Browse without an account.** Sign-in is asked for only to chat, call, save, post or pay. It returns the user to the same place.
4. **Five tabs:** Home, Search, Sell (the raised centre button), Chats, Me. The listing page, chat, checkout and post-an-ad screens are pushed screens, with no tab bar.
5. **Same rules as udozo.com.** Every rule stays in the API: limits, refusals, UdozoPay, terms acceptance, identity checks. The app only draws the API's answers and words its refusal codes.
6. **Money is in the first release.** The launch includes:
   - wallet top-ups;
   - UdozoPay checkout and orders, on both sides;
   - Connect Centre collection with the release code;
   - payouts to a bank.
   Each money step is confirmed with the phone's biometrics.
7. **Calls ring when the app is closed, from launch.** On iPhones the call shows on CallKit's own call screen, woken by a VoIP push. On Android it is a full-screen call from ConnectionService, woken by a high-priority FCM message.
8. **A Udozo POS till's QR code opens the app to pay.**
   - `udozo.com/pay/<token>` is a universal link (App Link on Android), with an in-app scanner under Me.
   - The buyer sees the shop, the basket and the total, and pays from their wallet with biometrics, or declines.
   - The website keeps working for people without the app.
9. **Store accounts come last.** Who publishes Udozo on the App Store and Google Play is decided at the end, before submission (phase 6). Until then builds go to testers through EAS (see Phases for what iPhones need).

## Screens (the canvas)

| Flow | Screens |
|---|---|
| 1 Get started | Welcome (Skip to browse), Sign in (email first, then Google, Facebook, WhatsApp; Apple on iOS, see below), Sign up (emailed code), About you (first and last name, country fixed once, mobile kept unconfirmed) |
| 2 Find | Home (search with Near me, hero reel, Shop by category, For you), Search results (filter chips, sheets for filters and area, Best match), Category (banner, subcategories, brands), Listing (gallery, badges, Connect card, details, seller card, safety checks, sticky Chat, Call and Buy with UdozoPay), Seller page (cover, badges, figures, Anjio's view, listings and reviews) |
| 3 Talk, call and buy | Chats (Buying and Selling, online dots, requests), Chat (listing strip, offer and order cards, quick replies, photo), Call (through Cloudflare TURN, number private), UdozoPay checkout (Connect Centre or meet-up, wallet, every fee, confirm sheet with Face ID), Order (ready to collect, release code hidden until Show, centre, progress, report) |
| 4 Sell | Post an ad in three screens: photos (camera, gallery, video, Fill from photos), details (category, condition, price with Anjio's range, brand and model, stock, description, place), review (UdozoPay, Connect, resellers, terms); My listings (status filters, Edit, Mark sold); Dashboard (period, four figures, chart, message board, most viewed) |
| 5 You | Me (profile, mobile reminder, wallet, orders, saved, Selling, Buying with Scan to pay at a shop, Account), Wallet and payouts (wallet, sales ready and held, bank account, Pay to my bank, transactions), Notifications (push prompt, today, earlier), Ask Anjio (cards, price range, thumbs, Talk to a person, voice), Settings and privacy (profile, Face ID, devices, personalisation, history, appearance, data saver, delete account) |
| 6 Money, calls and shops | Incoming call with the app closed (who, about which listing, number private, Accept, Decline, Reply in chat, Call back later), Add funds (amount, the account number to transfer to with Copy, card, bank app or USSD), Choose a Connect Centre (map and list, distance, hours, shipping, free days, closed ones greyed), Pay out to bank (amount, the account in the name on the ID, the confirm sheet with fee and fingerprint), Pay a shop's till (shop, till, basket, total, time left, wallet, Pay with Face ID, Not my basket) |

Sign in now offers **Continue with Apple** first on iPhones (Apple's rule 4.8).

**Still to draw before build:**
- **States and sheets:**
  - empty states;
  - error states, with no internet and the API refusing;
  - loading skeletons;
  - the filter sheet, the area picker and the offer sheet;
  - the counter-offer and buy-order cards;
  - the identity check (Udozo Verify in an in-app browser).
- **Other screens:**
  - getting a bank account number for the first time (with the BVN in Nigeria);
  - card payment in the in-app browser and its return;
  - adding a payout bank account;
  - the in-app QR scanner, and the till payment's success and expired states;
  - a missed call and the call-back request;
  - reviews and rating forms;
  - wanted requests;
  - auctions (bid panel);
  - WhatsApp sign-in waiting screen;
  - dark mode.

## Design language

The canvas sets these; they are Udozo's published theme, so the app follows `/v1/theme` when admins change it.

- **Colours:**

  | Token | Value |
  |---|---|
  | Primary | `#185174` |
  | Accent and links | `#0e7cc0` |
  | Ink | `#10212e` |
  | Muted text | `#5b6b78` |
  | Surface | `#f3f5f6` |
  | Lines | `#e1e6ea` |
  | Money and success | `#1f7a4d` |
  | Danger | `#b42318` |
  | Notices | `#c2410c` |

- **Type:** Inter (the website's), 15 to 16 px body, 800 weight headings.
- **Shape and spacing:** 12 to 16 px corners, 16 px side margins, 44 px minimum touch targets.
- **Icons:** stroke icons (lucide, as udozo.com). No emoji anywhere.
- **Confirmations:** every money step is a bottom sheet that names the amount: Pay, Accept, Release, Pay out. Destructive steps are red.
- **Photo placeholders:** placeholders while photos load. Photos are requested at `w=480` on mobile data with Data saver on, `w=960` otherwise (the watermark route's sizes).
- **Accessibility:**
  - screen-reader labels on every icon button;
  - text that scales with the phone's setting;
  - colour never alone (each change on the dashboard is said in words);
  - reduced motion respected (the marquee and hero reel stand still).

## What the API needs first (phase 0)

The app calls `api.udozo.com` directly with the customer's session token (`BitoCard-Customer-Session`). The token is kept in the phone's secure store (Keychain, Keystore) and is never logged.

1. **Native sign-in.**
   - **Google:** `POST /v1/store/account/google/native { id_token, intent, country? }`. The ID token comes from Google's SDK; check the audience against Udozo's Android and iOS client IDs, plus the nonce.
   - **Facebook:** `POST …/facebook/native { access_token }`, read with `appsecret_proof`. The rules stay as for the web: an email Facebook gives is still confirmed by code, and neither provider takes over an account with the same email.
   - **Sign in with Apple:** `POST …/apple/native { identity_token, nonce, name? }`. App Store guideline 4.8 requires it once Google or Facebook is offered. Apple may hide the email (a relay address), so the account works with it.
   - **WhatsApp sign-in** works as is: start, then poll `finish`.
2. **Push to phones.**
   - Devices get a `kind`: `web` (today) or `fcm` / `apns` (the app). Registration: `POST /v1/store/account/devices/phone { kind, token, app_version }`.
   - `PushService` gains senders for FCM (HTTP v1, service account) and APNs (token auth, `.p8` key) as integration settings. The same queue, retries, preferences and locked security notices apply.
   - Payloads carry the notice's link as an app path, never codes or anyone's words.
3. **Calls that ring when the app is closed (a launch requirement).**
   - A new call sends a VoIP push to each of the callee's phones: `apns-push-type: voip` through PushKit on iPhones, a high-priority FCM data message on Android. It carries the call's id and the caller's public name, never a number.
   - The push wakes CallKit or ConnectionService, then the call runs as today (signals, TURN only).
   - VoIP tokens are their own device kind (`apns_voip`). Apple requires every VoIP push to report a call at once, so they are used for nothing else.
   - The 45-second ring and the missed-call notice stay the API's, and declining from the phone's call screen ends the call (`…/end`).
   - Calls still need the callee online for the in-browser case, but a callee with the app installed counts as reachable while their VoIP token is fresh.
4. **Deep links.** udozo.com serves `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` (`apps/udozo`).
   - The app opens:
     - `/<cc>/l/*`, `/<cc>/seller/*`, `/<cc>/brand/*`, `/<cc>/c/*`;
     - `/account/*`, `/i/*` (invites keep their `ref`);
     - `/pay/<token>` (POS wallet payments);
     - `/signin/whatsapp`.
   - Everything else stays in the browser.
5. **Rate limits.** The app cannot hold `STORE_SERVER_SECRET`, so it is limited by its own address and session, as any direct caller is. Check the per-address limit is fair for carrier NAT, where many phones share one address; prefer per-session limits once signed in.
6. **App version gate.** `GET /v1/app/config?platform&version` returns:
   - the minimum supported version (below it: Update the app);
   - feature flags read from the market's switches;
   - store links.
7. **Uploads from the app.**
   - Listing photos, avatars and covers use the API's signed-upload routes directly (send the bytes to the API as the consoles do), compressed on the phone to 1600 px JPEG first.
   - Video goes through the 15-minute upload link already built for the web.
8. **Paying a shop's till.**
   - The app uses the existing customer routes (`GET /v1/store/account/pos-payments/:token`, then `pay { expected_amount }` or `decline`) with its session. No new route is needed.
   - The app sends `expected_amount` as shown, so a changed basket is refused (`basket_changed`) and shown again.
   - The `pos_wallet_payments` switch decides whether the link offers payment at all, as on the website.
9. **Analytics without trackers.**
   - Sign-up and posting journeys take `surface: app` and source `app`.
   - Traffic sources take the Play Install Referrer once, with consent.
   - Crash reports (Sentry, or Expo's) carry no personal data. They go in the privacy notice before release.

## App architecture

- **Routing and data:**
  - expo-router (file routes mirroring the tabs);
  - TanStack Query for server data (stale-while-revalidate as the consoles do, retries off for money steps);
  - Zustand for small local state.
- **Money steps:** every money POST sends an `Idempotency-Key` made once per attempt and kept until it succeeds or is refused. A retried tap never pays twice.
- **Offline:**
  - the last home page, listings viewed and chats are cached on the phone;
  - messages written offline queue and send in order;
  - post-an-ad drafts, photos included, are kept on the phone until uploaded;
  - money steps never run offline.
- **Security:**
  - session in the secure store;
  - Face ID, fingerprint or the phone's PIN before paying, paying out, releasing or showing a release code (`expo-local-authentication`), with a fallback to the account password;
  - screenshots blocked on the release code screen (Android `FLAG_SECURE`);
  - certificate pinning not used, as it breaks when certificates rotate; HTTPS only;
  - no secrets in the bundle.
- **Calls:** `react-native-webrtc` on the same signalling routes, plus CallKit (iOS) and ConnectionService (Android) for the system call screen. The microphone permission is asked on the first call.
- **Permissions, each asked at the moment of use with a sentence why:** camera (posting, chat photos), photos, microphone (calls, Ask Anjio by voice), notifications (after the first chat or order, never at launch), location (Near me, used on the phone to pick the nearest area and never sent).
- **Size and speed:**
  - Hermes;
  - lazy screens;
  - the download under 30 MB on Android;
  - first screen under 3 seconds on a low-end phone;
  - images cached on disk with a cap.

## Phases

Everything in phases 1 to 4 is the first release: money and calls are in it.

0. **API work** (above), and the app's foundations:
   - `mobile/udozo` with Expo, expo-router, copies of the shared helpers, the theme from `/v1/theme`;
   - app names and icons from `scripts/brand-assets.py`;
   - EAS builds for internal testers;
   - the privacy notice's app section.
1. **Browse and talk.**
   - Home, search, categories, listing, seller and brand pages.
   - Sign-in (email, Apple, Google, Facebook, WhatsApp) and onboarding.
   - Saved ads.
   - Chats with photos, offers shown, report and block.
   - Push notifications and the inbox.
   - Deep links.
2. **Sell.**
   - Post an ad with the camera and Fill from photos.
   - My listings, renew, mark sold, restock.
   - Requests and call backs, the dashboard, username.
3. **Money.**
   - **Wallet top-ups:**
     - the bank account number, got with the BVN in Nigeria;
     - card, and bank app or USSD, in an in-app browser that returns to the app;
     - sandbox simulate in test builds.
   - UdozoPay checkout and orders on both sides, with offers and buy orders becoming orders.
   - Connect Centre picking, with collection by the release code.
   - Payouts to a bank and adding a payout account.
   - Paying a shop's till from its QR code, plus the in-app scanner.
   - Biometrics on every money step.
   - The identity check through Udozo Verify in an in-app browser, where a market needs it.
4. **Calls and Anjio.**
   - Calls in the app and with the app closed (PushKit and CallKit, FCM and ConnectionService), missed calls and call backs.
   - Ask Anjio with streamed answers and its cards.
   - The WhatsApp connect screen.
5. **Beta.** Nigeria only:
   - Udozo's team;
   - then a closed beta of sellers from Marketing's pipeline;
   - real money in small amounts;
   - fixes.
6. **Stores and release** (last, as the owner decided):
   - **Store accounts:**
     - choose the publishing company;
     - Apple Developer as an organisation (D-U-N-S number);
     - Google Play developer account.
   - **Store pages:** listings, screenshots from the canvas, the data forms (Play's Data safety, Apple's privacy labels), age ratings and review notes.
   - **Review and release:** submit for review, then a staged rollout.

**Afterwards:**
- reviews and private ratings;
- wanted requests;
- auctions (bidding with live updates);
- Anjio's scores;
- personalisation controls;
- dark mode.

**Testing before the store accounts exist:**
- Android testers install EAS builds directly (APKs), with no Play account.
- iPhones need an Apple Developer account even for testing (TestFlight or ad hoc). Opening Apple's account early, before the store listing, lets iPhone testing start with Android. Otherwise iPhone testing waits for phase 6.
- PushKit and CallKit can only be tested on a real iPhone with that account.

## Build progress

**Phase 0, first slice (12 November 2026):**

- **The app's foundations** (`mobile/udozo`, Expo SDK 58, expo-router): Udozo's name, `com.udozo.app` on both
  platforms (changeable until the store accounts exist), the `udozo` scheme, Udozo's light and dark colours
  (`src/constants/theme.ts`), the five tabs as native tabs (SF Symbols and Material Symbols), each holding a short
  placeholder until its phase. Also:
  - the API client (`src/lib/api-core.ts`: the session header, an Idempotency-Key on every POST, a money step's own key
    kept, the API's error shape, the app's own words for no network or an unreadable answer);
  - the session in the secure store (`src/lib/session.ts`, this device only, while unlocked);
  - TanStack Query;
  - the update gate (`UpdateGate`, from `GET /v1/app/config`);
  - EAS profiles (`preview`: an internal APK; `production`);
  - icons and the splash from `scripts/brand-assets.py` (`MOBILE`).
  Tests: `npm test` (version maths and the API client under `node --test`), `npm run typecheck`, `npx expo lint`,
  `npx expo-doctor`.
- **App version gate** (API): `GET /v1/app/config?platform=ios|android&version=x.y.z` (`apps/udozo-api/src/app-config/`,
  public, Udozo's only, a minute in caches) answers `update` (`required`, `available`, `none`), the minimum and latest
  versions, the store link, the site and the legal pages. Admins set them in Settings > Integrations > **Mobile app**
  (`APP_IOS_MIN_VERSION`, `APP_IOS_LATEST_VERSION`, `APP_ANDROID_MIN_VERSION`, `APP_ANDROID_LATEST_VERSION`,
  `APP_IOS_STORE_URL`, `APP_ANDROID_STORE_URL`). Tests: `apps/udozo-api/test/app-config.test.mjs`.
- **Deep links** (udozo.com): `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`
  (`apps/udozo/lib/app-links.ts`), only on udozo.com itself (never a store's domain; the proxy leaves `.well-known`
  alone), 404 until the environment names the app: `UDOZO_IOS_APP_IDS` (`TEAMID.com.udozo.app`),
  `UDOZO_ANDROID_PACKAGE` and `UDOZO_ANDROID_CERT_SHA256` (from the signing key once EAS makes it). Tests:
  `apps/udozo/test/app-links.test.ts`.

**Phase 0, the rest (12 November 2026):**

- **Native sign-in** (`AppAccountController` in `apps/udozo-api/src/customers/app-account.controller.ts`, on the strict
  per-address limit; each answers as the web's finish: the customer, a session, `signed_up`):
  - `POST /v1/store/account/google/native { id_token, nonce, ref? }`: Google's ID token for the app's nonce, its
    audience the web client (`GOOGLE_CLIENT_ID`, which the app asks Google for as its server client) or one of the
    app's own (`GOOGLE_APP_CLIENT_IDS`, Settings > Integrations > Google sign-in). `verifyGoogleIdToken` is shared with
    the web's round trip.
  - `POST …/facebook/native { access_token }` (checked to be Udozo's app with `debug_token`, then `/me` with
    `appsecret_proof`) or `{ id_token, nonce }` (Limited Login, for iPhones that decline tracking, against
    `FACEBOOK_JWKS_URL`). Facebook's email is still confirmed by Udozo's code.
  - `POST …/apple/native { identity_token, nonce, authorization_code?, first_name?, last_name? }`
    (`CustomerAppleService`; Settings > Integrations > **Sign in with Apple**: `APPLE_BUNDLE_IDS`, `APPLE_TEAM_ID`,
    `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`): Apple's keys, the bundle ID as audience, the nonce or its SHA-256; a private
    relay email works as any other. The authorization code is exchanged for a refresh token kept encrypted
    (`customers.apple_refresh_token_encrypted`) only to revoke access on deletion.
  - The same rules as the web: a new identity signs up, never links itself to an account with the same email.
- **Deleting the account** (`AccountDeletionService`): `GET /v1/store/account/delete` (what stands in the way:
  money in a live wallet or payout account, open UdozoPay orders, open buy orders, a paid Udozo POS plan) and
  `POST …/delete { confirm: "DELETE", password? }` (the password when the account has one; wrong ones count towards
  the lockout). At once: details removed (`customers.deleted_at`, status disabled, the email freed), listings taken
  down, sessions ended, devices and WhatsApp link forgotten, Sign in with Apple revoked; orders and the ledger stay.
  On udozo.com: Profile > **Delete your account** (`/account/profile/delete`) and the public `/help/delete-account`
  (the page to give Google Play as the account deletion address; in the sitemap).
- **Phone push** (`src/notifications/native-push.ts`; Settings > Integrations > **Phone push (FCM and APNs)**:
  `FCM_SERVICE_ACCOUNT`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_TOPIC`, `APNS_SANDBOX`):
  `POST /v1/store/account/devices/phone { kind: fcm|apns|apns_voip, token, app_version? }` (the token encrypted,
  found by its SHA-256; `DeviceChannel` gains `fcm`, `apns`, `apns_voip`; `devices.app_version`). Notices go through
  FCM's HTTP v1 API (a service account's OAuth token) and APNs over HTTP/2 (an ES256 provider token), with the same
  queue, retries, preferences and dropping of gone tokens as browsers; VoIP tokens never get notices.
  `GET …/devices/push-settings` adds `phones { android, ios }`.
- **Calls to a closed app:** a customer with Udozo's app on a phone that can ring (`fcm` or `apns_voip`, opened in
  the last 30 days, still signed in) counts as reachable for calls and chats' online dot (`PushService.ringable`). A new
  call rings their phones (`PushService.ring`: a VoIP push to `<topic>.voip` on iPhones, a high-priority FCM data
  message on Android, carrying the call's id and the caller's public name only); Android phones are told to stop
  (`call_ended`, `reason: answered|ended`) when the call is answered, cancelled, declined or missed; iPhones read the
  call's state themselves.
- **Uploads from the app:** listing photos and video already go to the API (multipart, and the 15-minute video
  link). Profile photos and covers: `POST /v1/store/account/avatar|banner/uploads/:id/content` (the bytes through the
  API, as the consoles do), then `POST avatar|banner` as udozo.com does.
- **Sign-up journeys made in the app:** the app sends `Udozo-App: ios/0.1.0` (or `android/…`) on every call; journeys
  started from it are surface `app` (migration `20270327100000_mobile_app` widens the check), labelled "Udozo app on
  iPhone", with the new method and step `apple`. Reports > Sign-up journeys has a **Udozo app** tab.
- **App config features:** `GET /v1/app/config?…&country=NG` adds `features` (assistant, wanted, reviews, private
  ratings, seller scores, personalisation, WhatsApp, POS payments) from the market's switches (`appFeatures`); UdozoPay,
  buy orders, Connect and auctions stay on `GET /v1/classifieds/markets`.
- **The app:** sends `Udozo-App`, wears the theme Udozo's admins publish (`src/lib/palette.ts`, `useTheme`), and is
  linked to EAS as **@golojan/udozo** (`extra.eas.projectId` in `app.json`; Android keystore made and kept by EAS).
- **Privacy notice:** section 4d, Udozo's app (sign-in providers, phone push and calls, permissions, deleting the
  account in the app), and Google and Apple as push and sign-in providers in section 6.

Tests: `apps/udozo-api/test/app-sign-in.test.mjs` (fake Google, Facebook and Apple issuing real signed tokens),
`phone-push.test.mjs` (a fake FCM and a fake APNs speaking HTTP/2), `app-config.test.mjs`, `avatars.test.mjs`;
`mobile/udozo/test` (`npm test`).

**Owner's steps before testers use push, calls and native sign-in:** create the Firebase project and its Android app
(`com.udozo.app`, whose `google-services.json` the app needs) and paste a service account key; an Apple Developer
account (needed for any iPhone build), with an APNs key, a Sign in with Apple key and the bundle ID; the app's Google
client IDs; Facebook Login's Android key hash and iOS bundle ID in the Meta app; and, once EAS has the signing keys,
`UDOZO_IOS_APP_IDS`, `UDOZO_ANDROID_PACKAGE` and `UDOZO_ANDROID_CERT_SHA256` on udozo.com's Vercel project.

**Phase 1, browse and talk (12 November 2026):**

- **Screens** (`mobile/udozo/src/app`): the five tabs in `(tabs)` under a root stack, plus the listing
  (`listing/[ref]`: gallery, price, place and condition, details, description, the seller, the checks before paying,
  report, Save and Chat with seller in a bar that stays), seller (`seller/[key]`: cover, badges, figures, reviews and
  Anjio's view in words, listings), brand (`brand/[slug]`), category (`category/[slug]`: banner, subcategories),
  Search (words with suggestions, sort, condition), Home (the market's home page from `GET /v1/classifieds/home`:
  listing rails, category tiles, grids, banners; the market chosen once signed out, the account's own signed in; the
  bell), Chats (Buying and Selling, online dots, unread) and the chat (`chat/[id]`: messages read every 4 seconds,
  photos sent and shown with the session, offers with Accept, Decline and Withdraw, Make an offer, report, block), Saved,
  Notifications (read and marked read, Turn on notifications), Me, Settings and Delete my account.
- **Signing in** (`signin`, `signup`, `verify`): the email first, then the password, or an email with no account goes on
  to sign up; sign-up as udozo.com's wizard (the emailed code, then name, country fixed, the mobile kept to confirm
  later, password); Finish your account (the emailed code, About you for social sign-ups, the mobile's code or Confirm it
  later); Continue with Apple (iPhones), Google and Facebook (only in builds that have their IDs, `app.config.ts`;
  Facebook's SDK is linked only then, `react-native.config.js`) and WhatsApp (send the code, approve on WhatsApp, the
  app asks every 3 seconds). Google's library gives no nonce, so the API takes a nonce-less Google token only when it is
  under 10 minutes old.
- **Push:** the phone's own FCM or APNs token is registered when the app opens signed in (never asking), the permission
  asked once after the first chat message or from Notifications; a tapped notification opens its `link` through the
  app's screens.
- **Deep links:** `src/lib/links.ts` (`appLink`) turns udozo.com addresses (home links, notices, universal and App
  Links, `udozo://`) into the app's routes, `+native-intent.tsx` uses it, and pages the app lacks open on udozo.com in the
  in-app browser.
- **Shared code:** udozo.com's types and helpers (`packages/api-client/src/classifieds.ts`, `home.ts`, `storefront.ts`)
  are copied into `src/shared` (`node scripts/sync-shared.mjs`), since EAS uploads only the app's folder;
  `test/shared.test.ts` fails while a copy is out of date.
- **Tests:** `npm test` runs the pure helpers under `node --test`, then the screens under Jest (jest-expo and Testing
  Library: the listing page, sign-in and sign-up, a chat, deleting the account).

**Not in phase 1 (their phases):** posting ads (2), the wallet, UdozoPay and payouts (3), calls and Ask Anjio (4).
Views of listings opened in the app are not counted yet.

**Build settings for phase 1** (EAS environment variables): `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID`,
`GOOGLE_IOS_URL_SCHEME`; `FACEBOOK_APP_ID`, `FACEBOOK_CLIENT_TOKEN`; `GOOGLE_SERVICES_JSON` (a file variable: Firebase's
`google-services.json`, without which Android gets no push token).

**Phase 2, sell (12 November 2026):**

- **Post an ad** (`src/app/post/[id].tsx`, `id` `new` or a listing): udozo.com's wizard in five steps (what it is, photos,
  price and details, where it is and delivery, check and post), its rules in `src/lib/listing-form.ts` (`stepProblem`,
  `stepOf`, `firstIncomplete`, `bodyOf`; tested under `node --test`). Nothing is made until the first step's Next
  (`POST /v1/classifieds/listings`); every later Next saves (`PATCH`), so leaving keeps a draft, which opens at its first
  unfinished step. Photos from the camera or the gallery (several at once), scaled to 1600 px JPEG on the phone
  (`src/lib/picture.ts`, expo-image-manipulator) and sent as udozo.com's are; Make cover and remove. **Fill from photos**
  and **Suggest a price** where the market's assistant helps sellers, nothing applied until the seller chooses. The
  category's details as fields, chips or yes and no; the state and area pickers (`src/components/pickers.tsx`); the
  terms accepted once before posting; a refusal opens the step holding its field. A live ad's edits are saved without
  posting again. Resale, Udozo POS, Udozo Connect and auctions are left as the listing has them, with **More selling
  options on udozo.com**.
- **My listings** (`my-listings`): by state, each with what can be done now (`listingActions`: edit or carry on, see
  it, mark sold, restock (renewing an ad Anjio took off), renew in the last 3 days or once expired, delete).
- **Requests** (`requests`): contact requests (Share my contact, Decline) and call backs (Call, I called them,
  Dismiss), who can see the seller's contact (Stop sharing), and what was answered.
- **Dashboard** (`dashboard`): 7, 30 or 90 days, each figure with its change in words, a day-by-day bar of one
  figure, listings at a glance (opening My listings' groups), most viewed and Udozo's message board.
- **Username** (`username`): availability as typed, suggestions, the 30-day rule; or how many ads to go.
- The Sell tab is Post an ad, drafts to carry on and the seller's places; Me opens them in the app. Links: `/sell`,
  `/account/listings(/<id>)`, `/account/requests`, `/account/profile/username` and the app's own `udozo://<route>`.

**Phase 3, money (13 November 2026):**

- **Every money step** (paying an order, paying storage, releasing a delivery, paying a shop's till, paying out, showing
  a release code) opens a sheet naming the amount, then Face ID, the fingerprint or the phone's PIN
  (`confirmOnPhone` in `src/lib/biometrics.ts`, expo-local-authentication; a phone with no lock asks nothing more, the
  sheet being the confirmation). Its Idempotency-Key (`useMoneyKey`) is kept after no answer or a 5xx and made again
  after a refusal (`keepKey`), so a retried tap never pays twice. The rules are in `src/lib/money.ts` (udozo.com's
  `orderActions` and `orderNext`, checkout charges and body, the Buy button, the till link), tested under `node --test`.
- **Wallet** (`wallet`): both wallets, Add funds on the gateway's page in an in-app browser (returning to
  `udozo.com/account/wallet`), the top-up then read until it is added or not, with Cancel; the customer's own account
  number with Copy (the BVN in Nigeria); what moved. Sandbox builds simulate top-ups and transfers.
- **Buy with UdozoPay** (`checkout/[id]`, from the listing's bar or an accepted offer in a chat): meet-up, delivery
  (in the seller's state or elsewhere, the address) or a Connect Centre (the state, then the centre, its shipping, the
  Connect fee and the free time), every charge, the wallet, then the request; the terms asked for when the API wants
  them, then sent again.
- **Orders** (`orders`, `order/[id]`): buying and selling; on each, the seller accepts (after the identity check and a
  payout account), declines, enters the buyer's code at a meet-up, photographs it (two photos at least) and marks it
  sent (a courier and tracking, or dropped at the Connect Centre) and delivered; the buyer pays, shows the release code
  (never in a screenshot on Android, expo-screen-capture), pays storage owed at a centre, confirms a delivery, opens a
  dispute and writes in it; either cancels before the hand-over. Returns, auctions and resale orders link to udozo.com
  for the rest.
- **Payouts** (`payouts`): ready and held, bank accounts (the country's banks, the number; the bank names the holder),
  Pay to my bank, payouts with sandbox simulate; a refusal for the identity check opens it.
- **Identity check** (`identity`): Udozo Verify in an in-app browser with consent, read again on return.
- **Paying a shop's till** (`pay/[token]`, from `udozo.com/pay/<token>` links and **Scan to pay at a shop**, `scan`,
  expo-camera's QR reader, which opens only a Udozo till's code): the shop, the basket, the amount and time left, Pay
  (the exact amount shown) or Not my basket.
- Links: `/account/wallet`, `/account/payouts`, `/account/udozopay`, `/account/verification`, `/account/orders(/<id>)`,
  `/pay/<token>`. Buy orders stay on udozo.com for now.

**Fixes after reviewing phase 1 (12 November 2026):**

- **Calls (API):** a phone makes its owner reachable for calls only once its app answers them
  (`callsFromAppVersion`, `0.4.0`, phase 4), so phase 1 and 2 apps never leave a caller waiting 45 seconds.
- **Offline launch:** the account's error shows with Try again (`AccountPending`) instead of spinning; React Query
  reads again when the app returns to the front and when the connection comes back (`focusManager`, `onlineManager`
  with NetInfo), and polling stops in the background.
- **Chat photos** are scaled to 1600 px JPEG before sending (HEIC and 50 MP originals were refused).
- **WhatsApp sign-in** asks one question at a time and clears a passing error.
- **Sign-up** shows refusals that belong to no field on the step shown.
- **A tapped notice** opens once (cleared after handling).
- **Links:** other apps' returns (Facebook's `fb<id>://`) are left to their SDKs; the app's own routes and a market's
  home (`/gh`) open as asked.
- **Search** stops paging at the API's 1,000.

## Testing

- Unit and component tests with Jest and React Native Testing Library, kept beside each feature as the apps' Vitest tests are.
- End-to-end flows with Maestro on an Android emulator in CI:
  - browse;
  - sign in;
  - chat;
  - post an ad;
  - add funds and pay in the sandbox;
  - collect with a release code;
  - pay out;
  - pay a till from a QR code.
- Calls with the app closed are tested by hand on real phones (an iPhone and a low-end Android), as emulators cannot show CallKit or ConnectionService faithfully.
- The API's own tests cover the new routes (native sign-in, devices, app config), on PGlite and Docker as always.
- **Manual pass before each release:**
  - a 2 GB Android phone on throttled 3G;
  - an iPhone with VoiceOver;
  - Android with TalkBack;
  - large text.

## App store and legal points

- **Apple:**
  - Sign in with Apple (4.8);
  - account deletion inside the app (5.1.1(v)), which needs an API route that closes the account and keeps what the law requires;
  - user-generated content: report, block and moderation (1.2), already built.
- **Payments:** UdozoPay and wallet top-ups pay for physical goods and services between people, so neither store's in-app purchase applies. Say so in the review notes.
- **Privacy notice and cookie notice (on udozo.com):** add the app's own data before release:
  - push tokens and devices;
  - crash reports;
  - camera, microphone and location use (location stays on the phone);
  - the install referrer;
  - biometric unlock (done on the phone; Udozo never receives it).
- **Store listing:** age rating 17+ on iOS (unrestricted web access through chat links, user-generated content), Teen or higher on Play. It matches the terms' minimum age.
- **Lawyers' review:** as for the website, plus the store terms each app accepts.

## Decided (12 November 2026)

1. Expo React Native.
2. Money (wallet, UdozoPay, Connect collection, payouts) in the first release.
3. Calls ring when the app is closed, from launch.
4. Store accounts are settled last, in phase 6.
5. A Udozo POS till's QR code opens the app to pay.

## Still open

- Whether to open the Apple Developer account early, so iPhones are tested alongside Android (see Phases).
