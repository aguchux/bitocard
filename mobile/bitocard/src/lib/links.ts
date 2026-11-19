/**
 * bitocard.com paths (what the API's notices link to) as the app's own screens, and the app's routes for what a product
 * is. Free of React Native, so it runs under `node --test`. Anything the app has no screen for is null: the notice is
 * still shown, and opens nothing.
 */

type Route = { pathname: string; params?: Record<string, string> };

const routes: [RegExp, (match: RegExpExecArray) => Route | string][] = [
  [/^\/account\/orders\/([\w-]+)$/, m => ({ pathname: '/order/[id]', params: { id: m[1]! } })],
  [/^\/account\/orders$/, () => '/orders'],
  [/^\/account\/wallet\/deposits\/([\w-]+)$/, m => ({ pathname: '/bank-deposit/[id]', params: { id: m[1]! } })],
  [/^\/account\/wallet(\/.*)?$/, () => '/wallet'],
  [/^\/account\/sold\/([\w-]+)$/, m => ({ pathname: '/sale/[id]', params: { id: m[1]! } })],
  [/^\/account\/airtime\/sales\/([\w-]+)$/, m => ({ pathname: '/airtime/sale/[id]', params: { id: m[1]! } })],
  [/^\/account\/airtime\/purchases\/([\w-]+)$/, m => ({ pathname: '/airtime/purchase/[id]', params: { id: m[1]! } })],
  [/^\/account\/airtime\/sell$/, () => '/airtime/sell'],
  [/^\/account\/airtime(\/buy)?$/, m => (m[1] ? '/airtime/buy' : '/airtime')],
  [/^\/account\/support\/([\w-]+)$/, m => ({ pathname: '/help/ticket/[id]', params: { id: m[1]! } })],
  [/^\/account\/support$/, () => '/help'],
  [/^\/account\/verification$/, () => '/identity'],
  [/^\/account\/notifications$/, () => '/notifications'],
  [/^\/account\/profile(\/.*)?$/, () => '/account'],
  // A gift card's page on bitocard.com (its key as written or encoded, `gift_cards:US:amazon:usd`).
  [/^\/p\/(gift_cards(?::|%3A)[^/]+)$/i, m => ({ pathname: '/gift-card/[key]', params: { key: decodeURIComponent(m[1]!) } })],
];

/** The app screen for a bitocard.com path, or null. `?chat=1` anywhere opens the chat. */
export function appLink(link: string | null | undefined): Route | string | null {
  if (!link || !link.startsWith('/') || link.startsWith('//')) return null;
  const [path, query = ''] = link.split('?');
  if (new URLSearchParams(query).get('chat') === '1') return '/help/chat';
  const clean = path!.replace(/\/+$/, '') || '/';
  for (const [pattern, to] of routes) {
    const match = pattern.exec(clean);
    if (match) return to(match);
  }
  return null;
}

/** Where a product opens in the app: gift cards and top-ups have screens; anything else is bought on bitocard.com. */
export function productRoute(product: { key: string; category: string }): Route | string | null {
  if (product.category === 'gift_cards') return { pathname: '/gift-card/[key]', params: { key: product.key } };
  if (product.category === 'airtime' || product.category === 'data') return { pathname: '/mobile', params: { kind: product.category } };
  return null;
}

/**
 * A link the phone hands the app (a bitocard.com universal link or App Link, or a `bitocard://` link) as the app's
 * screen, else Home. Only pages the app has screens for are claimed (`apps/storefront/lib/app-links.ts`).
 */
export function incomingRoute(url: string): string {
  let path = url;
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      const parsed = new URL(url);
      // bitocard://account/orders/1 puts `account` in the host.
      path = parsed.protocol === 'bitocard:' ? `/${parsed.host}${parsed.pathname}${parsed.search}` : `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return '/';
  }
  const route = appLink(path);
  if (!route) return '/';
  if (typeof route === 'string') return route;
  return Object.entries(route.params ?? {}).reduce((to, [name, value]) => to.replace(`[${name}]`, encodeURIComponent(value)), route.pathname);
}
