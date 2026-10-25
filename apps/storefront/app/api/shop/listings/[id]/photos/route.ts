import { forwardPhoto, validIds } from "@/lib/shop-files";

/** A photo for the seller's listing (multipart `file`, JPEG or PNG up to 4 MB, already scaled in the browser). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validIds(id)) return Response.json({ error: { message: "No such listing." } }, { status: 404 });
  return forwardPhoto(request, `/v1/classifieds/listings/${id}/photos`);
}
