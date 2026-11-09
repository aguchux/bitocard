// The identity check is optional on Udozo unless the market's customer_identity_check switch is on: UdozoPay's set-up
// page then marks it optional and lets the seller add their payout account straight away.
import "./request";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ customerApi: vi.fn() }));
vi.mock("@/lib/customer", async original => ({ ...(await original<typeof import("@/lib/customer")>()), customerApi: api.customerApi }));
vi.mock("@/lib/account", async original => ({ ...(await original<typeof import("@/lib/account")>()), requireSeller: vi.fn(async () => ({ id: "c1" })) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/account/udozopay", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const { default: SafePaySetup } = await import("@/app/(account)/account/udozopay/page");

const readiness = (identity_required: boolean | undefined) => ({ object: "classified_safe_pay_readiness", identity_required, identity_checked: false, payout_account: false, ready: false, limited: false, strikes: 0, strike_limit: 3 });
const answer = (identity_required: boolean | undefined) =>
  api.customerApi.mockImplementation(async (_method: string, path: string) => {
    if (path === "/v1/classifieds/me/safe-pay") return { ok: true, data: readiness(identity_required) };
    if (path === "/v1/store/cash/banks") return { ok: true, data: { object: "list", data: [{ code: "044", name: "Access Bank" }] } };
    return { ok: true, data: { object: "list", data: [] } };
  });

beforeEach(() => api.customerApi.mockReset());

describe("UdozoPay's set-up", () => {
  it("optional: the check is marked optional and the payout account can be added in the seller's own name", async () => {
    answer(false);
    const html = renderToStaticMarkup(await SafePaySetup());
    expect(html).toContain("Identity check (optional)");
    expect(html).toContain("Not needed to get paid.");
    expect(html).toContain("own name, as on your Udozo account");
    expect(html).not.toContain("Add it once your identity check has passed.");
    expect(html).toContain("Access Bank");
  });

  it("required (or an older answer saying nothing): the check comes first, as before", async () => {
    for (const required of [true, undefined]) {
      answer(required);
      const html = renderToStaticMarkup(await SafePaySetup());
      expect(html).not.toContain("(optional)");
      expect(html).toContain("Start the identity check");
      expect(html).toContain("Add it once your identity check has passed.");
    }
  });
});
