import { chatFetch, type ChatIdentity } from "@/lib/chat-server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A photo or PDF from the shopper's own chat (`?as=customer|visitor`), read through the API with their session or
 * visitor token: never cached, and a PDF opened from here can never run anything.
 */
export async function GET(request: Request, { params }: { params: Promise<{ chat: string; file: string }> }) {
  const { chat, file } = await params;
  const as: ChatIdentity = new URL(request.url).searchParams.get("as") === "visitor" ? "visitor" : "customer";
  if (!uuid.test(chat) || !uuid.test(file)) return new Response("Not found", { status: 404 });
  const res = await chatFetch(as, "GET", `/${chat}/files/${file}`);
  if (!res?.ok) return new Response("This file could not be opened.", { status: res?.status === 404 ? 404 : 502, headers: { "cache-control": "no-store" } });
  return new Response(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": res.headers.get("content-disposition") ?? "inline",
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}
