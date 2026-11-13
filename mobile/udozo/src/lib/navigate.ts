import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import { appLink } from '@/lib/links';

/** Opens a udozo.com link: the app's screen when it has one, else udozo.com in an in-app browser. */
export function openLink(href: string) {
  const link = appLink(href);
  if ('route' in link) router.push(link.route as never);
  else WebBrowser.openBrowserAsync(link.web).catch(() => undefined);
}

/** Opens a person's seller page (their username once chosen, else their handle), where they have one: false otherwise. */
export function openSeller(seller: { handle?: string | null; username?: string | null } | null | undefined) {
  const key = seller?.username || seller?.handle;
  if (!key) return false;
  router.push({ pathname: '/seller/[key]', params: { key } });
  return true;
}

export { photoUrl } from '@/lib/photo';
