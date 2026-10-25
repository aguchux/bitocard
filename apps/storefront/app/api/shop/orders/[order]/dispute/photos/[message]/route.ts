import { servePhoto, validIds } from "@/lib/shop-files";

/** A photo from a dispute on one of the customer's own Safe pay orders. */
export async function GET(_request: Request, { params }: { params: Promise<{ order: string; message: string }> }) {
  const { order, message } = await params;
  if (!validIds(order, message)) return new Response("Not found", { status: 404 });
  return servePhoto(`/v1/classifieds/orders/${order}/dispute/photos/${message}`);
}
