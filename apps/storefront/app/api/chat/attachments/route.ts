import type { StoreChat } from "@bitocard/api-client/storefront";
import { chatApi, type ChatIdentity } from "@/lib/chat-server";

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

/**
 * A photo or PDF sent in the shopper's chat (multipart `file`, optional `body` caption, `as` customer or visitor),
 * passed on to the API, which checks it from its bytes, strips its metadata and stores it sealed. Only this site's own
 * pages may call it (`Sec-Fetch-Site`); nothing is kept on this server.
 */
export async function POST(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return json({ error: { message: "Send files from the chat on this store." } }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > 5 * 1024 * 1024) return json({ error: { message: "The file is larger than 4 MB." } }, 413);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const caption = form?.get("body");
  const as: ChatIdentity = form?.get("as") === "visitor" ? "visitor" : "customer";
  if (!(file instanceof Blob) || !file.size) return json({ error: { message: "Choose a file to send." } }, 400);
  const forward = new FormData();
  if (typeof caption === "string" && caption.trim()) forward.set("body", caption.trim().slice(0, 2000));
  forward.set("file", file, file instanceof File && file.name ? file.name : "file");
  const result = await chatApi<StoreChat>(as, "POST", "/attachments", forward);
  if (!result.ok) return json({ error: { message: result.message } }, result.status || 502);
  return json(result.data);
}
