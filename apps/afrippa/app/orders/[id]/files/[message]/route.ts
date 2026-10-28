import { customerFile } from "@/lib/customer";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A file sent in an order room, for one of its two parties: read from the API with this browser's session and passed
 * on, never cached, sandboxed so a PDF or image cannot run anything on this site.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; message: string }> }) {
  const { id, message } = await params;
  if (!uuid.test(id) || !uuid.test(message)) return new Response("Not found", { status: 404 });
  const res = await customerFile(`/v1/afrippa/p2p/orders/${id}/files/${message}`);
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
