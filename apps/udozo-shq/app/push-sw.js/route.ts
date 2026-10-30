import { pushServiceWorker } from "@bitocard/admin-ui/push-worker";
import { offlineWorker } from "@bitocard/ui/offline-worker";

export const dynamic = "force-static";

/**
 * Seller HQ's one service worker, served from this app's own origin: push notifications (shared with the other console
 * app), plus what makes Seller HQ installable as an app and its own page when there is no connection.
 */
export function GET() {
  return new Response(`${pushServiceWorker}\n${offlineWorker("Udozo Seller HQ")}`, {
    headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache", "service-worker-allowed": "/" },
  });
}
