import { deviceApi } from "@/lib/session";

const answer = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store, private" } });

/**
 * A linked till uploads what it sold offline, in order (milestone 9): passed on to Udozo with the device token. Each
 * entry carries its own id, so an upload sent twice applies once. Only this site's own pages may send (`Sec-Fetch-Site`).
 */
export async function POST(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return answer({ error: { message: "Not allowed." } }, 403);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return answer({ error: { message: "Send the entries as JSON." } }, 400);
  }
  const entries = (body as { entries?: unknown })?.entries;
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 50) return answer({ error: { message: "Upload 1 to 50 entries at once." } }, 400);
  const result = await deviceApi("POST", "/v1/pos/device/upload", { entries });
  if (!result.ok) return answer({ error: { code: result.code, message: result.message } }, result.status === 0 ? 502 : result.status);
  return answer(result.data);
}
