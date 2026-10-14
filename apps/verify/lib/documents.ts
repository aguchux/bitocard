/** The API refuses anything bigger (and Vercel's request limit is 4.5 MB). */
export const maxUploadBytes = 4 * 1024 * 1024;

export const businessKinds = ["business_registration", "business_address", "business_directors"] as const;
const fixedKinds = ["id_front", "id_back", "selfie", ...businessKinds] as const;

/** Liveness frames: `liveness_<step>_<frame>`, frames 0 to 2. */
export const livenessKind = (step: number, frame: number) => `liveness_${step}_${frame}`;
const livenessPattern = /^liveness_\d{1,2}_[0-2]$/;

export function isDocumentKind(kind: string) {
  return (fixedKinds as readonly string[]).includes(kind) || livenessPattern.test(kind);
}

export const isBusinessKind = (kind: string) => (businessKinds as readonly string[]).includes(kind);

/** The file types each kind takes: PDFs only for business documents; liveness frames come from the camera as JPEG. */
export function acceptedTypes(kind: string): string[] {
  if (livenessPattern.test(kind)) return ["image/jpeg"];
  return isBusinessKind(kind) ? ["image/jpeg", "image/png", "application/pdf"] : ["image/jpeg", "image/png"];
}

export type UploadProblem = { code: "document_kind_invalid" | "file_empty" | "file_too_large" | "file_type_invalid"; message: string };

/** Why an upload cannot be sent, or null. Checked in the browser and again on this app's server. */
export function uploadProblem(kind: string, file: { type: string; size: number }): UploadProblem | null {
  if (!isDocumentKind(kind)) return { code: "document_kind_invalid", message: "This document is not part of your check." };
  if (!file.size) return { code: "file_empty", message: "The file is empty. Choose it again." };
  if (file.size > maxUploadBytes) return { code: "file_too_large", message: "The file is bigger than 4 MB. Take a new photo or choose a smaller file." };
  if (!acceptedTypes(kind).includes(file.type)) return { code: "file_type_invalid", message: isBusinessKind(kind) ? "Upload a PDF, JPEG or PNG file." : "Upload a JPEG or PNG photo." };
  return null;
}
