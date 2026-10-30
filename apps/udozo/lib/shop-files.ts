import "server-only";
import { customerFetch } from "./customer";
import { uuidPattern } from "./shop";

/**
 * Files in the seller's account pass through this site's server, which adds the customer's session (browsers never hold it):
 * photos for a listing, a chat or a dispute go up to the API, which checks them from their bytes and strips their
 * metadata; private photos (chats, disputes) come back from it, never cached. Only this site's pages may send them.
 */

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

export const validIds = (...ids: string[]) => ids.every(value => uuidPattern.test(value));

/** Sends the request's `file` (and optional `body` caption) on to the API path; answers what the API answered. */
export async function forwardPhoto(request: Request, path: string, { caption = false }: { caption?: boolean } = {}) {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return json({ error: { message: "Send photos from your account on this site." } }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > 5 * 1024 * 1024) return json({ error: { message: "Photos can be at most 4 MB." } }, 413);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const text = form?.get("body");
  const forward = new FormData();
  if (caption && typeof text === "string" && text.trim()) forward.set(path.endsWith("/messages") ? "body" : "caption", text.trim().slice(0, 2000));
  if (file instanceof Blob && file.size) forward.set("file", file, file instanceof File && file.name ? file.name : "photo.jpg");
  else if (!caption || !forward.has("body")) return json({ error: { message: "Choose a photo." } }, 400);
  const res = await customerFetch("POST", path, forward);
  if (!res) return json({ error: { message: "We could not reach the store. Try again shortly." } }, 502);
  return json(await res.json().catch(() => ({ error: { message: "Something went wrong. Try again." } })), res.status);
}

/** A private photo read through the API with the customer's session: never cached, and it can never run anything. */
export async function servePhoto(path: string) {
  const res = await customerFetch("GET", path);
  // Not theirs, or signed out: the same not found; only an unreachable or failing API is a 502.
  if (!res?.ok) return new Response("This photo could not be opened.", { status: res && [401, 403, 404].includes(res.status) ? 404 : 502, headers: { "cache-control": "no-store" } });
  return new Response(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}
