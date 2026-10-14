import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";

// redirect() throws in Next.js; here it records where it was sent.
class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));

const { startVerification } = await import("@/lib/account-actions");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
};

async function start(values: Record<string, string>) {
  try {
    return await startVerification({}, form(values));
  } catch (error) {
    if (error instanceof Redirected) return { redirected: error.to };
    throw error;
  }
}

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  vi.stubEnv("STOREFRONT_URL", "https://bitocard.com");
  setRequest({ host: "ada.bitocard.com" }, { bc_customer: "bcc_session" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("starting the identity check", () => {
  test("BitoCard Verify: no BVN is sent, and the customer goes to the link, returning to this store", async () => {
    const fetch = vi.fn(async () => reply({ status: "in_progress", url: "https://verify.bitocard.com/s#t=abcdefghijklmnopqrstuvwx" }));
    vi.stubGlobal("fetch", fetch);
    const result = await start({ country: "NG", provider: "bitocard", first_name: "Ada", last_name: "Obi", bvn: "12345678901", consent: "on" });
    expect(result).toEqual({ redirected: "https://verify.bitocard.com/s#t=abcdefghijklmnopqrstuvwx" });
    const [call] = fetch.mock.calls as unknown as Call[];
    expect([call[0], call[1].method]).toEqual(["http://api.test/v1/store/account/verification", "POST"]);
    expect(call[1].headers["bitocard-store"]).toBe("ada");
    expect(JSON.parse(String(call[1].body))).toEqual({
      country: "NG",
      first_name: "Ada",
      last_name: "Obi",
      consent: true,
      redirect_url: "https://ada.bitocard.com/account/verification?country=NG",
    });
  });

  test("the BVN check still sends the BVN where BitoCard Verify does not run", async () => {
    const fetch = vi.fn(async () => reply({ status: "in_progress", url: "https://bank.example/consent" }));
    vi.stubGlobal("fetch", fetch);
    await start({ country: "NG", provider: "didit", first_name: "Ada", last_name: "Obi", bvn: "12345678901", consent: "on" });
    const [call] = fetch.mock.calls as unknown as Call[];
    expect(JSON.parse(String(call[1].body)).bvn).toBe("12345678901");
  });

  test("the API's refusal stays on the form", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "consent_required", message: "Agree to the check first.", param: "consent" } }, 400)));
    expect(await start({ country: "GH", provider: "bitocard", first_name: "Kofi", last_name: "Mensah" })).toEqual({ error: "Agree to the check first.", field: "consent" });
  });
});
