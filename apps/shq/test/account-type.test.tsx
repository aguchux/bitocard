// Selling as an individual or a business: the business profile on Settings > Business, switching type on the identity
// check (with a warning saying what changes), and the business check once the owner's identity is approved.
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    prefetch: () => undefined,
  }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings",
}));
vi.mock("@/components/shq-shell", () => ({
  ShqShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/reseller", () => ({
  useReseller: () => ({
    membership: {
      role: "owner",
      reseller: {
        id: "r1",
        name: "Ada Digital",
        country: "NG",
        status: "active",
      },
    },
    mode: "live",
    setMode: () => undefined,
  }),
  can: () => true,
}));

const { BusinessProfileCard, changedFields } = await import("@/components/business-profile");
const { AccountTypeCard, BusinessCheckCard, switchWarning } = await import("@/components/account-type");

const profile = (over: object = {}) => ({
  object: "business_profile",
  account_type: "individual",
  name: "Ada Digital",
  country: "NG",
  status: "active",
  legal_name: null,
  address_line: null,
  city: null,
  state: null,
  postal_code: null,
  phone: null,
  description: null,
  owner_verified: true,
  business_verified: false,
  verified_business: null,
  paused_for_kyb: false,
  ...over,
});
const check = (over: object = {}) => ({
  object: "reseller_verification" as const,
  provider: "bitocard" as const,
  kind: "kyb" as const,
  business_type: "unregistered" as const,
  kyb_verified: false,
  reseller_status: "active" as const,
  verified: true,
  verified_at: "2026-11-01T10:00:00.000Z",
  status: "approved" as const,
  url: null,
  reason: null,
  started_at: "2026-11-01T09:00:00.000Z",
  account_type: "individual" as const,
  paused_for_kyb: false,
  business_check: null,
  business_url: null,
  ...over,
});

let calls: Array<{ method: string; path: string; body: unknown }>;
beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  calls = [];
  globalThis.fetch = (async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json();
    calls.push({ method: input.method, path: url.pathname, body });
    if (url.pathname === "/v1/reseller/profile" && input.method === "GET") return Response.json(profile());
    if (url.pathname === "/v1/reseller/profile") return Response.json(profile(body as object));
    if (url.pathname === "/v1/reseller/account-type")
      return Response.json(
        profile({
          account_type: (body as { account_type: string }).account_type,
          status: "pending",
          paused_for_kyb: true,
        }),
      );
    return Response.json(
      {
        error: {
          type: "not_found_error",
          code: "resource_missing",
          message: "Not found.",
          request_id: "req_1",
        },
      },
      { status: 404 },
    );
  }) as typeof fetch;
});
afterEach(cleanup);

const wrap = (node: ReactNode) => render(<AdminProviders>{node}</AdminProviders>);

describe("the business profile", () => {
  it("saves only what changed: legal name, address, telephone and description", async () => {
    wrap(<BusinessProfileCard manage />);
    fireEvent.change(await screen.findByLabelText("Legal name"), {
      target: { value: "Golojan Ltd" },
    });
    fireEvent.change(screen.getByLabelText("City"), {
      target: { value: "Lagos" },
    });
    fireEvent.change(screen.getByLabelText("State"), {
      target: { value: "Lagos" },
    });
    fireEvent.change(screen.getByLabelText("Telephone"), {
      target: { value: "+234 803 123 4567" },
    });
    fireEvent.change(screen.getByLabelText("What the business does"), {
      target: { value: "Gift cards." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(calls.some(call => call.method === "PATCH")).toBe(true));
    expect(calls.find(call => call.method === "PATCH")?.body).toEqual({
      legal_name: "Golojan Ltd",
      city: "Lagos",
      state: "Lagos",
      phone: "+234 803 123 4567",
      description: "Gift cards.",
    });
    expect(await screen.findByText("Business profile saved.")).toBeTruthy();
    expect(screen.getByText("You sell as an individual")).toBeTruthy();
  });

  it("an emptied field is sent empty, to clear it", () => {
    const before = {
      legal_name: "A",
      address_line: "",
      city: "Lagos",
      state: "",
      postal_code: "",
      phone: "",
      description: "",
    };
    expect(changedFields(before, { ...before, city: "  " })).toEqual({
      city: "",
    });
  });
});

describe("switching type", () => {
  it("warns that live selling pauses, then switches", async () => {
    wrap(<AccountTypeCard check={check()} owner />);
    fireEvent.click(screen.getByRole("radio", { name: /Business/ }));
    expect(await screen.findByText(/Live selling pauses until your business passes its check/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch to business", hidden: true }));
    await waitFor(() => expect(calls.find(call => call.path === "/v1/reseller/account-type")?.body).toEqual({ account_type: "business" }));
  });

  it("says what happens each way", () => {
    expect(switchWarning(check({ kyb_verified: true, business_type: "registered" }), "business")).toMatch(/already verified/);
    expect(
      switchWarning(
        check({
          account_type: "business",
          business_check: {
            status: "in_progress",
            reason: null,
            started_at: "x",
            decided_at: null,
          },
        }),
        "individual",
      ),
    ).toMatch(/closed/);
    expect(switchWarning(check(), "individual")).toMatch(/keep selling/);
  });

  it("only the owner switches, and not while a check is reviewed", () => {
    wrap(
      <AccountTypeCard
        check={check({
          business_check: {
            status: "in_review",
            reason: null,
            started_at: "x",
            decided_at: null,
          },
        })}
        owner
      />,
    );
    expect((screen.getByRole("radio", { name: /Business/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/once the check being reviewed is decided/)).toBeTruthy();
  });

  it("a paused business account is told, and verifies its business after consenting", () => {
    wrap(<BusinessCheckCard check={check({ account_type: "business", paused_for_kyb: true })} owner />);
    const button = screen.getByRole("button", {
      name: "Verify my business",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(button.disabled).toBe(false);
  });
});
