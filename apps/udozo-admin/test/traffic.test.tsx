// Reports > Traffic sources: where udozo.com's visitors come from (ads, social, search, messaging, other sites,
// campaigns, direct), which campaigns and pages bring them and which bring sign-ups, for a period and a country.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/reports/traffic" }));

await import("@/app/api-product");
const { default: TrafficPage } = await import("@/app/(console)/reports/traffic/page");
const { changeWords, sourceName } = await import("@/components/traffic");

const channels = ["paid", "social", "search", "messaging", "email", "referral", "campaign", "direct"];
const answer = {
  object: "traffic_summary",
  days: 30,
  country: null,
  since: "2026-10-10",
  until: "2026-11-08",
  visits: 200,
  previous_visits: 100,
  signups: 12,
  signups_attributed: 5,
  channels: channels.map(channel => ({ channel, visits: channel === "paid" ? 120 : channel === "search" ? 80 : 0, share: channel === "paid" ? 60 : channel === "search" ? 40 : 0, signups: channel === "paid" ? 4 : 0 })),
  sources: [
    { channel: "paid", source: "facebook", visits: 120, share: 60, signups: 4 },
    { channel: "search", source: "google", visits: 80, share: 40, signups: 1 },
  ],
  campaigns: [{ source: "facebook", medium: "cpc", campaign: "lagos_phones_nov", visits: 120 }],
  landings: [{ landing: "listing", visits: 150 }, { landing: "home", visits: 50 }],
  markets: [{ country: "NG", visits: 150 }, { country: "WW", visits: 50 }],
  daily: [{ day: "2026-11-08", visits: 200, ...Object.fromEntries(channels.map(channel => [channel, channel === "paid" ? 120 : 0])) }],
};

let asked: URL[];
beforeEach(() => {
  asked = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const ok = (value: unknown) => Response.json(value);
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada", email: "ada@udozo.com", roles: ["support"] }, step_up_until: null });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/countries") return ok({ object: "list", data: [{ object: "country", code: "NG", name: "Nigeria", currency: "NGN" }] });
    if (url.pathname === "/v1/admin/traffic/summary") {
      asked.push(url);
      return ok({ ...answer, country: url.searchParams.get("country"), days: Number(url.searchParams.get("days")) });
    }
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = () =>
  render(
    <AdminProviders>
      <AdminGate>
        <TrafficPage />
      </AdminGate>
    </AdminProviders>,
  );
const slow = { timeout: 15000 };

describe("traffic sources", () => {
  test("the words for changes and sources", () => {
    expect(changeWords(200, 100)).toBe("Up 100% on the period before");
    expect(changeWords(50, 100)).toBe("Down 50% on the period before");
    expect(changeWords(3, 0)).toBe("New this period");
    expect([sourceName("facebook"), sourceName("x"), sourceName("techcabal.com")]).toEqual(["Facebook", "X (Twitter)", "techcabal.com"]);
  });

  test("visits, ads' share and sign-ups; channels, sources, campaigns, landings and markets", { timeout: 30000 }, async () => {
    show();
    expect((await screen.findAllByText("Up 100% on the period before", {}, slow)).length).toBeGreaterThan(0);
    expect(screen.getByText("60% of visits")).toBeTruthy();
    expect(screen.getAllByText("Facebook").length).toBeGreaterThan(0);
    expect(screen.getAllByText("lagos_phones_nov").length).toBeGreaterThan(0);
    expect(screen.getAllByText("A listing").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Across countries").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ads").length).toBeGreaterThan(0);
    expect(asked[0]!.searchParams.get("days")).toBe("30");
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "NG" } });
    await waitFor(() => expect(asked.some(url => url.searchParams.get("days") === "7" && url.searchParams.get("country") === "NG")).toBe(true), slow);
  });
});
