/**
 * The files that let BitoCard's mobile app open bitocard.com links itself (docs/BITOCARD_MOBILE_APP_PLAN.md, phase 5):
 * Apple's apple-app-site-association (universal links, and shared passwords) and Android's assetlinks.json (App Links).
 * Only pages the app has its own screen for open there; everything else stays in the browser. Keep `appLinkPaths` in
 * step with `mobile/bitocard/src/lib/links.ts` and the app's intent filters in `mobile/bitocard/app.json`.
 *
 * Set in the environment once the store accounts exist: `BITOCARD_IOS_APP_IDS` (TEAMID.com.bitocard.app, separated by
 * commas), `BITOCARD_ANDROID_PACKAGE` (com.bitocard.app) and `BITOCARD_ANDROID_CERT_SHA256` (the signing certificates'
 * SHA-256 fingerprints, separated by commas). Until set, both answer 404.
 */
export const appLinkPaths = [
  "/account/orders",
  "/account/orders/*",
  "/account/wallet",
  "/account/wallet/*",
  "/account/sold/*",
  "/account/airtime",
  "/account/airtime/*",
  "/account/support",
  "/account/support/*",
  "/account/verification",
  "/account/notifications",
  "/p/gift_cards*", // a gift card's page (its key, `gift_cards:US:amazon:usd`, as written or encoded)
  "/account/sold",
  "/account/disputes",
  "/account/disputes/*",
  "/account/profile",
  "/account/profile/*",
  "/p/bills*", // electricity and other bills, pay-TV, software and VPN open the app's product screen
  "/p/pay_tv*",
  "/p/software*",
  "/p/vpn*",
] as const;

const list = (value: string | undefined) => (value ?? "").split(",").map(item => item.trim()).filter(Boolean);

/** Team ID, a dot, then a bundle ID: what Apple's file names. */
const appleAppId = /^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/;
/** A certificate fingerprint, 32 bytes as colon-separated hex. */
const fingerprint = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const androidPackage = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

/** Apple's file, or null while no app ID is set. */
export function appleAssociation(env: Record<string, string | undefined> = process.env) {
  const apps = list(env.BITOCARD_IOS_APP_IDS).filter(id => appleAppId.test(id));
  if (!apps.length) return null;
  return {
    applinks: { details: [{ appIDs: apps, components: appLinkPaths.map(path => ({ "/": path })) }] },
    webcredentials: { apps },
  };
}

/** Android's file, or null while the package or its certificate is not set. */
export function androidAssetLinks(env: Record<string, string | undefined> = process.env) {
  const pkg = env.BITOCARD_ANDROID_PACKAGE?.trim();
  const certs = list(env.BITOCARD_ANDROID_CERT_SHA256).map(item => item.toUpperCase()).filter(item => fingerprint.test(item));
  if (!pkg || !androidPackage.test(pkg) || !certs.length) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
      target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: certs },
    },
  ];
}

/**
 * Only bitocard.com itself (and local development) claims its links: never a reseller's store, on its bitocard.com
 * subdomain or its own domain, whose customers have no app of ours.
 */
export function servesAppLinks(host: string | null) {
  if (!host) return false;
  const name = host.toLowerCase().split(":")[0];
  return name === "bitocard.com" || name === "www.bitocard.com" || name === "localhost";
}

/** The JSON answer both routes give: cached an hour, or 404 while not set up or on another host. */
export function appLinksResponse(body: unknown, host: string | null) {
  if (!body || !servesAppLinks(host)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
  });
}
