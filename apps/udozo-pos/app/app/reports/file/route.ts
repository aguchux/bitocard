import { posFile } from "@/lib/pos-api";

const day = /^\d{4}-\d{2}-\d{2}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const files = {
  day_pdf: "/reports/day.pdf",
  sales_csv: "/reports/sales.csv",
  lines_csv: "/reports/sales.csv",
  summary_pdf: "/reports/summary.pdf",
} as const;

/**
 * A report's file from Udozo, read with the session of whoever is at the till (the API holds staff to their role):
 * end of day (`day_pdf`), the period's sales or lines as CSV, or its summary PDF. Never cached.
 */
export async function GET(request: Request) {
  const asked = new URL(request.url).searchParams;
  const kind = asked.get("kind") as keyof typeof files | null;
  if (!kind || !(kind in files)) return new Response("Not found", { status: 404 });
  const query = new URLSearchParams();
  for (const key of ["date", "from", "to"] as const) {
    const value = asked.get(key);
    if (value && day.test(value)) query.set(key, value);
  }
  const shop = asked.get("shop");
  if (shop && uuid.test(shop)) query.set("shop", shop);
  if (kind === "lines_csv") query.set("detail", "lines");
  const file = await posFile(`${files[kind]}${query.size ? `?${query}` : ""}`);
  if (!file.ok) return new Response(file.message, { status: file.status === 0 ? 502 : file.status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  const name = /filename="([^"]+)"/.exec(file.disposition ?? "")?.[1] ?? "report";
  return new Response(file.bytes, {
    headers: {
      "content-type": file.contentType,
      "cache-control": "no-store, private",
      "content-disposition": `${kind.endsWith("_csv") ? "attachment" : "inline"}; filename="${name.replace(/[^\w.\- ]/g, "_")}"`,
      "x-content-type-options": "nosniff",
    },
  });
}
