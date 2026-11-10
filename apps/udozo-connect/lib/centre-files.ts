import "server-only";
import { cookies } from "next/headers";
import { clientHeaders, sessionCookie } from "./session";
import { apiUrl, siteOrigin } from "./site";

/** The largest photo the API keeps (4 MB), and what a request may carry around it. */
export const photoLimit = 4 * 1024 * 1024;
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

/** Only this site's own pages may send a file: never another site's form. */
export function sameSite(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  return origin === null || origin === siteOrigin() || origin === new URL(request.url).origin;
}

/**
 * Sends a photo on to the API as multipart `file`, with the person's session (the browser never calls the API), and
 * passes its JSON answer back. Never throws.
 */
export async function forwardPhoto(path: string, file: Blob, filename: string): Promise<{ status: number; body: unknown }> {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token) return { status: 401, body: { error: { message: "Sign in again to carry on." } } };
  const form = new FormData();
  form.append("file", file, filename || "photo.jpg");
  try {
    const res = await fetch(apiUrl(path), {
      method: "POST",
      cache: "no-store",
      headers: { "bitocard-customer-session": token, "idempotency-key": crypto.randomUUID(), ...(await clientHeaders()) },
      body: form,
    });
    return { status: res.status, body: await res.json().catch(() => ({ error: { message: "Something went wrong. Try again." } })) };
  } catch {
    return { status: 502, body: { error: { message: "We could not reach Udozo. Try again shortly." } } };
  }
}

/** Reads a private photo from the API with the person's session and passes it on, never cached; images only. */
export async function readPhoto(path: string) {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token) return new Response("Sign in again", { status: 401 });
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { cache: "no-store", headers: { "bitocard-customer-session": token, ...(await clientHeaders()) } });
  } catch {
    return new Response("Udozo could not be reached", { status: 502 });
  }
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !/^image\/(jpeg|png)$/.test(type)) return new Response("Not found", { status: res.status === 401 ? 401 : 404 });
  return new Response(res.body, { headers: { "content-type": type, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
