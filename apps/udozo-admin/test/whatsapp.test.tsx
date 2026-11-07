// Site › WhatsApp: Udozo's number as Meta has it, the week's messages, templates with Meta's approval (Submit to Meta),
// and a number looked up and opted out. Marketplace › Wanted requests: every request, and operations removing one.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/whatsapp" }));

await import("@/app/api-product");
const { default: WhatsappPage } = await import("@/app/(console)/whatsapp/page");
const { default: WantedPage } = await import("@/app/(console)/classifieds/wanted/page");

let roles: string[];
let templates: Array<Record<string, unknown>>;
let sent: Array<{ method: string; path: string; body: unknown }>;

const request = {
  object: "classified_wanted_request",
  id: "11111111-1111-4111-8111-111111111111",
  number: "WR-000007",
  words: "LG OLED TV",
  details: "Black, 55 inch",
  country: "NG",
  category: { id: "c1", slug: "tvs", name: "TVs" },
  place: "Wuse, FCT",
  budget: { min: null, max: 40000000, currency: "NGN", text: "up to ₦400,000" },
  condition_text: null,
  status: "open",
  source: "whatsapp",
  sellers_told: 12,
  responses: 3,
  expires_at: "2026-11-20T10:00:00.000Z",
  created_at: "2026-11-06T10:00:00.000Z",
  buyer: { id: "b1", name: "Ngozi Obi", email: "ngozi@example.com" },
};

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

beforeEach(() => {
  roles = ["operations"];
  templates = [
    { object: "whatsapp_template", name: "udozo_new_message", purpose: "A chat message waiting.", body: "{{1}} sent you a message about {{2}}.", button: "Read it", language: "en_GB", status: "approved", rejected_reason: null },
    { object: "whatsapp_template", name: "udozo_wanted_match", purpose: "A request that fits.", body: "A buyer is looking for {{1}}.", button: "See request", language: "en_GB", status: "not_submitted", rejected_reason: null },
  ];
  sent = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname + url.search, body });
    const ok = (value: unknown, status = 200) => Response.json(value, { status });
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada", email: "ada@udozo.com", roles }, step_up_until: null });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/countries") return ok({ object: "list", data: [{ code: "NG", name: "Nigeria" }] });
    if (url.pathname === "/v1/admin/whatsapp")
      return ok({ object: "whatsapp_overview", configured: true, number: "+2348000000000", meta: { name: "Udozo", display: "+234 800 000 0000", quality: "GREEN", error: null }, contacts: { total: 40, linked: 31, opted_out: 2 }, week: { received: 125, sent: { sent: 30, delivered: 50, read: 40, queued: 1 }, failed: 4 }, failures: [{ id: "f1", kind: "template", template: "udozo_new_message", error: "template_recently_sent", phone: "+234803123••••", created_at: "2026-11-06T09:00:00.000Z" }] });
    if (url.pathname === "/v1/admin/whatsapp/templates") return ok({ object: "list", data: templates });
    if (url.pathname === "/v1/admin/whatsapp/templates/submit") {
      templates = templates.map(item => (item.status === "not_submitted" ? { ...item, status: "pending" } : item));
      return ok({ object: "whatsapp_template_submission", submitted: ["udozo_wanted_match"], failed: [], templates });
    }
    if (url.pathname === "/v1/admin/whatsapp/contacts") return ok({ object: "whatsapp_contact", id: "w1", phone: "+2348031234567", country: "NG", customer: { id: "c9", name: "Kemi Adeyemi", email: "kemi@example.com" }, linked_at: null, opted_in_at: null, opted_out_at: null, unreachable_at: null, last_inbound_at: "2026-11-06T09:00:00.000Z", flow: null, messages: [] });
    if (url.pathname === "/v1/admin/whatsapp/contacts/w1/opt-out") return ok({ object: "whatsapp_contact", id: "w1", phone: "+2348031234567", messages: [] });
    if (url.pathname === "/v1/admin/classifieds/wanted") return ok({ object: "list", data: [request], total: 1 });
    if (url.pathname === `/v1/admin/classifieds/wanted/${request.id}/remove`) return ok({ ...request, status: "removed" });
    return ok({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, 404);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (Page: () => React.ReactNode) =>
  render(
    <AdminProviders>
      <AdminGate>
        <Page />
      </AdminGate>
    </AdminProviders>,
  );
const slow = { timeout: 15000 };
const long = { timeout: 30000 };

describe("Site › WhatsApp", () => {
  test("the number, the week, failures and templates; Submit to Meta sends the missing ones", long, async () => {
    show(WhatsappPage);
    expect(await screen.findByText("Quality green", {}, slow)).toBeTruthy();
    expect(screen.getByText("125")).toBeTruthy();
    expect(screen.getAllByText("template_recently_sent").length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Not submitted", {}, slow)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Submit to Meta" }));
    expect(await screen.findByText("Submitted 1 to Meta for approval.", {}, slow)).toBeTruthy();
    expect(sent.some(item => item.method === "POST" && item.path === "/v1/admin/whatsapp/templates/submit")).toBe(true);
  });

  test("a number is looked up and opted out with a reason; support cannot opt out or submit", long, async () => {
    show(WhatsappPage);
    fireEvent.change(await screen.findByLabelText("WhatsApp number", {}, slow), { target: { value: "+234 803 123 4567" } });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));
    expect(await screen.findByText("Kemi Adeyemi (kemi@example.com)", {}, slow)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Opt this number out" }));
    fireEvent.change(await screen.findByLabelText(/reason/i, {}, slow), { target: { value: "Asked us by email" } });
    fireEvent.click(screen.getByRole("button", { name: "Opt out" }));
    await waitFor(() => expect(sent.find(item => item.path === "/v1/admin/whatsapp/contacts/w1/opt-out")?.body).toEqual({ reason: "Asked us by email" }), slow);

    cleanup();
    roles = ["support"];
    show(WhatsappPage);
    expect((await screen.findAllByText("Not submitted", {}, slow)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Submit to Meta" })).toBeNull();
  });
});

describe("Marketplace › Wanted requests", () => {
  test("lists requests with their reach, and operations remove one with a reason", long, async () => {
    show(WantedPage);
    expect((await screen.findAllByText("LG OLED TV", {}, slow)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("3 answered").length).toBeGreaterThan(0);
    expect(screen.getAllByText("12 told").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    fireEvent.change(await screen.findByLabelText(/reason/i, {}, slow), { target: { value: "Asks for a weapon" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" }).at(-1)!);
    await waitFor(() => expect(sent.find(item => item.path === `/v1/admin/classifieds/wanted/${request.id}/remove`)?.body).toEqual({ reason: "Asks for a weapon" }), slow);
  });
});
