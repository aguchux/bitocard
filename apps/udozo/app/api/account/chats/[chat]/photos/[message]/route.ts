import { servePhoto, validIds } from "@/lib/shop-files";

/** A photo from one of the customer's own chats (only its two sides can read it). */
export async function GET(_request: Request, { params }: { params: Promise<{ chat: string; message: string }> }) {
  const { chat, message } = await params;
  if (!validIds(chat, message)) return new Response("Not found", { status: 404 });
  return servePhoto(`/v1/classifieds/conversations/${chat}/photos/${message}`);
}
