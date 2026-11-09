import { isPhotoKind, photoLimit, storePhoto } from "@/lib/photo-upload";
import { siteOrigin } from "@/lib/site";

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A photo of the office for the signed-in person's application: multipart `file` and `kind`. Stored through this
 * site's server with Udozo's signed link, then attached; answers the application. Only this site's own pages may send
 * one.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.test(id)) return json({ error: { message: "Not found." } }, 404);
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return json({ error: { message: "Send photos from your application on this site." } }, 403);
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== siteOrigin() && origin !== new URL(request.url).origin) return json({ error: { message: "Send photos from your application on this site." } }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > photoLimit + 64 * 1024) return json({ error: { message: "That photo is too large. Choose a smaller one." } }, 413);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const kind = form?.get("kind");
  if (!isPhotoKind(kind)) return json({ error: { message: "Say what the photo shows." } }, 400);
  if (!(file instanceof Blob) || !file.size) return json({ error: { message: "Choose a photo." } }, 400);
  const result = await storePhoto(id, kind, file, file instanceof File ? file.name : "");
  return result.ok ? json({ application: result.application }) : json({ error: { message: result.message } }, result.status);
}
