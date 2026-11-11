import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

// admin.udozo.com > POS: an account's staff (milestone 5), read only: each member's role, tills and status, the owner's
// own roles, the tills' linked devices and managers' approvals. Udozo never sees a PIN.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
  useParams: () => ({ id: "acc1" }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/pos/accounts/acc1",
}));

await import("@/app/api-product");
const { PosStaffCard, tillsWords } = await import("@/components/pos-staff");

const slow = { timeout: 10000 };
let sent: string[];

beforeEach(() => {
  sent = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const path = new URL(input.url).pathname;
    sent.push(path);
    const ok = (value: unknown) => Response.json(value);
    if (path === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ade Bello", email: "ade@udozo.com", roles: ["support"] }, step_up_until: null });
    if (path === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (path === "/v1/admin/pos/accounts/acc1/staff")
      return ok({
        object: "pos_account_staff",
        staff: {
          object: "list",
          limit: 3,
          used: 2,
          data: [
            { id: "k1", name: "Kemi Ade", initials: "KA", phone_hint: "+234 •••• 000", role: { id: "cashier", key: "cashier", name: "Cashier" }, all_tills: false, tills: [{ id: "t1", name: "Till 1", shop_id: "s1" }], status: "active", locked_until: null, last_active_at: "2026-11-11T09:00:00Z", invited_by: "Ada Okafor", created_at: "2026-11-10T09:00:00Z" },
            { id: "t2", name: "Tunde Bakare", initials: "TB", phone_hint: "+234 •••• 111", role: { id: "r1", key: null, name: "Weekend help" }, all_tills: true, tills: [], status: "invited", locked_until: null, last_active_at: null, invited_by: "Ada Okafor", created_at: "2026-11-10T09:00:00Z" },
          ],
        },
        roles: { object: "list", data: [{ id: "r1", key: null, name: "Weekend help", system: false, permissions: { sell: "yes", refund: "approval", staff: "no" }, discount_limit_bps: 0, staff: 1 }] },
        devices: [{ id: "d1", name: "Front counter", platform: "windows", till: { id: "t1", name: "Till 1" }, linked_at: "2026-11-10T09:00:00Z", last_seen_at: null, revoked_at: null, linked_by: "Ada Okafor" }],
        approvals: [{ id: "p1", action: "refund", subject_id: "s1", requested_by: "Kemi Ade", approved_by: "Chinedu Eze", till_id: "t1", created_at: "2026-11-11T10:00:00Z" }],
      });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("POS staff in admin", () => {
  test("an account's staff, roles, devices and approvals, read only", async () => {
    render(
      <AdminProviders>
        <AdminGate>
          <PosStaffCard account="acc1" />
        </AdminGate>
      </AdminProviders>,
    );
    expect(await screen.findByText("Kemi Ade · Cashier", {}, slow)).toBeTruthy();
    expect(screen.getByText("Staff · 2 of 3")).toBeTruthy();
    expect(screen.getByText("Invite pending")).toBeTruthy();
    expect(screen.getByText(/Weekend help · 1 staff/)).toBeTruthy();
    expect(screen.getByText("sell, refund (approval)")).toBeTruthy();
    expect(screen.getByText(/Front counter · Till 1 · windows/)).toBeTruthy();
    expect(screen.getByText(/Refund: Kemi Ade, approved by Chinedu Eze/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(sent).toContain("/v1/admin/pos/accounts/acc1/staff");
  });

  test("words where someone works", () => {
    expect(tillsWords({ all_tills: true, tills: [] })).toBe("Every till");
    expect(tillsWords({ all_tills: false, tills: [] })).toBe("No till");
  });
});
