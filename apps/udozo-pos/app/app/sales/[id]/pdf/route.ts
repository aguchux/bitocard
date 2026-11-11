import { posFile } from "@/lib/pos-api";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A sale's receipt or invoice as a PDF, read from Udozo with the session of whoever is at the till (the owner, or a
 * member of staff for the sales they may see) and shown in the browser, or downloaded with `download=1`. Never cached.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.test(id)) return new Response("Not found", { status: 404 });
  const asked = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  if (asked.get("kind") === "invoice") query.set("kind", "invoice");
  if (asked.get("width") === "58" || asked.get("width") === "80") query.set("width", asked.get("width")!);
  if (asked.get("gift") === "1") query.set("gift", "true");
  const file = await posFile(`/sales/${id}/receipt.pdf${query.size ? `?${query}` : ""}`);
  if (!file.ok) return new Response(file.message, { status: file.status === 0 ? 502 : file.status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  const name = /filename="([^"]+)"/.exec(file.disposition ?? "")?.[1] ?? "Receipt.pdf";
  return new Response(file.bytes, {
    headers: {
      "content-type": "application/pdf",
      "cache-control": "no-store, private",
      "content-disposition": `${asked.get("download") === "1" ? "attachment" : "inline"}; filename="${name.replace(/[^\w.\- ]/g, "_")}"`,
      "x-content-type-options": "nosniff",
    },
  });
}
