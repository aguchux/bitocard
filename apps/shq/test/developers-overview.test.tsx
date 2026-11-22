// Developers > Overview: the environment panel with its big switch, live and sandbox side by side, the period's
// figures, and why live is closed; the header's two-part switch.
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/developers" }));
vi.mock("@/components/shq-shell", () => ({ ShqShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
const state = { role: "developer", mode: "test" as "test" | "live", status: "pending" };
const setMode = vi.fn((mode: "test" | "live") => {
  state.mode = mode;
});
vi.mock("@/components/reseller", () => ({
  useReseller: () => ({ membership: { role: state.role, reseller: { status: state.status } }, mode: state.mode, setMode }),
  can: (membership: { role: string }, ...roles: string[]) => membership.role === "owner" || roles.includes(membership.role),
}));

const { default: OverviewPage } = await import("@/app/(console)/developers/page");
const { ModeToggle } = await import("@/components/environment");

const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const overview = (over: object = {}) => ({
  object: "developer_overview",
  mode: "test",
  days: 7,
  from: day(6),
  live: { ready: false, reason: "identity_check" },
  environments: { live: { api_keys: 0, webhook_endpoints: 0 }, test: { api_keys: 2, webhook_endpoints: 1 } },
  api_keys: { active: 2, used_in_period: 1, last_used_at: new Date().toISOString(), last_used_by: "Backend" },
  webhooks: { endpoints: 1, enabled: 1, disabled: 0, failing: 1 },
  deliveries: { total: 40, succeeded: 38, failed: 2, pending: 0, success_rate: 95 },
  events: { total: 52, top_types: [{ type: "order.completed", count: 30 }, { type: "top_up.succeeded", count: 12 }] },
  orders: { total: 31, completed: 29, processing: 0, failed: 2, refunded: 0, through_api: 27 },
  series: Array.from({ length: 7 }, (_, index) => ({ day: day(6 - index), events: index, orders: index, deliveries_succeeded: index, deliveries_failed: 0 })),
  ...over,
});
let answer: unknown;
let asked: URL[];

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  Object.assign(state, { role: "developer", mode: "test", status: "pending" });
  setMode.mockClear();
  asked = [];
  answer = overview();
  globalThis.fetch = (async (input: Request) => {
    const url = new URL(input.url);
    asked.push(url);
    if (url.pathname === "/v1/developers/overview") return Response.json(answer);
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found.", request_id: "req_1" } }, { status: 404 });
  }) as typeof fetch;
});

afterEach(cleanup);

const page = () =>
  render(
    <AdminProviders>
      <OverviewPage />
    </AdminProviders>,
  );

describe("the developer overview", () => {
  it("shows the sandbox, why live is closed, both environments and the period's figures", async () => {
    page();
    expect(screen.getByRole("heading", { name: "You are in the sandbox" })).toBeTruthy();
    expect(await screen.findByText("27")).toBeTruthy();
    expect(screen.getByText(/Going live needs your identity check/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start the identity check" }).getAttribute("href")).toBe("/settings/verification");
    expect(screen.getByText("You are here")).toBeTruthy();
    expect(screen.getAllByText("95%").length).toBeGreaterThan(0);
    expect(screen.getByText("order.completed")).toBeTruthy();
    expect(screen.getByText("1 endpoint is failing")).toBeTruthy();
    expect(asked.at(-1)?.searchParams.get("days")).toBe("7");

    fireEvent.click(screen.getByRole("button", { name: /^Go live/ }));
    expect(setMode).toHaveBeenCalledWith("live");
  });

  it("asks for 30 days, and says nothing blocks a live account", async () => {
    state.mode = "live";
    answer = overview({ mode: "live", live: { ready: true, reason: "verified" } });
    page();
    expect(screen.getByRole("heading", { name: "You are live" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "30 days" }));
    await vi.waitFor(() => expect(asked.some(url => url.searchParams.get("days") === "30")).toBe(true));
    expect(screen.queryByText(/Going live needs/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Switch to sandbox/ }));
    expect(setMode).toHaveBeenCalledWith("test");
  });

  it("members who are not developers are told so, and nothing is asked", () => {
    state.role = "finance";
    page();
    expect(screen.getByText("Owners, admins and developers only")).toBeTruthy();
    expect(asked).toHaveLength(0);
  });
});

describe("the header's environment switch", () => {
  it("marks the current environment and switches to the other", () => {
    render(<ModeToggle />);
    expect(screen.getByRole("radio", { name: "Sandbox" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Sandbox" }));
    expect(setMode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Live" }));
    expect(setMode).toHaveBeenCalledWith("live");
  });
});
