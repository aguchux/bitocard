# BitoCard app: store listings and release checklist

For whoever sets up the app in Google Play Console and App Store Connect. The app is `mobile/bitocard`
(`com.golojan.bitocard.android` on Google Play, `com.golojan.bitocard.ios` on the App Store). Nothing here starts a build: EAS builds wait for the owner's go.

## Listing

- **Name:** BitoCard
- **Subtitle (Apple, 30 characters):** Airtime, data and gift cards
- **Short description (Google, 80 characters):** Buy airtime, data and gift cards. Sell gift cards and unused airtime.
- **Description:**

  > BitoCard is the app for bitocard.com: top up your phone, buy data, and buy and sell gift cards from one wallet.
  >
  > - Buy airtime and data for any network: the network is found from the number.
  > - Buy gift cards at the day's rate. Your codes stay hidden until you reveal them with Face ID, your fingerprint or
  >   your phone's PIN.
  > - Sell gift cards: see exactly what you will be paid before you send the card.
  > - Sell airtime you do not need, or buy unused airtime from the live pool.
  > - Add money by card, bank transfer or mobile money, or to your own account number, and move money between your
  >   wallets.
  > - Follow every order, get notified when it arrives, and chat with us if something is wrong.
  >
  > Products, payment methods and selling vary by country.

  Keep it true: say only what is switched on in the markets the app is published in. Never name suppliers.
- **Category:** Finance (Apple: Finance; Google: Finance). **Age:** 18+ (wallets and payments).
- **Countries:** only the markets BitoCard sells in (Nigeria, Ghana and Kenya first).
- **Support URL:** https://bitocard.com · **Privacy policy:** https://legals.bitocard.com/documents/privacy
- **Delete account URL (Google):** https://bitocard.com/delete-account

## Screenshots

Phone screenshots of Home, the Mobile tab with a network found, a gift card with the day's rate, Confirm payment,
an order delivered with its codes masked, the Wallet tab, and the airtime exchange. Use a sandbox account: no real
codes, names, numbers or balances. iPhone 6.9" and 6.5", and Android phone; no tablet (the app is phone only).

## Google Play: Data safety

Data is encrypted in transit; users can ask for deletion (in the app and by email). Collected, none shared for
advertising, none sold:

| Data | Collected | Why | Optional |
|---|---|---|---|
| Name, email address, phone numbers | Yes | Account management, app functionality | Phone numbers optional |
| Financial info: purchase history, other financial info (wallet, payouts) | Yes | App functionality, fraud prevention | No |
| Photos | Yes, only when selling a gift card by photo | App functionality | Yes |
| Government ID and face photos (identity check, in the browser) | Yes, where the market requires it | Fraud prevention, legal compliance | Required only for some products |
| Messages (chat and questions with BitoCard) | Yes | Customer support | Yes |
| App info and performance | No crash reporting is built in | | |
| Device or other IDs (push token) | Yes, when notifications are allowed | App functionality (notifications) | Yes |
| Location | No | | |

Card numbers are entered on the payment provider's page, never in the app. Face ID and fingerprints are checked by
the phone; the app never receives them.

## Apple: App Privacy

"Data Linked to You": Contact Info (name, email, phone), Financial Info (purchase history, other financial info),
User Content (photos, customer support), Identifiers (user ID), Sensitive Info (identity check only). Purposes: App
Functionality, Fraud Prevention. No tracking. No data used for advertising.

- **Sign in with Apple** is not needed: the app offers only BitoCard's own email and password.
- **Account deletion:** Settings, then Delete your account (Apple's guideline 5.1.1(v)).
- **Review notes:** give the reviewer a sandbox account (email, password) in a market with sandbox checkout, so
  orders complete with test codes. Say that money moves only through the customer's own wallet and the payment
  providers' pages, and that gift cards are sold for use with the brands, not as in-app content.
- **Export compliance:** `usesNonExemptEncryption: false` (HTTPS only) is in `app.json`.

## Before the first store build

1. **Opening bitocard.com links in the app:** set on the storefront's Vercel project
   `BITOCARD_IOS_APP_IDS` (`<Team ID>.com.golojan.bitocard.ios`), `BITOCARD_ANDROID_PACKAGE` (`com.golojan.bitocard.android`) and
   `BITOCARD_ANDROID_CERT_SHA256` (Play App Signing's certificate fingerprint, from Play Console > App integrity).
   Then check `https://bitocard.com/.well-known/apple-app-site-association` and `…/assetlinks.json` answer JSON.
2. **Push:** add Firebase's `google-services.json` to the app (`android.googleServicesFile` in `app.json`), and in
   admin Settings > Integrations > Phone push: the Firebase service account, and the APNs key ID, team ID, `.p8` key
   and topic `com.golojan.bitocard.ios` (Development builds off for TestFlight and the App Store).
3. **The update gate:** admin Settings > Integrations > Mobile app: save each store link, then set its newest version only after that build is live. Every older app is forced to update.
4. **Try it on phones** in a development build against the live API: sign in, buy airtime in the sandbox, a
   notification arriving and opening its order, a bitocard.com order link opening the app.
5. **Version:** from `mobile/bitocard`, run `npm run version:bump -- patch` (or `minor`, `major`, or an explicit version such as `1.2.0`). It updates both manifests, the lock file, and both native store build numbers.
6. **Build:** only on the owner's go: `EAS_NO_VCS=1 npx eas-cli build -p android --profile production` (and `-p ios`) from
   `mobile/bitocard`.
