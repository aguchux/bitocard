import { pushServiceWorker } from "@bitocard/admin-ui/push-worker";

export const dynamic = "force-static";

/** The push service worker (shared with the other console app), served from this app's own origin. */
export function GET() {
  return new Response(pushServiceWorker, {
    headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache", "service-worker-allowed": "/" },
  });
}
