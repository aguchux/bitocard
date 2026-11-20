# BitoCard on Google Play: the store listing

Everything for Play Console > Grow users > Store presence > Main store listing. The images are in `out/`,
made by `node store-listing/render.mjs` (run it again after changing a screen or a headline).

Keep every word true for the markets the app is published in. Selling gift cards and the airtime exchange are
behind switches that are off by default: use the lines marked *(only once selling is on)* only where they are on.
Never name BitoCard's suppliers.

## App name (30 characters)

Use: **BitoCard: Gift Cards & Airtime** (30)

Alternatives:
- BitoCard: Airtime, Data, Bills (30)
- BitoCard: Airtime & Gift Cards (30)
- BitoCard: Top Up & Gift Cards (29)

## Short description (80 characters)

Use: **Buy airtime, data and gift cards. Pay bills and TV from one secure wallet.** (74)

Alternatives:
- Top up any network, buy gift cards at the day's rate and pay bills in seconds. (78)
- Airtime, data, gift cards, electricity and TV bills, all from one wallet. (73)
- *(only once selling is on)* Buy and sell gift cards, top up airtime and data, and pay bills in one app. (75)

## Full description (up to 4,000 characters)

```
BitoCard is the app for bitocard.com: top up your phone, buy data, buy gift cards and pay your bills, all from one secure wallet.

TOP UP ANY NETWORK
• Buy airtime and data bundles for MTN, Airtel, Glo, 9mobile and other networks
• Type the number and BitoCard finds the network for you
• Choose an amount or a data plan and it's delivered in seconds

GIFT CARDS AT THE DAY'S RATE
• Buy gift cards for shopping, games, music, streaming, apps and more
• See the rate and exactly what you pay before you buy
• Your codes stay hidden until you reveal them with Face ID, your fingerprint or your phone's PIN, and screenshots of them are blocked

PAY BILLS AND TV
• Buy prepaid electricity and get your token in the app
• Renew or change your pay-TV package
• See the name on the meter or smartcard before you pay, so your money never goes to the wrong account

ONE WALLET FOR EVERYTHING
• Add money by card, bank transfer or mobile money
• Get your own account number and fund your wallet from any bank app
• Keep a wallet in your own currency and one in US dollars, and move money between them
• Every payment is confirmed with Face ID, your fingerprint or your phone's PIN

ALWAYS KNOW WHERE YOUR ORDER IS
• Follow every order from paid to delivered
• Get a notification the moment it arrives
• Something wrong? Report a problem on the order, or chat with us in the app

SAFE BY DESIGN
• Card details are entered on the payment provider's own page, never in the app
• Face ID and fingerprints are checked by your phone; BitoCard never sees them
• Delete your account at any time in Settings

Products, payment methods and prices vary by country. BitoCard is a Golojan Ltd venture.
Help: https://bitocard.com · Privacy: https://legals.bitocard.com/documents/privacy
```

*(only once selling is on)* add after GIFT CARDS AT THE DAY'S RATE:

```
SELL WHAT YOU DON'T USE
• Sell gift cards and see exactly what you'll be paid before you send the card
• Sell airtime you don't need, or buy unused airtime from the live pool
```

## Release notes (500 characters)

```
<en-GB>
First release of the BitoCard app.

• Buy airtime and data for any network
• Buy gift cards at the day's rate, with codes hidden until you reveal them
• Pay electricity bills and pay-TV
• Add funds, move money between wallets and get your own account number
• Follow every order and get notified when it arrives
</en-GB>
```

## Images

| Play field | File | Size |
|---|---|---|
| App icon | `out/icon-512.png` | 512 × 512 |
| Feature graphic (pick one) | `out/feature-graphic/feature-graphic-1.png` (navy, the app), `-2` (light, every product), `-3` (pink, gift cards) | 1024 × 500 |
| Phone screenshots (2 to 8) | `out/phone/01-home.png` to `08-orders.png`, in that order | 1080 × 1920 |
| 7-inch tablet screenshots | `out/tablet-7in/01-…08` | 1920 × 1080 |
| 10-inch tablet screenshots | `out/tablet-10in/01-…08` | 2560 × 1440 |
| Chromebook screenshots | `out/chromebook/01-…08` | 3840 × 2160 |
| Video | none: Play takes only a YouTube link | |

The screens are drawn from the app's real screens with made-up data (Ada, ₦128,450.00, example codes); no real
person, number, balance or code, and no other company's logo. Swap them for real captures from a sandbox account
whenever you like.

## Store settings

- **Category:** Finance. **Tags:** Mobile top up, Gift cards, Bill payments, Wallet.
- **Contact email:** support@bitocard.com · **Website:** https://bitocard.com
- **Privacy policy:** https://legals.bitocard.com/documents/privacy
- **Delete account:** https://bitocard.com/delete-account (some data only: `…/delete-account#some-data`, once deployed)
- **Countries:** only the markets BitoCard sells in (Nigeria, Ghana and Kenya first).
- **Content rating:** answer the questionnaire honestly; target audience 18 and over.
