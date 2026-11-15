import type { GiftCardSale } from "@bitocard/api-client/storefront";
import { customerFetch } from "@/lib/customer";

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

/**
 * A gift card the customer sells (multipart: `offer_id`, `amount`, `expected_payout`, then `code` or up to 20
 * `photos`), passed on to the API with their session, which checks every photo from its bytes. Only this site's own
 * pages may call it (`Sec-Fetch-Site`); nothing is kept on this server.
 */
export async function POST(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return json({ error: { message: "Sell your card from its page on this store." } }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > 60 * 1024 * 1024) return json({ error: { message: "The photos are too large together: send fewer or smaller ones." } }, 413);
  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: { message: "Something went wrong. Try again." } }, 400);
  const forward = new FormData();
  for (const name of ["offer_id", "amount", "expected_payout", "code"]) {
    const value = form.get(name);
    if (typeof value === "string" && value.trim()) forward.set(name, value.trim());
  }
  let photos = 0;
  for (const photo of form.getAll("photos")) {
    if (!(photo instanceof Blob) || !photo.size) continue;
    if ((photos += 1) > 20) return json({ error: { message: "Send at most 20 photos." } }, 400);
    forward.append("photos", photo, photo instanceof File && photo.name ? photo.name : `card-${photos}.jpg`);
  }
  const key = form.get("key");
  const res = await customerFetch("POST", "/v1/store/gift-card-sales", forward, { idempotencyKey: typeof key === "string" ? key : undefined });
  if (!res) return json({ error: { message: "We could not reach the store. Try again shortly." } }, 502);
  const body = (await res.json().catch(() => null)) as (GiftCardSale & { error?: { code?: string; message?: string } }) | null;
  if (!res.ok) return json({ error: { code: body?.error?.code ?? null, message: body?.error?.message ?? "Something went wrong. Try again." } }, res.status);
  return json(body);
}
