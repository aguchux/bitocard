import { deviceApi } from "@/lib/session";

const answer = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store, private" } });

/**
 * A linked till's offline copy (milestone 9), read from Udozo with this browser's device token (its httpOnly cookie,
 * never seen by the page). Only this site's own pages may ask (`Sec-Fetch-Site`).
 */
export async function GET(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return answer({ error: { message: "Not allowed." } }, 403);
  const result = await deviceApi("GET", "/v1/pos/device/sync");
  if (!result.ok) return answer({ error: { code: result.code, message: result.message } }, result.status === 0 ? 502 : result.status);
  return answer(result.data);
}
