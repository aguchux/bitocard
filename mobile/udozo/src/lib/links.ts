/**
 * Where a udozo.com address opens in the app: the links the API gives (home blocks, notices, chats), udozo.com links
 * the phone hands the app (universal links and App Links), and pushes. Pages the app has go to its screen; anything
 * else opens on udozo.com in the browser. Kept free of React Native so it runs under `node --test`.
 */

export type AppLink = { route: string } | { web: string };

const site = 'https://udozo.com';
const ownHosts = new Set(['udozo.com', 'www.udozo.com']);
/** The app's own screens, reachable by `udozo://<route>` links. */
const appRoutes = new Set(['listing', 'chat', 'chats', 'seller', 'brand', 'category', 'search', 'notifications', 'saved', 'me', 'post', 'my-listings', 'requests', 'dashboard', 'username', 'settings']);

/** A link the phone hands the app that is not Udozo's (another app's sign-in return, such as Facebook's `fb<id>://`). */
export function foreignScheme(href: string) {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
  return Boolean(scheme) && !['http', 'https', 'udozo'].includes(scheme!);
}

const query = (values: Record<string, string | null | undefined>) => {
  const pairs = Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1]));
  return pairs.length ? `?${pairs.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}` : '';
};

/** A udozo.com path or address as the app's route, or udozo.com in the browser. */
export function appLink(href: string): AppLink {
  let url: URL;
  try {
    url = new URL(href, site);
  } catch {
    return { route: '/' };
  }
  if (url.protocol === 'udozo:') url = new URL(`${site}/${url.host}${url.pathname}${url.search}`);
  if (!ownHosts.has(url.hostname) || (url.protocol !== 'https:' && url.protocol !== 'http:')) return { web: url.toString() };
  const parts = url.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
  const web = { web: `${site}${url.pathname}${url.search}` };
  const [first, second, third, fourth] = parts;

  if (!first) return { route: '/' };
  // The app's own routes (`udozo://listing/77`): udozo.com has no pages by these names, so they are only ever the app's.
  if (appRoutes.has(first)) return { route: `${url.pathname}${url.search}` };
  if (first === 'sell') return { route: '/post/new' };
  if (first === 'account') {
    if (second === 'listings') return { route: third && /^[0-9a-f-]{36}$/i.test(third) ? `/post/${third}` : `/my-listings${query({ status: url.searchParams.get('status') })}` };
    if (second === 'requests') return { route: '/requests' };
    if (second === 'profile' && third === 'username') return { route: '/username' };
    if (second === 'messages') return { route: third ? `/chat/${third}` : '/chats' };
    if (second === 'notifications') return { route: '/notifications' };
    if (second === 'favourites') return { route: '/saved' };
    if (!second || second === 'profile') return { route: '/me' };
    return web;
  }
  if (first === 'i' && second) return { route: `/signup${query({ ref: second })}` };
  if (first === 'signin' || first === 'signup') return { route: `/${first}${query({ ref: url.searchParams.get('ref') })}` };
  if (/^[a-z]{2}$/.test(first)) {
    const country = first.toUpperCase();
    if (!second) return { route: `/${query({ country })}` };
    if (second === 'l' && third) {
      const ref = /^(\d{1,15})/.exec(third)?.[1];
      return ref ? { route: `/listing/${ref}${query({ country })}` } : web;
    }
    if (second === 'seller' && third) return { route: `/seller/${third}` };
    if (second === 'brand' && third) return { route: `/brand/${third}${query({ country })}` };
    if (second === 'c' && third) return { route: `/category/${third}${query({ country })}` };
    if (second === 'search') {
      return { route: `/search${query({ country, q: url.searchParams.get('q'), category: url.searchParams.get('category') })}` };
    }
    // A seller's review page, wanted requests, auctions, places: udozo.com for now.
    void fourth;
    return web;
  }
  return web;
}

/** A listing's udozo.com address, for sharing. */
export const listingUrl = (country: string, ref: number, slug: string) => `${site}/${country.toLowerCase()}/l/${ref}-${slug}`;
