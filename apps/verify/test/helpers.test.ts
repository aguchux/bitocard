import { afterEach, describe, expect, test, vi } from "vitest";
import { cameraConstraints, cameraProblem, mirrored } from "@/lib/camera";
import { acceptedTypes, isDocumentKind, livenessKind, maxUploadBytes, uploadProblem } from "@/lib/documents";
import { tokenFromHash } from "@/lib/handoff";
import { fitWithin, isPhoto } from "@/lib/image";
import { fetchReviewDocument, ineligible, pickAccount, queueStatus, reviewApiBase, reviewListPath, reviewRequest, shqBase, signInUrl } from "@/lib/review";
import { returnHint } from "@/lib/return-hint";

afterEach(() => vi.unstubAllGlobals());

describe("photos", () => {
  test("are scaled to fit 1600 px on the longest side, never enlarged", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 1600)).toEqual({ width: 1600, height: 1600 });
    expect(fitWithin(0, 600)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(5000, 2, 1600)).toEqual({ width: 1600, height: 1 });
  });

  test("only JPEG and PNG are redrawn; PDFs go as they are", () => {
    expect(isPhoto("image/jpeg")).toBe(true);
    expect(isPhoto("image/png")).toBe(true);
    expect(isPhoto("application/pdf")).toBe(false);
    expect(isPhoto("image/heic")).toBe(false);
  });
});

describe("documents", () => {
  test("kinds, types and the 4 MB limit", () => {
    expect(livenessKind(1, 2)).toBe("liveness_1_2");
    for (const kind of ["id_front", "id_back", "selfie", "business_registration", "liveness_0_0", "liveness_1_2"]) expect(isDocumentKind(kind)).toBe(true);
    for (const kind of ["liveness_0_3", "liveness__0", "id_front ", "../selfie", "passport"]) expect(isDocumentKind(kind)).toBe(false);
    expect(acceptedTypes("business_address")).toContain("application/pdf");
    expect(acceptedTypes("id_front")).not.toContain("application/pdf");
    expect(acceptedTypes("liveness_0_0")).toEqual(["image/jpeg"]);
    expect(uploadProblem("selfie", { type: "image/jpeg", size: maxUploadBytes })).toBeNull();
    expect(uploadProblem("selfie", { type: "image/jpeg", size: maxUploadBytes + 1 })?.code).toBe("file_too_large");
    expect(uploadProblem("selfie", { type: "image/jpeg", size: 0 })?.code).toBe("file_empty");
    expect(uploadProblem("id_back", { type: "application/pdf", size: 10 })?.code).toBe("file_type_invalid");
  });
});

describe("the camera", () => {
  test("documents use the back camera; the selfie's preview is mirrored, never the photo", () => {
    expect(cameraConstraints("environment")).toMatchObject({ audio: false, video: { facingMode: { ideal: "environment" } } });
    expect(mirrored("user")).toBe(true);
    expect(mirrored("environment")).toBe(false);
  });

  test("every way it can fail has plain help", () => {
    expect(cameraProblem({ name: "NotAllowedError" }).title).toBe("Camera access is blocked");
    expect(cameraProblem({ name: "NotAllowedError" }).help).toMatch(/iPhone/);
    expect(cameraProblem({ name: "NotFoundError" }).title).toBe("No camera found");
    expect(cameraProblem({ name: "NotReadableError" }).title).toBe("The camera is busy");
    expect(cameraProblem(new Error("x")).canRetry).toBe(true);
    expect(cameraProblem(null, false).canRetry).toBe(false);
  });
});

describe("the link", () => {
  test("the token comes only from the fragment's t", () => {
    expect(tokenFromHash("#t=abcdefghijklmnopqrstuvwxyz012345")).toBe("abcdefghijklmnopqrstuvwxyz012345");
    expect(tokenFromHash("#x=1&t=abcdefghijklmnop_-.~")).toBe("abcdefghijklmnop_-.~");
    for (const hash of ["", "#", "#t=", "#t=short", "#t=<script>alert(1)</script>aaaaaaaa"]) expect(tokenFromHash(hash)).toBeNull();
  });

  test("a lost applicant is sent back only to BitoCard's own sites", () => {
    expect(returnHint("https://ada.bitocard.com/account/verification")).toEqual({ name: "ada.bitocard.com", url: "https://ada.bitocard.com/" });
    expect(returnHint("https://bitocard.com/account")).toEqual({ name: "BitoCard", url: "https://bitocard.com/" });
    expect(returnHint("https://shq.bitocard.com/settings/verification")?.name).toBe("BitoCard SHQ");
    for (const bad of ["", "https://evil.com/", "http://ada.bitocard.com/", "https://bitocard.com.evil.com/", "https://verify.bitocard.com/s", "nonsense"]) expect(returnHint(bad)).toBeNull();
  });
});

describe("the review console", () => {
  test("addresses: configured, else production, else local when on localhost", () => {
    expect(reviewApiBase("https://api.example.test/", "verify.bitocard.com")).toBe("https://api.example.test");
    expect(reviewApiBase("", "verify.bitocard.com")).toBe("https://api.bitocard.com");
    expect(reviewApiBase("", "localhost")).toBe("http://localhost:3001");
    expect(shqBase("", "localhost")).toBe("http://localhost:3004");
    expect(shqBase("", "verify.bitocard.com")).toBe("https://shq.bitocard.com");
    expect(signInUrl("https://shq.bitocard.com", "https://verify.bitocard.com/review/kyc_1?x=1")).toBe("https://shq.bitocard.com/signin?next=https%3A%2F%2Fverify.bitocard.com%2Freview%2Fkyc_1%3Fx%3D1");
  });

  test("ineligible businesses are told why, and nothing else", () => {
    expect(ineligible({ eligible: true, reason: null })).toBeNull();
    expect(ineligible({ eligible: false, reason: "not_registered" })?.title).toBe("Only registered businesses review ID checks");
    expect(ineligible({ eligible: false, reason: "kyb_not_verified" })?.title).toMatch(/not verified/);
    expect(ineligible({ eligible: false, reason: "role" })?.text).toMatch(/owner and admins/);
    expect(ineligible({ eligible: false, reason: null })?.title).toBe("Only registered businesses review ID checks");
  });

  test("the account in use, the tab and the list address", () => {
    const memberships = [{ reseller: { id: "rs_1" } }, { reseller: { id: "rs_2" } }];
    expect(pickAccount(memberships, "rs_2")).toBe("rs_2");
    expect(pickAccount(memberships, "rs_gone")).toBe("rs_1");
    expect(pickAccount([], null)).toBeNull();
    expect(queueStatus("approved")).toBe("approved");
    expect(queueStatus("draft")).toBe("submitted");
    expect(queueStatus(null)).toBe("submitted");
    expect(reviewListPath({ status: "submitted", customer: "cus_1", after: "kyc_9" })).toBe("/v1/kyc/reviews?status=submitted&limit=50&customer_id=cus_1&starting_after=kyc_9");
  });

  test("requests send the cookie and the account; POSTs an Idempotency-Key", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ object: "kyc_review", id: "kyc_1" })));
    vi.stubGlobal("fetch", fetch);
    await reviewRequest("/v1/kyc/reviews/kyc_1/approve", { method: "POST", body: { verified_name: "Ada" }, reseller: "rs_1", base: "http://api.test" });
    await reviewRequest("/v1/kyc/reviews/kyc_1", { reseller: "rs_1", base: "http://api.test" });
    await fetchReviewDocument("/v1/kyc/reviews/kyc_1/documents/d1", "rs_1", "http://api.test");
    const calls = fetch.mock.calls as unknown as Array<[string, RequestInit & { headers: Record<string, string> }]>;
    expect(calls.map(call => [call[0], call[1].method ?? "GET", call[1].credentials])).toEqual([
      ["http://api.test/v1/kyc/reviews/kyc_1/approve", "POST", "include"],
      ["http://api.test/v1/kyc/reviews/kyc_1", "GET", "include"],
      ["http://api.test/v1/kyc/reviews/kyc_1/documents/d1", "GET", "include"],
    ]);
    for (const call of calls) expect(call[1].headers["bitocard-reseller"]).toBe("rs_1");
    expect(calls[0][1].headers["idempotency-key"]).toBeTruthy();
    expect(calls[1][1].headers["idempotency-key"]).toBeUndefined();
  });

  test("a refused document throws, so the viewer shows it could not load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    await expect(fetchReviewDocument("/v1/kyc/reviews/kyc_1/documents/d1", null, "http://api.test")).rejects.toThrow();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await reviewRequest("/v1/kyc/reviews", { base: "http://api.test" })).toMatchObject({ ok: false, status: 0 });
  });
});
