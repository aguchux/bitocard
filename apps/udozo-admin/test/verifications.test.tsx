// Identity > All checks in Udozo's words: Udozo Verify (never the internal "bitocard"), the customer by name with a
// link to them, and Verify's checks opened on their case instead of decided from the list.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/verifications/all" }));

await import("@/app/api-product");
const { default: AllPage } = await import("@/app/(console)/verifications/all/page");
const { providerLabel } = await import("@/components/verification-list");

const slow = { timeout: 10000 };
const check = (over: Record<string, unknown>) => ({
  object: "verification",
  subject: "customer",
  reseller_id: "r1",
  reseller_name: "Udozo",
  mode: "live",
  customer_reference: null,
  customer: null,
  method: "document",
  provider: "bitocard",
  provider_reference: "case-1",
  status: "in_review",
  country: "NG",
  expected_name: null,
  verified_name: null,
  document_country: null,
  reason: null,
  consent_at: "2026-11-01T12:00:00.000Z",
  decided_by_id: null,
  decided_at: null,
  created_at: "2026-11-01T13:42:00.000Z",
  ...over,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const ok = (value: unknown) => Response.json(value);
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada Okafor", email: "ada@udozo.com", roles: ["operations"] }, step_up_until: null });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/verifications")
      return ok({
        object: "list",
        has_more: false,
        data: [
          check({ id: "v1", customer_reference: "4df154a2-889f-4c37-a434-e02102b341de", customer: { id: "4df154a2-889f-4c37-a434-e02102b341de", name: "Kemi Adeyemi", email: "kemi@example.com" } }),
          check({ id: "v2", subject: "reseller", reseller_name: "PickBetta Inc", expected_name: "Stanley Agu", provider: "didit", provider_reference: "didit-9", status: "in_review" }),
        ],
      });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Identity > All checks", () => {
  test("Udozo Verify by name, the customer by name and email, and Verify's checks reviewed on their case", async () => {
    render(
      <AdminProviders>
        <AdminGate>
          <AllPage />
        </AdminGate>
      </AdminProviders>,
    );
    // The table (DataTable also draws each row as a card for phones).
    await screen.findAllByRole("link", { name: /Kemi Adeyemi/ }, slow);
    const table = within(screen.getByRole("table"));
    const customer = table.getByRole("link", { name: /Kemi Adeyemi/ });
    expect(customer.getAttribute("href")).toBe("/customers/4df154a2-889f-4c37-a434-e02102b341de");
    expect(customer.textContent).toContain("kemi@example.com");
    expect(table.getByText("ID document · Udozo Verify")).toBeTruthy();
    expect(table.getByRole("link", { name: "Review case" }).getAttribute("href")).toBe("/verifications/verify/case-1");
    // Didit's check in review is still decided here.
    expect(table.getByText("ID document · Didit")).toBeTruthy();
    expect(table.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
    const page = document.body.textContent ?? "";
    expect(page).not.toMatch(/bitocard|BitoCard/);
    expect(page).not.toContain("4df154a2-889f-4c37-a434-e02102b341de");
  });

  test("providers are named in words", () => {
    expect(providerLabel("bitocard")).toBe("Udozo Verify");
    expect(providerLabel("didit")).toBe("Didit");
  });
});
