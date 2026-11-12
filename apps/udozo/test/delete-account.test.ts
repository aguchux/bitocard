// Deleting a Udozo account on udozo.com (the app does it too, and Google Play links the help page): the typed DELETE
// and the password go to the API; deleted, this browser forgets the session and goes home.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { request, setRequest } from "./request";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url), notFound: () => redirect("not-found") }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { deleteAccount } = await import("@/lib/account-actions");
const { deletionRemoves, deletionScreen } = await import("@/lib/account-deletion");

let calls: Array<{ url: string; method: string; body: unknown }>;
let reply: () => Response;
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.stubEnv("API_URL", "https://api.test");
  vi.stubEnv("UDOZO_URL", "https://udozo.com");
  setRequest({ host: "udozo.com" }, { udz_customer: "bcc_mine" });
  redirect.mockClear();
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null });
    return reply();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("deleting the account", () => {
  test("sends DELETE and the password; deleted, the session is forgotten and it goes home", async () => {
    reply = () => Response.json({ object: "account_deletion", deleted: true, deleted_at: "2026-11-12T10:00:00.000Z" });
    await expect(deleteAccount({}, form({ confirm: "DELETE", password: "a long password" }))).rejects.toThrow("redirect:/?account=deleted");
    expect(calls[0]).toMatchObject({ url: "https://api.test/v1/store/account/delete", method: "POST", body: { confirm: "DELETE", password: "a long password" } });
    expect(request.cookies.has("udz_customer")).toBe(false);
  });

  test("a refusal stays on the page with the API's words; no password sent when none was typed", async () => {
    reply = () => Response.json({ error: { type: "conflict_error", code: "account_has_money", message: "Your wallet or payouts still hold money." } }, { status: 409 });
    expect(await deleteAccount({}, form({ confirm: "DELETE" }))).toEqual({ error: "Your wallet or payouts still hold money.", field: null });
    expect(calls[0]!.body).toEqual({ confirm: "DELETE" });
    expect(request.cookies.get("udz_customer")).toBe("bcc_mine");
  });

  test("the help page (for Google Play) and Profile lead to the delete page, and say what is removed", () => {
    const help = readFileSync(new URL("../app/(global)/help/delete-account/page.tsx", import.meta.url), "utf8");
    const profile = readFileSync(new URL("../app/(account)/account/profile/page.tsx", import.meta.url), "utf8");
    expect(help).toContain("deletionScreen");
    expect(profile).toContain("deletionScreen");
    expect(deletionScreen).toBe("/account/profile/delete");
    expect(deletionRemoves.join(" ")).toMatch(/listings/);
  });
});
