import { forwardPhoto, json, photoLimit, sameSite, uuid } from "@/lib/centre-files";

/**
 * A check-out photo of what the centre gives Udozo's collector, before the hand-over: multipart `file`, sent on to
 * Udozo with the person's session. Answers the pickup. Only this site's own pages may send one.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; pickup: string }> }) {
  const { id, pickup } = await params;
  if (!uuid.test(id) || !uuid.test(pickup)) return json({ error: { message: "Not found." } }, 404);
  if (!sameSite(request)) return json({ error: { message: "Send photos from your centre on this site." } }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > photoLimit + 64 * 1024) return json({ error: { message: "That photo is too large. Choose a smaller one." } }, 413);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || !file.size) return json({ error: { message: "Choose a photo." } }, 400);
  if (!["image/jpeg", "image/png"].includes(file.type)) return json({ error: { message: "Send a photo (JPEG or PNG)." } }, 400);
  if (file.size > photoLimit) return json({ error: { message: "That photo is too large. Choose a smaller one." } }, 413);
  const answer = await forwardPhoto(`/v1/connect/centres/${id}/pickups/${pickup}/photos`, file, file instanceof File ? file.name : "photo.jpg");
  const body = answer.body as { error?: { message?: string } };
  return answer.status < 300 ? json({ pickup: answer.body }) : json({ error: { message: body?.error?.message ?? "The photo could not be added. Try again." } }, answer.status);
}
