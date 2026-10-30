import { servePhoto, validIds } from "@/lib/shop-files";
import { currentStoreKey } from "@/lib/store";

/** A dispatch photo of the shopper's order on this store (what the supplier sent), read with their session. */
export async function GET(_request: Request, { params }: { params: Promise<{ store: string; order: string; photo: string }> }) {
  const { store, order, photo } = await params;
  if ((await currentStoreKey()) !== store || !validIds(order, photo)) return new Response("Not found", { status: 404 });
  return servePhoto(`/v1/store/resale/orders/${order}/dispatch-photos/${photo}`);
}
