import { cookies } from "next/headers";
import { chatCookie } from "@/lib/chat-types";
import { visitorFile } from "@/lib/customer";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A file in a signed-out visitor's chat with Afrippa: read from the API with this browser's chat token and passed on,
 * never cached, sandboxed so a PDF or image cannot run anything on this site.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ chat: string; file: string }> }) {
  const { chat, file } = await params;
  const token = (await cookies()).get(chatCookie)?.value;
  if (!token || !uuid.test(chat) || !uuid.test(file)) return new Response("Not found", { status: 404 });
  const res = await visitorFile(`/v1/afrippa/account/support/visitor-chat/${chat}/files/${file}`, token);
  if (!res) return new Response("We could not reach Afrippa. Try again shortly.", { status: 503 });
  if (!res.ok) return new Response("Not found", { status: 404 });
  const type = res.headers.get("content-type") ?? "application/octet-stream";
  return new Response(res.body, {
    headers: {
      "content-type": ["image/jpeg", "image/png", "application/pdf"].includes(type.split(";")[0]) ? type : "application/octet-stream",
      ...(res.headers.get("content-disposition") ? { "content-disposition": res.headers.get("content-disposition")! } : {}),
      "cache-control": "no-store",
      "content-security-policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
