import { pictureKinds, pictureLimits, type PictureKind, storePicture } from "@/lib/picture-upload";

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

/**
 * The signed-in customer's profile photo (`avatar`) or seller page cover (`banner`): multipart `file`, already prepared
 * in the browser. Stored through this site's server with Udozo's signed link and set; answers `{ url }`, the new address.
 * Only this site's own pages may send one.
 */
export async function POST(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!pictureKinds.includes(kind as PictureKind)) return json({ error: { message: "Not found." } }, 404);
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return json({ error: { message: "Send pictures from your account on this site." } }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > pictureLimits[kind as PictureKind] + 64 * 1024) return json({ error: { message: "That picture is too large. Choose a smaller one." } }, 413);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || !file.size) return json({ error: { message: "Choose a picture." } }, 400);
  const result = await storePicture(kind as PictureKind, file, file instanceof File ? file.name : "");
  return result.ok ? json({ url: result.url }) : json({ error: { message: result.message } }, result.status);
}
