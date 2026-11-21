# Udozo on Google Play: the store listing

Everything for Play Console > Grow users > Store presence > Main store listing. The images are in `out/`, made by
`node store-listing/render.mjs` (run it again after changing a screen or a headline; `… render.mjs phone` draws only
the phone screenshots, feature graphics and icon, to check them quickly).

Keep every word true for the markets the app is published in. UdozoPay, Udozo Connect (Connect Centres), auctions,
calls and Anjio are each behind switches or settings that may be off: use the lines marked *(only once … is on)* only
where they are on, and the screenshots that show them likewise (see Images).

## App name (30 characters)

Use: **Udozo: Buy & Sell Near You** (26)

Alternatives:
- Udozo Marketplace (17)
- Udozo: Buy, Sell, Chat & Pay (28)

## Short description (80 characters)

Use: **Buy and sell phones, cars, homes and more near you. Chat and call sellers safely.** (79)

Alternatives:
- Post an ad in minutes, chat with buyers and sell what you don't use. (67)
- *(only once UdozoPay is on)* Buy and sell near you, and pay safely with UdozoPay. (53)

## Full description (up to 4,000 characters)

```
Udozo is the app for udozo.com: buy and sell phones, cars, homes, fashion, furniture and more with people near you.

FIND IT NEAR YOU
• Browse every category in your country, from phones and vehicles to property, fashion and services
• Search by what you want and where you are, and filter by price, condition, brand and more
• Save ads to come back to them later

SELL WHAT YOU DON'T USE
• Post an ad in minutes: take photos or a short video with your camera
• See what similar ads are priced at before you set yours
• Manage your ads, mark them sold, restock and renew them from My listings
• Choose a username and get your own seller page to share

CHAT AND CALL, PRIVATELY
• Chat with buyers and sellers, send photos and make offers
• Call sellers from the app without sharing your phone number
• Request a call back, or ask a seller to share their contact details

STAY SAFE
• Follow Udozo's safety checks for each category before you pay
• Report an ad or a chat, or block someone, in one tap

ALWAYS UP TO DATE
• Notifications for new messages, offers, calls and your orders
• Sign in with your email, Google, Facebook or WhatsApp
• Delete your account at any time in Settings

What you can do varies by country. Udozo is owned and operated by DE-GOLOJAN TECHNOLOGIES LTD (RC 1606658).
Help: https://udozo.com/help/contact · Privacy: https://udozo.com/legal/privacy
```

*(only once UdozoPay is on)* add after CHAT AND CALL, PRIVATELY:

```
PAY SAFELY WITH UDOZOPAY
• Pay from your Udozo wallet; the seller is paid only once you have the item
• Every payment is confirmed with Face ID, your fingerprint or your phone's PIN
• Your release code stays hidden until you show it, and never appears in a screenshot
• Get paid for your sales straight to your bank
```

*(only once Udozo Connect is on)* add after it:

```
COLLECT AT A CONNECT CENTRE
• Have items sent to a Udozo Connect Centre near you
• Check the item at the counter before you accept it
```

*(only once the assistant is on)* add to FIND IT NEAR YOU: `• Ask Anjio, Udozo's assistant, to find things for you`

*(only once seller reviews are on)* add to STAY SAFE: `• Read reviews of sellers from people who bought from them`

## Release notes (500 characters)

```
<en-GB>
First release of the Udozo app.

• Browse and search ads near you
• Post an ad with photos and video from your camera
• Chat with buyers and sellers, make offers and call without sharing your number
• Notifications for messages, offers and calls
• Sign in with email, Google, Facebook or WhatsApp
</en-GB>
```

## Images

| Play field | File | Size |
|---|---|---|
| App icon | `out/icon-512.png` | 512 × 512 |
| Feature graphic (pick one) | `out/feature-graphic/feature-graphic-1.png` (blue, the app), `-2` (light, every category), `-3` (sky, selling) | 1024 × 500 |
| Phone screenshots (2 to 8) | `out/phone/01-home.png` to `08-wallet.png` | 1080 × 1920 |
| 7-inch tablet screenshots | `out/tablet-7in/01-…08` | 1920 × 1080 |
| 10-inch tablet screenshots | `out/tablet-10in/01-…08` | 2560 × 1440 |
| Chromebook screenshots | `out/chromebook/01-…08` | 3840 × 2160 |
| Foldable screenshots (3 to 8) | `out/foldable/01-…08`: unfolded 1:1 (`01`, `04`, `07`), unfolded 4:3 (`02`, `05`, `08`), outer screen 10:16 (`03`, `06`) | 2160 × 2160, 2160 × 1620, 1200 × 1920 |
| Android XR screenshots (4 to 8) | `out/xr/01-…08`: the app as a floating panel in a room | 3840 × 2160 (16:9) |
| Video | none: Play takes only a YouTube link | |

Screenshots that show a feature behind a switch: `02-listing` and `05-checkout` (UdozoPay, a Connect Centre),
`06-order` (a UdozoPay order at a Connect Centre), `07-call` (calls need Cloudflare TURN set), `08-wallet` (payouts
of UdozoPay sales). Until those are on where the app is published, upload `01-home`, `03-chat` and `04-sell` (and
drop the offer's Buy button from `03-chat` if UdozoPay is off).

The screens are drawn from the app's real screens with made-up data (Chinedu E., Amaka O., example listings and
prices); no real person, number, listing or code, and no other company's logo or product photo. Swap them for real
captures from a test account whenever you like.

## Store settings

- **Category:** Shopping. **Tags:** Classifieds, Marketplace, Buy and sell.
- **Contact email:** support@udozo.com · **Website:** https://udozo.com
- **Privacy policy:** https://udozo.com/legal/privacy
- **Delete account:** https://udozo.com/help/delete-account
- **Countries:** only the markets where Udozo is open (Nigeria first).
- **Content rating:** answer the questionnaire honestly (users talk to each other, share their location by area and
  buy physical goods); target audience 18 and over.
