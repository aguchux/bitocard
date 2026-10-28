import { customerFile } from "@/lib/customer";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A file sent in the trader's chat with Afrippa: read from the API with this browser's session and passed on, never
 * cached, sandboxed so a PDF or image cannot run anything on this site.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ chat: string; file: string }> }) {
  const { chat, file } = await params;
  if (!uuid.test(chat) || !uuid.test(file)) return new Response("Not found", { status: 404 });
  const res = await customerFile(`/v1/afrippa/account/support/chat/${chat}/files/${file}`);
  if (!res) return new Response("We could not reach Afrippa. Try again shortly.", { status: 503 });
  if (!res.ok) return new Response("Not found", { status: res.status === 401 ? 401 : 404 });
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
