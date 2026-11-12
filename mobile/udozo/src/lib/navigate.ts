import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import { appLink } from '@/lib/links';

/** Opens a udozo.com link: the app's screen when it has one, else udozo.com in an in-app browser. */
export function openLink(href: string) {
  const link = appLink(href);
  if ('route' in link) router.push(link.route as never);
  else WebBrowser.openBrowserAsync(link.web).catch(() => undefined);
}

export { photoUrl } from '@/lib/photo';
