// Identity checks: BitoCard Verify's are opened on their case (the API refuses deciding them from the list), and
// Didit's in review are still approved or declined here.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/verifications" }));

const { default: QueuePage } = await import("@/app/(console)/verifications/page");

const slow = { timeout: 10000 };
const check = (over: Record<string, unknown>) => ({
  object: "verification",
  subject: "reseller",
  reseller_id: "r1",
  reseller_name: "PickBetta Inc",
  mode: "live",
  customer_reference: null,
  method: "document",
  provider: "bitocard",
  provider_reference: "case-1",
  status: "in_review",
  country: "NG",
  expected_name: "Stanley Agu",
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
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada Okafor", email: "ada@bitocard.com", roles: ["operations"] }, step_up_until: null });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/verifications")
      return ok({ object: "list", has_more: false, data: [check({ id: "v1" }), check({ id: "v2", expected_name: "Ada Obi", provider: "didit", provider_reference: "didit-9" })] });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Verifications", () => {
  test("a Verify check links to its case instead of offering Approve; Didit's is decided here", async () => {
    render(
      <AdminProviders>
        <AdminGate>
          <QueuePage />
        </AdminGate>
      </AdminProviders>,
    );
    await screen.findAllByRole("link", { name: "Review case" }, slow);
    const table = within(screen.getByRole("table"));
    expect(table.getByRole("link", { name: "Review case" }).getAttribute("href")).toBe("/verifications/verify/case-1");
    // Only Didit's row has Approve and Decline.
    expect(table.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
    expect(table.getAllByRole("button", { name: "Decline" })).toHaveLength(1);
  });
});
