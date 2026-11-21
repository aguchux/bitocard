# Udozo app: Google Play listing and release checklist

For whoever sets up the app in Google Play Console. The app is `mobile/udozo` (`com.golojan.udozo.android` on Google Play; `com.golojan.udozo.ios` on iOS). The listing's words
and images are in `mobile/udozo/store-listing` (`LISTING.md`, and `node store-listing/render.mjs` for the images).
EAS builds start only on the owner's go.

## Play Console: App content

### Data safety

Data is encrypted in transit; people can delete their account in the app (Settings > Delete my account) and on the
web (https://udozo.com/help/delete-account). Nothing is sold or used for advertising, and nothing is shared with
third parties except service providers working for Udozo (Play does not count those as sharing).

| Data | Collected | Why | Optional |
|---|---|---|---|
| Name, email address, phone number | Yes | Account management, app functionality | Phone optional until something needs it |
| Approximate location (the area the person chooses, typed or picked) | Yes | App functionality (ads near them) | Yes; no GPS is read |
| Photos and videos | Yes, only those the person adds to an ad, a chat or a dispute | App functionality | Yes |
| Voice (calls between buyers and sellers) | No: relayed live, never recorded or kept | | |
| Messages (chats, requests, the assistant, support) | Yes | App functionality, customer support | Yes |
| Financial info: purchase history, other financial info (wallet, UdozoPay orders, payout bank account) | Yes | App functionality, fraud prevention | Required to pay or be paid |
| Government ID and face photos (Udozo Verify, in the browser) | Yes, only where a check is required | Fraud prevention, legal compliance | Required only for some actions |
| Date of birth, sex (profile's About you) | Yes, if the person gives them | App functionality | Yes |
| App activity: ads viewed, searches, taps (personalisation) | Yes | Personalisation, analytics | Yes; turned off in Account > Privacy on udozo.com |
| Device or other IDs (push and call tokens) | Yes, when notifications are allowed | App functionality | Yes |
| Crash logs and diagnostics | No: none built in | | |

Payment card numbers are entered on the payment provider's page, never in the app. Face ID and fingerprints are
checked by the phone; the app never receives them. Google and Facebook sign-in send Udozo only the name, email and an
account ID; the Facebook SDK is built with app events, the advertising ID and automatic logging off.

### Permissions Play asks about

The manifest (pinned by `mobile/udozo/test/play-manifest.test.ts`) has no photo, video, audio-file or storage
permission (the system photo picker needs none), no phone-state, call-log or SMS permission, and nothing that draws
over other apps. What needs a declaration:

- **Foreground service, `phoneCall` and `microphone`** (`FOREGROUND_SERVICE_PHONE_CALL`, `FOREGROUND_SERVICE_MICROPHONE`):
  a call between a buyer and a seller in progress. Describe it as an ongoing VoIP call the person started or
  answered, shown on Android's own call screen (a self-managed ConnectionService), and give a short screen recording
  of a call.
- **Full-screen notifications** (if Play lists `USE_FULL_SCREEN_INTENT`): incoming calls only, as a calling app.
- **Camera and microphone:** photos and videos for ads and chats, scanning a shop's code to pay, and calls.

### The rest

- **Target audience:** 18 and over. **Content rating:** users interact and exchange contact; purchases of physical
  goods; no gambling (auctions are bids on real items, only where switched on).
- **Ads:** the app contains no ads from ad networks. (Sponsored listings and Udozo's own banners are Udozo's own
  content: answer "No" to ads unless that changes.)
- **Financial features:** the wallet and UdozoPay hold money through Udozo's licensed payment partners; payouts go to
  the person's own bank account. Answer the financial-features declaration accordingly once UdozoPay is on.
- **App access (review):** give Google a test account (email and password, email confirmed) in a market with the
  sandbox, and say that calls and chats need a second account to try.
- **Account deletion URL:** https://udozo.com/help/delete-account

## Before the first Play build

1. **EAS environment variables** (project @golojan/udozo, production): `GOOGLE_SERVICES_JSON` (a file variable,
   Firebase's `google-services.json` for `com.golojan.udozo.android`; without it Android gets no push and no incoming calls),
   `GOOGLE_WEB_CLIENT_ID` (Continue with Google), `FACEBOOK_APP_ID` and `FACEBOOK_CLIENT_TOKEN` (Continue with
   Facebook). Each feature is left out of the build, not broken, while its variable is missing. Google sign-in on
   Android also needs an Android OAuth client in the same Google Cloud project for package `com.golojan.udozo.android`
   with Play App Signing's SHA-1 (and the upload key's, for builds tried before Play), and the Meta app needs the
   package and its key hashes under Android. The iPhone app's bundle ID is `com.golojan.udozo.ios`: register it with
   Apple, and use it for Phone push's APNs topic and Sign in with Apple's bundle IDs in the admin.
2. **The API** (admin.udozo.com Settings > Integrations): Phone push (the Firebase service account), Calls
   (Cloudflare TURN), and Mobile app (the Play store link, the lowest and latest versions).
3. **Opening udozo.com links in the app:** on the `udozo` Vercel project set `UDOZO_ANDROID_PACKAGE` (`com.golojan.udozo.android`)
   and `UDOZO_ANDROID_CERT_SHA256` (Play App Signing's certificate fingerprint, from Play Console > Test and release >
   App integrity), then check `https://udozo.com/.well-known/assetlinks.json` answers JSON.
4. **Build** (on the owner's go), from `mobile/udozo`:
   `EAS_NO_VCS=1 npx eas-cli build -p android --profile production` gives the signed AAB (versionCode set by EAS,
   `appVersionSource: remote`).
5. **Upload:** the first AAB by hand in Play Console (Internal testing), since Play's API cannot create the app. After
   that, `npx eas-cli submit -p android --profile production` sends builds to the internal track as drafts, with the
   Play service account key saved as `mobile/udozo/google-service-account.json` (never committed or built: both
   ignore files list it).
6. **Release:** internal testing, then closed testing (a new personal developer account needs 12 testers for 14 days;
   an organisation account does not), then production with a staged rollout.
