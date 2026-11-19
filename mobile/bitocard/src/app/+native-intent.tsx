import { incomingRoute } from '@/lib/links';

/**
 * bitocard.com links the phone hands the app (universal links and App Links, `apps/storefront/lib/app-links.ts`) and
 * `bitocard://` links: each becomes the app's own screen (`incomingRoute`); anything else opens Home.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return incomingRoute(path);
}
