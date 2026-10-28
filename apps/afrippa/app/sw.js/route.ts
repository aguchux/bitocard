import { offlineWorker, workerHeaders } from "@bitocard/ui/offline-worker";

export const dynamic = "force-static";

/** The service worker (installable, its own page when there is no connection), served from this site's own origin. */
export function GET() {
  return new Response(offlineWorker("Afrippa"), { headers: workerHeaders });
}
