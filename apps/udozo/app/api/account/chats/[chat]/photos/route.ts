import { forwardPhoto, validIds } from "@/lib/shop-files";

/** A photo in a chat about a listing (multipart `file`, optional `body` caption). */
export async function POST(request: Request, { params }: { params: Promise<{ chat: string }> }) {
  const { chat } = await params;
  if (!validIds(chat)) return Response.json({ error: { message: "No such chat." } }, { status: 404 });
  return forwardPhoto(request, `/v1/classifieds/conversations/${chat}/photos`, { caption: true });
}
