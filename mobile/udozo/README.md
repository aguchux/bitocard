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
npm test                # the pure helpers (version maths, the API client) under node --test
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
