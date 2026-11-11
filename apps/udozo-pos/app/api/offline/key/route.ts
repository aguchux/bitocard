import { deviceApi } from "@/lib/session";

const answer = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store, private" } });

/**
 * A linked till gives Udozo its own public signing key (ECDSA P-256), so a file of its unsent sales can be checked
 * when the owner brings it to another device. Only this site's own pages may send (`Sec-Fetch-Site`).
 */
export async function PUT(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return answer({ error: { message: "Not allowed." } }, 403);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return answer({ error: { message: "Send the key as JSON." } }, 400);
  }
  const key = (body as { public_key?: unknown })?.public_key;
  if (!key || typeof key !== "object") return answer({ error: { message: "Send the device's public key." } }, 400);
  const result = await deviceApi("PUT", "/v1/pos/device/key", { public_key: key });
  if (!result.ok) return answer({ error: { code: result.code, message: result.message } }, result.status === 0 ? 502 : result.status);
  return answer(result.data);
}
