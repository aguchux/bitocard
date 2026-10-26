import { servePhoto, validIds } from "@/lib/shop-files";

/** A dispatch photo of the customer's order on this Resale shop (what the supplier sent). */
export async function GET(_request: Request, { params }: { params: Promise<{ order: string; photo: string }> }) {
  const { order, photo } = await params;
  if (!validIds(order, photo)) return new Response("Not found", { status: 404 });
  return servePhoto(`/v1/store/resale/orders/${order}/dispatch-photos/${photo}`);
}
