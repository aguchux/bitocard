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
   - Devices get a `kind`: `web` (today) or `fcm` / `apns` (the app). Registration: `POST /v1/store/account/devices { kind, token, app_version, platform }`.
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

**Still to do in phase 0:** native sign-in (Google, Facebook, Apple), device kinds `fcm`, `apns` and `apns_voip` with
FCM and APNs senders, VoIP call pushes and app reachability, account deletion, upload checks from the app, `surface:
app` in the journeys, the theme from `/v1/theme`, the feature flags on `/v1/app/config`, the privacy notice's app
section, and the first internal EAS build.

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
