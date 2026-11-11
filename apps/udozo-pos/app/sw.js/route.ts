import { offlineWorker } from "@/lib/offline-worker";

export const dynamic = "force-static";

/** The POS's service worker, at the root so it serves every page. A new build is a new version. */
export function GET() {
  return new Response(offlineWorker(process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "dev"), {
    headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache", "service-worker-allowed": "/" },
  });
}
