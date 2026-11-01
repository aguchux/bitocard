import { uuidPattern } from "./shop";

type Route = { method: "GET" | "POST"; path: string; body?: unknown };

/**
 * The API call each of this site's call routes stands for, or null: `POST presence`, `POST start { listing_id }`,
 * `GET <call>?after=`, `POST <call>/answer|end`, `POST <call>/signals { kind, payload }`. Nothing else passes.
 */
export function callRoute(method: string, path: string[], body: Record<string, unknown>, query: URLSearchParams): Route | null {
  const [first, action, ...rest] = path;
  if (rest.length) return null;
  if (method === "POST" && first === "presence" && !action) return { method: "POST", path: "/v1/classifieds/presence" };
  if (method === "POST" && first === "start" && !action) {
    const listing = body.listing_id;
    return typeof listing === "string" && uuidPattern.test(listing) ? { method: "POST", path: `/v1/classifieds/listings/${listing}/calls`, body: {} } : null;
  }
  if (!first || !uuidPattern.test(first)) return null;
  if (method === "GET" && !action) {
    const after = query.get("after");
    if (after && !/^\d{1,18}$/.test(after)) return null;
    return { method: "GET", path: `/v1/classifieds/calls/${first}${after ? `?after=${after}` : ""}` };
  }
  if (method !== "POST") return null;
  if (action === "answer" || action === "end") return { method: "POST", path: `/v1/classifieds/calls/${first}/${action}` };
  if (action === "signals" && ["offer", "answer", "candidate"].includes(String(body.kind))) {
    return { method: "POST", path: `/v1/classifieds/calls/${first}/signals`, body: { kind: body.kind, payload: body.payload } };
  }
  return null;
}
