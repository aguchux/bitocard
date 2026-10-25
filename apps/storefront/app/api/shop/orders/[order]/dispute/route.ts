import { forwardPhoto, validIds } from "@/lib/shop-files";

/** A message on a Safe pay dispute with a photo (multipart `file` and an optional `body`). */
export async function POST(request: Request, { params }: { params: Promise<{ order: string }> }) {
  const { order } = await params;
  if (!validIds(order)) return Response.json({ error: { message: "No such order." } }, { status: 404 });
  return forwardPhoto(request, `/v1/classifieds/orders/${order}/dispute/messages`, { caption: true });
}
