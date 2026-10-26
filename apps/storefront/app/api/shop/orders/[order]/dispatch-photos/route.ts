import { forwardPhoto, validIds } from "@/lib/shop-files";

/** The seller adds a dispatch photo (the item, the sealed parcel) to a paid delivery before shipping it. */
export async function POST(request: Request, { params }: { params: Promise<{ order: string }> }) {
  const { order } = await params;
  if (!validIds(order)) return Response.json({ error: { message: "No such order." } }, { status: 404 });
  return forwardPhoto(request, `/v1/classifieds/orders/${order}/dispatch-photos`);
}
