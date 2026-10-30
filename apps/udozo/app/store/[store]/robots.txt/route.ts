import { siteOrigin } from "@/lib/customer";
import { indexable } from "@/lib/store-host";
import { currentStoreKey, storefront, storeOrigin } from "@/lib/store";

/** A store's robots.txt: a live store on its own domain is crawled (never its account pages); a test store not at all. */
export async function GET() {
  const [key, origin] = await Promise.all([currentStoreKey(), storeOrigin()]);
  const store = key ? await storefront(key) : null;
  const open = Boolean(store?.ok && origin && indexable(store.data, origin, siteOrigin()));
  const body = open ? "User-agent: *\nAllow: /\nDisallow: /account\nDisallow: /signin\nDisallow: /handoff\nDisallow: /preview\nDisallow: /api/\n" : "User-agent: *\nDisallow: /\n";
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
}
