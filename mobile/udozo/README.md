# Udozo for iPhone and Android

Udozo's mobile app, built with Expo (React Native) and TypeScript. The plan, phases and screens are in
`docs/UDOZO_MOBILE_APP_PLAN.md`.

It sits in `mobile/udozo`, outside the npm workspaces: Expo's SDK needs a newer React than the websites use, so the
app has its own `package.json` and lockfile, and the websites' builds and CI never install it.

## Commands

```bash
npm install
npx expo start          # the development server (Expo Go, or a development build)
npm run typecheck       # the app, then its tests
npm test                # the pure helpers under node --test, then the screens under Jest
node scripts/sync-shared.mjs  # after udozo.com's shared types change (packages/api-client/src)
npx expo lint
npx expo install <pkg>  # always, so versions match the SDK
```

## Builds

EAS builds and signs in the cloud (`eas.json`), as the project **@golojan/udozo** (its ID in `app.json`). Run from
this folder with `EAS_NO_VCS=1`, since the monorepo, not this folder, is the git repository (`.easignore` keeps
`node_modules` out of the upload):

- `EAS_NO_VCS=1 npx eas-cli@latest build --profile preview --platform android` makes an APK for internal testers
  (EAS keeps the Android signing key);
- iPhones need an Apple Developer account even for testers (TestFlight or ad hoc);
- `production` is for the stores, decided last (the plan's store accounts).

The bundle ID and package are `com.udozo.app`, and can change until the store accounts exist.

## How it fits

- **API:** `https://api.udozo.com` (`app.json`'s `extra.apiUrl`), with the customer's session in the phone's secure
  store, sent as `BitoCard-Customer-Session`, and an `Idempotency-Key` on every POST (`src/lib/api-core.ts`).
- **Updates:** at launch the app asks `GET /v1/app/config`. Below the minimum version it must be updated; below the
  latest it offers the update. Admins set both in Udozo's admin, Settings > Integrations > Mobile app.
- **Links:** udozo.com serves `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`
  (`apps/udozo/lib/app-links.ts`) once `UDOZO_IOS_APP_IDS`, `UDOZO_ANDROID_PACKAGE` and `UDOZO_ANDROID_CERT_SHA256` are
  set on its Vercel project. `app.json` lists the same paths.
- **Icons:** written by `python scripts/brand-assets.py` from `assets/udozo/logo.png`; never edit them by hand.
- **Screens:** `src/app` (expo-router): the tabs in `(tabs)`, the rest stacked over them. udozo.com addresses become the
  app's screens through `src/lib/links.ts`; anything else opens on udozo.com in the in-app browser.
- **Selling and buying:** wholly in the app: Post an ad (with a video, chosen or recorded, and the brand and model
  pickers), auctions (and a won Udozo lot sent to a Connect Centre), UdozoPay orders with their Connect returns,
  auction claims and resale threads, buy orders and My Resellers. The rules each screen follows are in `src/lib`
  (`listing-form.ts`, `auctions.ts`, `order-extras.ts`, `buy-orders.ts`, `resellers.ts`, `money.ts`), kept free of React
  Native and tested under `node --test`.
- **Ask Anjio:** `src/app/assistant.tsx`; answers stream through `expo/fetch` (React Native's own fetch cannot read a
  body as it arrives) and their few HTML tags are drawn as text by `src/lib/answer-html.ts`, never in a web view.
- **WhatsApp:** Settings > WhatsApp (`src/app/whatsapp.tsx`) connects the customer's number with `LINK <code>`.
- **Calls** (0.4.0, the version the API rings phones from): Call seller on a listing and Call in a chat ring the
  other side through Cloudflare's relay only (react-native-webrtc). The engine and its rules are `src/lib/call-engine.ts`
  and `src/lib/calls.ts` (free of React Native, under `node --test`), the panel and presence `src/components/calls`,
  the phone's own call screen `src/lib/call-system.ts` (react-native-callkeep: CallKit, Android's ConnectionService
  self-managed). With the app closed, iPhones ring from a VoIP push reported to CallKit natively
  (`plugins/with-udozo-calls.js` adds PushKit to the AppDelegate), Android from Firebase's data message through
  expo-notifications' background task (`src/lib/call-task.ts`, defined in `index.ts`, the app's entry). Calls need
  a development build: Expo Go has none of these native modules, and the app offers no calls there. What real phones
  must still prove is in the plan's Build progress. Ring tones: `python scripts/call-tones.py`.
- **Shared types:** `src/shared` holds copies of udozo.com's `packages/api-client/src/classifieds.ts`, `home.ts` and
  `storefront.ts`, imported as `@shared/...`; `test/shared.test.ts` fails when they drift.
- **Build-time settings** (EAS environment variables, read by `app.config.ts`): `GOOGLE_WEB_CLIENT_ID`,
  `GOOGLE_IOS_CLIENT_ID` and `GOOGLE_IOS_URL_SCHEME` (Continue with Google); `FACEBOOK_APP_ID` and
  `FACEBOOK_CLIENT_TOKEN` (Continue with Facebook; its SDK is linked only then, `react-native.config.js`);
  `GOOGLE_SERVICES_JSON` (Firebase's file, for Android push); `UDOZO_API_URL` (another API, for test builds).
