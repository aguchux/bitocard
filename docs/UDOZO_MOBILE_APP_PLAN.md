# Udozo mobile app: plan

**Status:** planned on 12 November 2026 (the owner's request). Nothing built yet.

**Design:** the screens are on the design canvas "Udozo mobile app" (24 phone screens in five flows: get started, find, talk and buy, sell, you). This plan and that canvas go together. Where the canvas and this plan differ, this plan wins until the owner decides.

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

## Product decisions (owner to confirm)

1. **Expo (React Native) with TypeScript, one codebase for iOS and Android**, as `apps/udozo-mobile` (`@udozo/mobile`) in this monorepo.
   - It shares the types and pure helpers of `@bitocard/api-client/classifieds` (conditions, money, `sellerPath`, `brandPath`, category matching) and Udozo's words.
   - Builds and store uploads go through EAS Build and EAS Submit. JavaScript-only fixes ship through EAS Update, never anything that changes permissions or native code.
   - Not native Swift and Kotlin: that would be two codebases for one team. Not a wrapped website: it would bring no camera flow, calls or push worth having.
2. **Android first in testing, both stores at launch.**
   - Target Android 8 and up, and iOS 16 and up.
   - Design and test for a 2 GB RAM Android phone on 3G.
3. **Browse without an account.** Sign-in is asked for only to chat, call, save, post or pay. It returns the user to the same place.
4. **Five tabs:** Home, Search, Sell (the raised centre button), Chats, Me. The listing page, chat, checkout and post-an-ad screens are pushed screens, with no tab bar.
5. **Same rules as udozo.com.** Every rule stays in the API: limits, refusals, UdozoPay, terms acceptance, identity checks. The app only draws the API's answers and words its refusal codes.

## Screens (the canvas)

| Flow | Screens |
|---|---|
| 1 Get started | Welcome (Skip to browse), Sign in (email first, then Google, Facebook, WhatsApp; Apple on iOS, see below), Sign up (emailed code), About you (first and last name, country fixed once, mobile kept unconfirmed) |
| 2 Find | Home (search with Near me, hero reel, Shop by category, For you), Search results (filter chips, sheets for filters and area, Best match), Category (banner, subcategories, brands), Listing (gallery, badges, Connect card, details, seller card, safety checks, sticky Chat, Call and Buy with UdozoPay), Seller page (cover, badges, figures, Anjio's view, listings and reviews) |
| 3 Talk, call and buy | Chats (Buying and Selling, online dots, requests), Chat (listing strip, offer and order cards, quick replies, photo), Call (through Cloudflare TURN, number private), UdozoPay checkout (Connect Centre or meet-up, wallet, every fee, confirm sheet with Face ID), Order (ready to collect, release code hidden until Show, centre, progress, report) |
| 4 Sell | Post an ad in three screens: photos (camera, gallery, video, Fill from photos), details (category, condition, price with Anjio's range, brand and model, stock, description, place), review (UdozoPay, Connect, resellers, terms); My listings (status filters, Edit, Mark sold); Dashboard (period, four figures, chart, message board, most viewed) |
| 5 You | Me (profile, mobile reminder, wallet, orders, saved, Selling, Buying, Account), Wallet and payouts (wallet, sales ready and held, bank account, Pay to my bank, transactions), Notifications (push prompt, today, earlier), Ask Anjio (cards, price range, thumbs, Talk to a person, voice), Settings and privacy (profile, Face ID, devices, personalisation, history, appearance, data saver, delete account) |

**Still to draw before build:**
- **States and sheets:**
  - empty states;
  - error states, with no internet and the API refusing;
  - loading skeletons;
  - the filter sheet, the area picker and the offer sheet;
  - the counter-offer and buy-order cards;
  - the identity check (Udozo Verify in an in-app browser).
- **Other screens:**
  - add funds (card, bank transfer to the reserved account, mobile money);
  - the payout bank form;
  - reviews and rating forms;
  - wanted requests;
  - auctions (bid panel);
  - Connect Centre picker with map;
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
3. **Calls that ring when the app is closed.** A VoIP push (`apns-push-type: voip`; on Android a high-priority FCM data message) wakes CallKit or ConnectionService, then the call runs as today (signals, TURN only).
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
8. **Analytics without trackers.**
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

0. **API and decisions** (above).
   - Then:
     - store accounts (Apple Developer as an organisation, Google Play), D-U-N-S for Apple;
     - app names and icons from `scripts/brand-assets.py`;
     - the privacy notice and the store data forms (Play's Data safety, Apple's privacy labels).
1. **Browse and talk.**
   - Home, search, categories, listing, seller and brand pages.
   - Sign-in (email, Google, Facebook, Apple, WhatsApp) and onboarding.
   - Saved ads.
   - Chats with photos, offers shown, report and block.
   - Push notifications and the inbox.
   - Deep links.
2. **Sell.**
   - Post an ad with the camera and Fill from photos.
   - My listings, renew, mark sold, restock.
   - Requests and call backs, the dashboard, username.
3. **Money.**
   - Wallet top-up (card and mobile money in an in-app browser, the bank account number, sandbox simulate in test builds).
   - UdozoPay checkout and orders, both sides.
   - Connect Centre picking and collection with the release code; buy orders.
   - Payouts to a bank, with biometrics on each step.
   - Identity check through Udozo Verify in an in-app browser.
4. **Calls and Anjio.**
   - Calls with CallKit and ConnectionService.
   - Ask Anjio with streamed answers and its cards.
   - The WhatsApp connect screen.
5. **The rest:**
   - reviews and private ratings;
   - wanted requests;
   - auctions (bidding with live updates);
   - Anjio's scores;
   - personalisation controls;
   - dark mode;
   - release.

**Pilot:** Nigeria only, internal testing (TestFlight, Play internal track), then a closed beta of Udozo's sellers from Marketing's pipeline, then the stores.

## Testing

- Unit and component tests with Jest and React Native Testing Library, kept beside each feature as the apps' Vitest tests are.
- End-to-end flows with Maestro on an Android emulator in CI:
  - browse;
  - sign in;
  - chat;
  - post an ad;
  - pay in the sandbox;
  - collect with a release code.
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

## Open questions for the owner

1. Expo React Native as above, or another choice?
2. Should the app launch with money (UdozoPay, wallet, payouts) in phase 3, or start as browse, chat and sell only?
3. Should calls ring when the app is closed (CallKit, VoIP push) at launch, or only in-app at first?
4. Store accounts: which company publishes Udozo on the App Store and Google Play?
5. Should a buyer scanning a Udozo POS till's QR code (`udozo.com/pay/<token>`) pay in the app when it is installed? (Planned above; the website keeps working without it.)
