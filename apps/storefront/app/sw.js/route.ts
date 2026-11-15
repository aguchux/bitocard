import { offlineWorker, workerHeaders } from "@bitocard/ui/offline-worker";
import { storePushWorker } from "@/lib/push-worker";

export const dynamic = "force-static";

/**
 * The service worker (installable, its own page when there is no connection, and push notifications for signed-in
 * customers who turned them on), served from this site's own origin.
 */
export function GET() {
  return new Response(offlineWorker("BitoCard") + storePushWorker, { headers: workerHeaders });
}
