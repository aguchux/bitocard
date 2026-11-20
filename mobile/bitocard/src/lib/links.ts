/**
 * bitocard.com paths (what the API's notices link to) as the app's own screens, and the app's routes for what a product
 * is. Free of React Native, so it runs under `node --test`. Anything the app has no screen for is null: the notice is
 * still shown, and opens nothing.
 */

type Route = { pathname: string; params?: Record<string, string> };

const routes: [RegExp, (match: RegExpExecArray) => Route | string][] = [
  [/^\/account\/orders\/([\w-]+)$/, m => ({ pathname: '/order/[id]', params: { id: m[1]! } })],
  [/^\/account\/orders$/, () => '/orders'],
  [/^\/account\/wallet\/deposits$/, () => '/bank-deposit/all'],
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
  [/^\/account\/profile\/details$/, () => '/profile'],
  [/^\/account\/profile\/security$/, () => '/security'],
  [/^\/account\/profile(\/.*)?$/, () => '/account'],
  [/^\/account\/disputes\/([\w-]+)$/, m => (m[1] === 'new' ? '/disputes' : { pathname: '/disputes/[id]', params: { id: m[1]! } })],
  [/^\/account\/disputes$/, () => '/disputes'],
  [/^\/account\/sold$/, () => '/sold'],
  // A gift card's page on bitocard.com (its key as written or encoded, `gift_cards:US:amazon:usd`).
  [/^\/p\/(gift_cards(?::|%3A)[^/]+)$/i, m => ({ pathname: '/gift-card/[key]', params: { key: decodeURIComponent(m[1]!) } })],
  // Any other product's page: bills, pay-TV, software, VPN (airtime and data open the Mobile tab).
  [/^\/p\/((?:airtime|data)(?::|%3A)[^/]+)$/i, m => ({ pathname: '/mobile', params: { kind: decodeURIComponent(m[1]!).split(':')[0]! } })],
  [/^\/p\/((?:bills|pay_tv|software|vpn|rdp|mobile_money)(?::|%3A)[^/]+)$/i, m => ({ pathname: '/product/[key]', params: { key: decodeURIComponent(m[1]!) } })],
  [/^\/catalogs\/([\w-]+)$/, m => ({ pathname: '/browse', params: { category: m[1]!.replace(/-/g, '_') } })],
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

/** Where a product opens in the app: gift cards and top-ups their own screens, anything else the product screen. */
export function productRoute(product: { key: string; category: string }): Route {
  if (product.category === 'gift_cards') return { pathname: '/gift-card/[key]', params: { key: product.key } };
  if (product.category === 'airtime' || product.category === 'data') return { pathname: '/mobile', params: { kind: product.category } };
  return { pathname: '/product/[key]', params: { key: product.key } };
}

/** Where a category opens: gift cards and top-ups their tabs, anything else its list. */
export function categoryRoute(category: string): Route {
  if (category === 'gift_cards') return { pathname: '/gift-cards', params: { mode: 'buy' } };
  // `mobile` is bitocard.com's Mobile menu group: airtime first.
  if (category === 'airtime' || category === 'data' || category === 'mobile') return { pathname: '/mobile', params: { kind: category === 'data' ? 'data' : 'airtime' } };
  return { pathname: '/browse', params: { category } };
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
