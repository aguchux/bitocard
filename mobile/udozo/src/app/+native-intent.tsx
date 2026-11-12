import { appLink, foreignScheme } from '@/lib/links';

/**
 * udozo.com links the phone hands the app (universal links and App Links, `apps/udozo/lib/app-links.ts`) and `udozo://`
 * links: each becomes the app's own screen (`appLink`); a page the app does not have opens on udozo.com.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  // Another app's return (Facebook's sign-in, a payment app) is left for that SDK to read.
  if (foreignScheme(path)) return path;
  try {
    const link = appLink(path);
    return 'route' in link ? link.route : `/web?url=${encodeURIComponent(link.web)}`;
  } catch {
    return '/';
  }
}
