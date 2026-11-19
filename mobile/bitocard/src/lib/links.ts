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

