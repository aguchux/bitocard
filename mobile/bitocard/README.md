# BitoCard mobile app

The app for bitocard.com's customers: buy and sell airtime, buy data, buy and sell gift cards. The plan and its phases
are in `docs/BITOCARD_MOBILE_APP_PLAN.md`; the approved screens are the "BitoCard mobile app" design canvas.

Expo (React Native), outside the repository's npm workspaces:

```bash
npm install
npx expo start          # the dev server
npm test                # node --test (lib), then Jest (screens)
npm run typecheck
npx expo lint
npx expo install <pkg>  # always, for SDK-compatible versions
```

- `com.golojan.bitocard.android` on Android, `com.golojan.bitocard.ios` on iOS, scheme `bitocard`.
- It talks to `https://api.bitocard.com` (app.json's `extra.apiUrl`) as bitocard.com's own store: the same account,
  wallet and orders as the website. The session is kept in the phone's secure store.
- No EAS build until the owner says go.
