import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

const params = { id: "app1" };
const pushed: string[] = [];
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href), replace: () => undefined, prefetch: () => undefined }),
  useParams: () => params,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/connect/applications",
}));

await import("@/app/api-product");
const { default: ListPage } = await import("@/app/(console)/connect/applications/page");
const { default: ApplicationPage } = await import("@/app/(console)/connect/applications/[id]/page");
const { default: VisitorsPage } = await import("@/app/(console)/connect/visitors/page");
const { default: SettingsPage } = await import("@/app/(console)/connect/settings/page");
const { default: CentresPage } = await import("@/app/(console)/connect/centres/page");
const { menus, sections } = await import("@/components/shell");

const slow = { timeout: 10000 };

const application = (over: Record<string, unknown> = {}) => ({
  object: "connect_application",
  id: "app1",
  number: "CA-000007",
  status: "submitted",
  country: "NG",
  business_name: "Ikeja Parcel Hub",
  registration_number: "RC-123456",
  state: { id: "s1", name: "Lagos" },
  area: { id: "ar1", name: "Ikeja" },
  address: "12 Allen Avenue, Ikeja",
  landmark: "Opposite the filling station",
  latitude: null,
  longitude: null,
  hours: "Monday to Saturday, 8am to 6pm",
  phone: "+234 803 000 0001",
  capacity: 150,
  person_name: "Ngozi Ade",
  person_role: "Manager",
  photos: [
    { id: "p1", url: "https://cdn.test/shopfront.jpg", kind: "shopfront" },
    { id: "p2", url: "https://cdn.test/counter.jpg", kind: "counter" },
  ],
  deposit: { amount: 5_000_000, currency: "NGN", paid_at: "2026-11-02T09:00:00.000Z", returned_at: null },
  submitted_at: "2026-11-02T09:00:00.000Z",
  changes: null,
  visit: null,
  decision: null,
  withdrawn_at: null,
  centre: null,
  created_at: "2026-11-01T09:00:00.000Z",
  updated_at: "2026-11-02T09:00:00.000Z",
  applicant: { id: "c1", name: "Ngozi Ade", email: "ngozi@example.com", phone: "+2348030000001", phone_confirmed: true, identity_checked: true, since: "2026-01-05T00:00:00.000Z" },
  requirements: [
    { key: "details", met: true, label: "Your business, office, opening hours, phone, capacity and the person in charge" },
    { key: "photos", met: false, label: "Photos of the shopfront, the counter and where items are kept" },
  ],
  ...over,
});

const visitor = (over: Record<string, unknown> = {}) => ({ object: "connect_visitor", id: "v1", country: "NG", name: "Tunde Bello", phone: "08030000000", email: null, kind: "staff", trained_at: null, can_visit: true, active: true, created_at: "2026-11-01T00:00:00.000Z", ...over });

let roles: string[];
let deposit: number | null;
let current: ReturnType<typeof application>;
let sent: Array<{ method: string; path: string; search: string; body: unknown }>;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

beforeEach(() => {
  sent = [];
  pushed.length = 0;
  roles = ["operations"];
  deposit = 5_000_000;
  current = application();
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, search: url.search, body });
    const path = url.pathname;
    const ok = (value: unknown, status = 200) => Response.json(value, { status });
    if (path === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada Okafor", email: "ada@udozo.com", roles }, step_up_until: null });
    if (path === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (path === "/v1/admin/countries") return ok({ object: "list", data: [{ code: "NG", name: "Nigeria", currency: "NGN" }] });
    if (path === "/v1/admin/connect/applications") {
      const row: Record<string, unknown> = { ...current, applicant: { id: "c1", name: "Ngozi Ade", email: "ngozi@example.com" } };
      delete row.requirements;
      return ok({ object: "list", total: 1, data: [row] });
    }
    if (path === "/v1/admin/connect/applications/app1") return ok(current);
    if (path === "/v1/admin/connect/applications/app1/request-changes") return ok((current = application({ status: "changes_requested", changes: { note: (body as { note: string }).note, at: "2026-11-03T00:00:00.000Z" } })));
    if (path === "/v1/admin/connect/applications/app1/visit")
      return ok((current = application({ status: "visit_scheduled", visit: { at: (body as { at: string }).at, note: null, visitor: { id: "v1", name: "Tunde Bello", phone: null, kind: "staff" }, confirmed_at: null, reschedule_note: null, visited_at: null, passed: null, report: null } })));
    if (path === "/v1/admin/connect/applications/app1/visit/result") return ok((current = application({ status: "visited" })));
    if (path === "/v1/admin/connect/applications/app1/approve") return ok((current = application({ status: "approved", decision: { at: "2026-11-05T00:00:00.000Z", reason: null }, centre: { id: "cc1", number: "CC-000001", status: "active" } })));
    if (path === "/v1/admin/connect/applications/app1/reject") return ok((current = application({ status: "rejected", decision: { at: "2026-11-05T00:00:00.000Z", reason: (body as { reason: string }).reason } })));
    if (path === "/v1/admin/connect/visitors" && input.method === "GET")
      return ok({ object: "list", data: [visitor(), visitor({ id: "v2", name: "Amaka Agent", kind: "agent", can_visit: false }), visitor({ id: "v3", name: "Old Visitor", active: false, can_visit: false })] });
    if (path === "/v1/admin/connect/visitors") return ok(visitor({ id: "v9", ...(body as object), trained_at: (body as { trained?: boolean }).trained ? "2026-11-09T00:00:00.000Z" : null }), 201);
    if (path.startsWith("/v1/admin/connect/visitors/")) return ok(visitor({ ...(body as object) }));
    if (path === "/v1/admin/connect/states/NG") return ok({ object: "list", country: "NG", data: [{ id: "s1", name: "Lagos", slug: "lagos", open: true }, { id: "s2", name: "Kano", slug: "kano", open: false }] });
    if (path === "/v1/admin/connect/states/s1") return ok({ object: "connect_state", id: "s1", name: "Lagos", country: "NG", open: (body as { enabled: boolean }).enabled });
    if (path === "/v1/admin/connect/settings/NG") {
      if (input.method === "PUT") deposit = (body as { deposit: number | null }).deposit;
      return ok({ object: "connect_settings", country: "NG", name: "Nigeria", currency: "NGN", deposit });
    }
    if (path === "/v1/admin/connect/centres")
      return ok({
        object: "list",
        data: [{ object: "connect_centre", id: "cc1", number: "CC-000001", name: "Ikeja Parcel Hub", status: "active", country: "NG", state: "Lagos", area: "Ikeja", address: "12 Allen Avenue", hours: "8am to 6pm", phone: "+234", capacity: 150, deposit: { amount: 5_000_000, currency: "NGN" }, partner: { id: "c1", name: "Ngozi Ade", email: "ngozi@example.com" }, application_id: "app1", created_at: "2026-11-05T00:00:00.000Z" }],
      });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const shown = (children: React.ReactNode) =>
  render(
    <AdminProviders>
      <AdminGate>{children}</AdminGate>
    </AdminProviders>,
  );

const openDialog = () => within(document.querySelector<HTMLElement>("dialog[open]")!);
const lastSent = (suffix: string) => sent.filter(item => item.method !== "GET" && item.path.endsWith(suffix)).at(-1);

describe("Connect", () => {
  test("has its own section with applications, visitors, states and deposit, and centres", () => {
    expect(sections.some(item => item.key === "connect" && item.href === "/connect/applications")).toBe(true);
    expect(menus.connect.items.map(item => item.href)).toEqual(["/connect/applications", "/connect/visitors", "/connect/settings", "/connect/centres"]);
  });

  test("lists submitted applications and opens one", async () => {
    shown(<ListPage />);
    const row = (await screen.findAllByText("Ikeja Parcel Hub", {}, slow))[0]!.closest("tr")!;
    expect(row.textContent).toContain("CA-000007");
    expect(row.textContent).toContain("Ikeja, Lagos");
    expect(row.textContent).toContain("ngozi@example.com");
    expect(within(row).getByText("Submitted")).toBeTruthy();
    expect(sent.find(item => item.path === "/v1/admin/connect/applications")?.search).toContain("status=submitted");
    fireEvent.click(row);
    expect(pushed).toContain("/connect/applications/app1");

    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    await waitFor(() => expect(sent.filter(item => item.path === "/v1/admin/connect/applications").at(-1)?.search).not.toContain("status="), slow);
  });

  test("an application shows the office, its photos, the applicant and what is still needed", async () => {
    shown(<ApplicationPage />);
    expect(await screen.findByText("12 Allen Avenue, Ikeja", {}, slow)).toBeTruthy();
    expect(screen.getByText("Opposite the filling station")).toBeTruthy();
    expect(screen.getByText("Ngozi Ade, Manager")).toBeTruthy();
    const photo = screen.getByRole("img", { name: "Shopfront" });
    expect(photo.closest("a")?.getAttribute("href")).toBe("https://cdn.test/shopfront.jpg");
    expect(photo.closest("a")?.getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("link", { name: "ngozi@example.com" })).toBeTruthy();
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.getByText("Passed")).toBeTruthy();
    expect(screen.getByText(/Photos of the shopfront/).textContent).toContain("not met");
    expect(screen.getByText(/NGN\s*50,000\.00/)).toBeTruthy();
  });

  test("operations ask for changes, schedule and record the visit, then approve", async () => {
    shown(<ApplicationPage />);
    await screen.findByText("12 Allen Avenue, Ikeja", {}, slow);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Record visit" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ask for changes" }));
    fireEvent.change(openDialog().getByLabelText("Reason"), { target: { value: "Add a photo of the storage room." } });
    fireEvent.click(openDialog().getByRole("button", { name: "Ask for changes" }));
    await waitFor(() => expect(lastSent("/request-changes")?.body).toEqual({ note: "Add a photo of the storage room." }), slow);
    expect(await screen.findByText("Add a photo of the storage room.", {}, slow)).toBeTruthy();

    // Changes requested: only rejecting is left until the applicant sends it again.
    expect(screen.queryByRole("button", { name: "Ask for changes" })).toBeNull();
    current = application();
    cleanup();
    shown(<ApplicationPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Schedule visit" }, slow));
    await waitFor(() => expect(openDialog().getAllByRole("option").length).toBe(2), slow);
    expect(openDialog().queryByRole("option", { name: /Amaka Agent/ })).toBeNull();
    fireEvent.change(openDialog().getByLabelText("Who visits"), { target: { value: "v1" } });
    fireEvent.change(openDialog().getByLabelText("When"), { target: { value: "2027-01-10T10:30" } });
    fireEvent.click(openDialog().getByRole("button", { name: "Schedule visit" }));
    await waitFor(() => expect(lastSent("/visit")?.body).toEqual({ visitor_id: "v1", at: new Date("2027-01-10T10:30").toISOString(), note: null }), slow);

    fireEvent.click(await screen.findByRole("button", { name: "Record visit" }, slow));
    fireEvent.click(openDialog().getByLabelText("Yes, it passed"));
    fireEvent.change(openDialog().getByLabelText("Report"), { target: { value: "Clean, secure storage room." } });
    fireEvent.click(openDialog().getByRole("button", { name: "Record visit" }));
    await waitFor(() => expect(lastSent("/visit/result")?.body).toEqual({ passed: true, report: "Clean, secure storage room." }), slow);

    current = application({ status: "visited", visit: { at: "2027-01-10T09:30:00.000Z", note: null, visitor: { id: "v1", name: "Tunde Bello", phone: null, kind: "staff" }, confirmed_at: "2027-01-05T00:00:00.000Z", reschedule_note: null, visited_at: "2027-01-10T10:00:00.000Z", passed: true, report: "Clean, secure storage room." } });
    cleanup();
    shown(<ApplicationPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }, slow));
    expect(openDialog().getByText(/A Connect Centre will be made/)).toBeTruthy();
    fireEvent.click(openDialog().getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(lastSent("/approve")).toBeTruthy(), slow);
    expect(await screen.findByRole("link", { name: "CC-000001" }, slow)).toBeTruthy();
  });

  test("operations reject with a reason, told the deposit goes back", async () => {
    shown(<ApplicationPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }, slow));
    expect(openDialog().getByText(/deposit they paid goes back/)).toBeTruthy();
    fireEvent.change(openDialog().getByLabelText("Reason"), { target: { value: "The office is too small." } });
    fireEvent.click(openDialog().getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(lastSent("/reject")?.body).toEqual({ reason: "The office is too small." }), slow);
  });

  test("support reads an application but sees no actions", async () => {
    roles = ["support"];
    shown(<ApplicationPage />);
    await screen.findByText("12 Allen Avenue, Ikeja", {}, slow);
    for (const name of ["Ask for changes", "Schedule visit", "Record visit", "Approve", "Reject"]) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  test("finance sets the deposit in naira, sent in kobo; operations switch a state", async () => {
    roles = ["finance", "operations"];
    shown(<SettingsPage />);
    const input = await screen.findByLabelText("Deposit (NGN)", {}, slow);
    expect((input as HTMLInputElement).value).toBe("50000");
    fireEvent.change(input, { target: { value: "75000.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save deposit" }));
    await waitFor(() => expect(lastSent("/connect/settings/NG")?.body).toEqual({ deposit: 7_500_050 }), slow);

    fireEvent.change(await screen.findByLabelText("Deposit (NGN)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save deposit" }));
    await waitFor(() => expect(lastSent("/connect/settings/NG")?.body).toEqual({ deposit: null }), slow);
    expect(await screen.findByText(/cannot be submitted until the deposit is set/, {}, slow)).toBeTruthy();

    fireEvent.click(await screen.findByRole("switch", { name: "Open in Lagos" }));
    await waitFor(() => expect(lastSent("/connect/states/s1")?.body).toEqual({ enabled: false }), slow);
  });

  test("support cannot change the deposit or states", async () => {
    roles = ["support"];
    shown(<SettingsPage />);
    expect(await screen.findByText("Only finance can change the deposit.", {}, slow)).toBeTruthy();
    expect(((await screen.findByRole("switch", { name: "Open in Lagos" }, slow)) as HTMLButtonElement).disabled).toBe(true);
  });

  test("operations add a trained agent, and mark agents trained or deactivate visitors", async () => {
    shown(<VisitorsPage />);
    const row = (await screen.findAllByText("Amaka Agent", {}, slow))[0]!.closest("tr")!;
    expect(row.textContent).toContain("Not trained yet");
    fireEvent.click(within(row).getByRole("button", { name: "Mark trained" }));
    await waitFor(() => expect(lastSent("/connect/visitors/v2")?.body).toEqual({ trained: true }), slow);
    fireEvent.click(within(screen.getAllByText("Tunde Bello")[0]!.closest("tr")!).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(lastSent("/connect/visitors/v1")?.body).toEqual({ active: false }), slow);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Kemi Field" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "08031112222" } });
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "agent" } });
    fireEvent.click(screen.getByLabelText("Finished Udozo's training"));
    fireEvent.click(screen.getByRole("button", { name: "Add visitor" }));
    await waitFor(() => expect(lastSent("/connect/visitors")?.body).toEqual({ country: "NG", name: "Kemi Field", phone: "08031112222", email: null, kind: "agent", trained: true }), slow);
    expect(await screen.findByText("Kemi Field was added.", {}, slow)).toBeTruthy();
  });

  test("centres link to the application they came from", async () => {
    shown(<CentresPage />);
    const link = (await screen.findAllByRole("link", { name: "Ikeja Parcel Hub" }, slow))[0]!;
    expect(link.getAttribute("href")).toBe("/connect/applications/app1");
    expect(link.closest("tr")!.textContent).toContain("CC-000001");
  });
});
