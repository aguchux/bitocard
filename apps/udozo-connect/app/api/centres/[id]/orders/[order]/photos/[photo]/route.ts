import { cookies } from "next/headers";
import { clientHeaders, sessionCookie } from "@/lib/session";
import { apiUrl } from "@/lib/site";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One of the seller's dispatch photos of an order coming to the centre, read through this site's own server with the
 * person's session (the browser never calls the API): staff check the item against it at check-in. Never cached.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; order: string; photo: string }> }) {
  const { id, order, photo } = await params;
  if (![id, order, photo].every(value => uuid.test(value))) return new Response("Not found", { status: 404 });
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token) return new Response("Sign in again", { status: 401 });
  let res: Response;
  try {
    res = await fetch(apiUrl(`/v1/connect/centres/${id}/orders/${order}/dispatch-photos/${photo}`), {
      cache: "no-store",
      headers: { "bitocard-customer-session": token, ...(await clientHeaders()) },
    });
  } catch {
    return new Response("Udozo could not be reached", { status: 502 });
  }
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !/^image\/(jpeg|png)$/.test(type)) return new Response("Not found", { status: res.status === 401 ? 401 : 404 });
  return new Response(res.body, { headers: { "content-type": type, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
