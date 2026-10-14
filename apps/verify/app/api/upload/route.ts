import type { KycCase } from "@bitocard/api-client/kyc";
import { kycApi } from "@/lib/api";
import { uploadProblem } from "@/lib/documents";
import { crossSite, errorReply, reply } from "@/lib/requests";

/**
 * One document or photo for the case: checked here (kind, type, 4 MB) and passed on to the API as multipart, which
 * checks it again, re-encodes images and stores it encrypted. Nothing is kept on this server.
 */
export async function POST(request: Request) {
  if (crossSite(request)) return errorReply(403, "cross_site", "Open the link you were sent.");
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 5 * 1024 * 1024) return errorReply(413, "file_too_large", "The file is bigger than 4 MB. Take a new photo or choose a smaller file.");
  const form = await request.formData().catch(() => null);
  const kind = form?.get("kind");
  const file = form?.get("file");
  if (typeof kind !== "string" || !(file instanceof Blob)) return errorReply(400, "parameter_missing", "Choose a file to upload.");
  const problem = uploadProblem(kind, file);
  if (problem) return errorReply(problem.code === "file_too_large" ? 413 : 400, problem.code, problem.message);
  const forward = new FormData();
  forward.set("kind", kind);
  forward.set("file", file, file instanceof File && file.name ? file.name : `${kind}.${file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg"}`);
  return reply(await kycApi<KycCase>("POST", "/v1/kyc/case/documents", forward));
}
