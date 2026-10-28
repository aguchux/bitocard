import type { KycCase } from "@bitocard/api-client/kyc";
import { uploadProblem } from "./documents";
import { brand } from "./brand";

/** Browser side of the wizard: calls this app's own route handlers, which add the applicant's session. */
export type CaseResult = { ok: true; case: KycCase } | { ok: false; code: string | null; message: string; param: string | null; status: number };

async function read(res: Response): Promise<CaseResult> {
  const json = (await res.json().catch(() => null)) as (KycCase & { error?: { code?: string | null; message?: string; param?: string | null } }) | null;
  if (res.ok && json && json.object === "kyc_case") return { ok: true, case: json };
  return { ok: false, status: res.status, code: json?.error?.code ?? null, message: json?.error?.message ?? "Something went wrong. Try again.", param: json?.error?.param ?? null };
}

const offline = (): CaseResult => ({ ok: false, status: 0, code: null, message: `We could not reach ${brand.name}. Check your connection and try again.`, param: null });

export type CaseStep = "consent" | "business" | "identity" | "liveness" | "submit";

export async function saveStep(step: CaseStep, body: Record<string, unknown> = {}): Promise<CaseResult> {
  try {
    return await read(await fetch(`/api/case/${step}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" }));
  } catch {
    return offline();
  }
}

export async function reloadCase(): Promise<CaseResult> {
  try {
    return await read(await fetch("/api/case", { cache: "no-store" }));
  } catch {
    return offline();
  }
}

export async function uploadDocument(kind: string, file: Blob, name?: string): Promise<CaseResult> {
  const problem = uploadProblem(kind, file);
  if (problem) return { ok: false, status: 400, code: problem.code, message: problem.message, param: "file" };
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", file, name ?? `${kind}.${file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg"}`);
  try {
    return await read(await fetch("/api/upload", { method: "POST", body: form, cache: "no-store" }));
  } catch {
    return offline();
  }
}
