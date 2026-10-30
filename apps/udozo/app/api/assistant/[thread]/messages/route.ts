import { apiUrl } from "@/lib/api";
import { assistantHeaders } from "@/lib/assistant";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const json = (data: unknown, status: number) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

/**
 * A question to the shop assistant, streamed back as it is answered (server-sent events: each tool as it runs, its cards,
 * then the answer). The browser asks this site; this site asks the API with the shopper's session or visitor token and
 * passes the stream through. Only from this site's own pages.
 */
export async function POST(request: Request, { params }: { params: Promise<{ thread: string }> }) {
  const { thread } = await params;
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return json({ error: { message: "Ask from Udozo." } }, 403);
  if (!uuid.test(thread)) return json({ error: { message: "No such conversation." } }, 404);
  const input = (await request.json().catch(() => null)) as { body?: unknown } | null;
  const body = typeof input?.body === "string" ? input.body.trim().slice(0, 1000) : "";
  if (!body) return json({ error: { message: "Write a question." } }, 400);
  let res: Response;
  try {
    res = await fetch(apiUrl(`/v1/classifieds/assistant/threads/${thread}/messages`), {
      method: "POST",
      cache: "no-store",
      headers: { accept: "text/event-stream", "content-type": "application/json", "idempotency-key": crypto.randomUUID(), ...(await assistantHeaders()) },
      body: JSON.stringify({ body }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return json({ error: { code: "assistant_unavailable", message: "The assistant can’t answer right now. Search still works." } }, 503);
  }
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream") || !res.body) {
    const error = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    return json({ error: { code: error?.error?.code ?? null, message: error?.error?.message ?? "The assistant can’t answer right now. Search still works." } }, res.ok ? 502 : res.status);
  }
  return new Response(res.body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
