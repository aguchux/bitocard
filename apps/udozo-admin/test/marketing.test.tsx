import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

let params: Record<string, string> = {};
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: () => undefined, prefetch: () => undefined }), useParams: () => params, useSearchParams: () => new URLSearchParams(), usePathname: () => "/classifieds/marketing" }));

await import("@/app/api-product");
const { menus } = await import("@/components/shell");
const { batches, guessMapping, parseCsv, rowsFor, sellersIn } = await import("@/components/marketing/csv");
const { fillTemplate, templatesFor, whatsappMessage } = await import("@/components/marketing/templates");
const { default: MarketingPage } = await import("@/app/(console)/classifieds/marketing/page");
const { default: ImportPage } = await import("@/app/(console)/classifieds/marketing/import/page");
const { default: NewPage } = await import("@/app/(console)/classifieds/marketing/new/page");
const { default: ProspectPage } = await import("@/app/(console)/classifieds/marketing/[id]/page");

const slow = { timeout: 10000 };
const jiji = [
  "advert_url,title,price,category,location,seller_display_name,notes,phone",
  'https://jiji.ng/ikeja/mobile-phones/iphone-12.html,Apple iPhone 12 256 GB Blue,"₦ 299,999",Mobile Phones,"Lagos, Ikeja",ALPHA GADGETS NG,Verified ID; 4.8; ENTERPRISE | Used,09032391587',
  'https://jiji.ng/ikeja/tablets/ipad.html,"Apple iPad mini 6, 256 GB","₦ 469,999",Tablets,"Lagos, Ikeja",ALPHA GADGETS NG,Verified ID | Used,09032391587',
  'https://jiji.ng/ikeja/headphones/g321.html,G321 Headset PC,"₦ 87,000",Headphones,"Lagos, Ikeja",,"8+ YEARS ON JIJI | Wireless",08177582741; 07011554582',
  'https://jiji.ng/ikeja/mobile-phones/pixel.html,-5%,"₦ 864,500",Mobile Phones,"Lagos, Ikeja",,"Verified ID | Used",',
].join("\r\n");

const prospect = {
  object: "marketing_prospect",
  id: "p1",
  name: "ALPHA GADGETS NG",
  store_name: null,
  phones: ["+2349032391587"],
  email: null,
  country: "NG",
  location: "Lagos, Ikeja",
  categories: ["Mobile Phones", "Tablets"],
  adverts: [{ url: "https://jiji.ng/ikeja/mobile-phones/iphone-12.html", title: "Apple iPhone 12 256 GB Blue", price: "₦ 299,999", category: "Mobile Phones", location: "Lagos, Ikeja" }],
  source: "Jiji",
  source_notes: "Verified ID; 4.8; ENTERPRISE",
  stage: "reach_out",
  stage_status: "not_started",
  status_reason: null,
  outcome: null,
  owner: null,
  next_action: null,
  next_action_at: null,
  last_contact_at: null,
  follow_ups: 0,
  invite_code: "abc123def0",
  invite_link: "https://udozo.com/i/abc123def0",
  invited_at: null,
  invite_emailed_at: null,
  clicked_at: null,
  clicks: 0,
  do_not_contact: false,
  customer_id: null,
  linked_at: null,
  feedback: { rating: null, would_recommend: null, notes: null, advocacy: null },
  notes: null,
  created_at: "2026-10-31T00:00:00.000Z",
  updated_at: "2026-10-31T00:00:00.000Z",
} as const;
const summary = {
  object: "marketing_summary",
  total: 1,
  funnel: { reached: 0, invited: 0, clicked: 0, signed_up: 0, posted: 0, feedback: 0 },
  stages: ["reach_out", "invitation", "onboarding", "follow_up", "feedback"].map(stage => ({ stage, total: stage === "reach_out" ? 1 : 0, statuses: { not_started: stage === "reach_out" ? 1 : 0, in_progress: 0, waiting: 0, done: 0, skipped: 0, failed: 0 } })),
  due: { overdue: 0, today: 0 },
  unassigned: 1,
  owners: [{ id: "a1", name: "Lizzy Okafor" }, { id: "a2", name: "Stanley Eze" }],
};
let sent: Array<{ method: string; path: string; body: unknown }>;

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
  params = {};
  push.mockClear();
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname + url.search, body });
    const ok = (value: unknown, status = 200) => Response.json(value, { status });
    // Support only: Marketing is every admin role's.
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Lizzy Okafor", email: "lizzy@udozo.com", roles: ["support"] }, step_up_until: null });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/marketing/summary") return ok(summary);
    if (url.pathname === "/v1/admin/marketing/prospects/import") return ok({ object: "marketing_import", rows: (body as { rows: unknown[] }).rows.length, created: 2, merged: 0, skipped: [{ row: 3, reason: "no_contact" }] });
    if (url.pathname === "/v1/admin/marketing/prospects") return ok({ object: "list", data: [prospect], total: 1, has_more: false });
    if (url.pathname === "/v1/admin/marketing/invites") return ok({ ...prospect, id: "p2", email: (body as { email: string }).email, account: null, activities: [], email_sent: "resend" });
    if (url.pathname.startsWith("/v1/admin/marketing/prospects/p1")) return ok({ ...prospect, account: null, activities: [{ object: "marketing_activity", id: "x1", kind: "imported", channel: null, template: null, body: "Imported from a Jiji list with 1 advert.", replied: null, outcome: null, stage: null, status: null, actor: null, created_at: "2026-10-31T00:00:00.000Z" }] });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (node: React.ReactNode) =>
  render(
    <AdminProviders>
      <AdminGate>{node}</AdminGate>
    </AdminProviders>,
  );

describe("reading a Jiji list", () => {
  test("quoted prices and titles with commas, CRLF lines and two numbers in one cell are read; columns are matched by name", () => {
    const table = parseCsv(`﻿${jiji}\r\n`);
    expect(table).toHaveLength(5);
    expect(table[1]![2]).toBe("₦ 299,999");
    expect(table[2]![1]).toBe("Apple iPad mini 6, 256 GB");
    const mapping = guessMapping(table[0]!);
    expect(mapping).toMatchObject({ advert_url: 0, title: 1, price: 2, category: 3, location: 4, name: 5, notes: 6, phone: 7, email: null, store_name: null });
    const rows = rowsFor(table, mapping);
    expect(rows[0]).toEqual({ advert_url: "https://jiji.ng/ikeja/mobile-phones/iphone-12.html", title: "Apple iPhone 12 256 GB Blue", price: "₦ 299,999", category: "Mobile Phones", location: "Lagos, Ikeja", name: "ALPHA GADGETS NG", notes: "Verified ID; 4.8; ENTERPRISE | Used", phone: "09032391587" });
    expect(rows[2]!.phone).toBe("08177582741; 07011554582");
    expect(rows[3]!.phone).toBeUndefined();
    expect(sellersIn(rows)).toBe(2);
    expect(batches(Array.from({ length: 250 }, (_, index) => index)).map(part => part.length)).toEqual([100, 100, 50]);
    expect(parseCsv('a,"say ""hi""\nthere"\n')).toEqual([["a", 'say "hi"\nthere']]);
  });
});

describe("messages", () => {
  test("each stage's message is filled for the seller, with their link, and opened in WhatsApp with the text", () => {
    const invite = templatesFor("invitation")[0]!;
    expect(invite.key).toBe("invitation");
    const text = fillTemplate(invite.text, prospect as never, { name: "Lizzy Okafor" }, "https://udozo.com");
    expect(text).toContain("Thanks Alpha!");
    expect(text).toContain("https://udozo.com/i/abc123def0");
    expect(text).not.toMatch(/\{\w+\}/);
    const first = fillTemplate(templatesFor("reach_out")[0]!.text, prospect as never, { name: "Lizzy Okafor" }, "https://udozo.com");
    expect(first).toMatch(/^Hello Alpha, I'm Lizzy from Udozo\. I came across your mobile phones adverts on Jiji/);
    expect(whatsappMessage("+2349032391587", "Hi there")).toBe("https://wa.me/2349032391587?text=Hi%20there");
  });
});

describe("Marketplace > Marketing", () => {
  test("is in the Marketplace menu, and a support admin sees the pipeline with its funnel", async () => {
    expect(menus.marketplace!.items.some(item => item.href === "/classifieds/marketing" && item.label === "Marketing")).toBe(true);
    show(<MarketingPage />);
    const rows = await screen.findAllByText("ALPHA GADGETS NG", {}, slow);
    expect(await screen.findByText("The funnel", {}, slow)).toBeTruthy();
    fireEvent.click(rows[0]!);
    expect(push).toHaveBeenCalledWith("/classifieds/marketing/p1");
  });

  test("a list is imported in batches with its source and owner", async () => {
    show(<ImportPage />);
    fireEvent.change(await screen.findByLabelText("Or paste it", {}, slow), { target: { value: jiji } });
    expect(await screen.findByText("4 rows, about 2 sellers.", {}, slow)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Give them to"), { target: { value: "a2" } });
    fireEvent.click(screen.getByRole("button", { name: "Import 4 rows" }));
    expect(await screen.findByText(/2 sellers added, 0 already here updated, 1 rows skipped/, {}, slow)).toBeTruthy();
    const call = sent.find(item => item.path === "/v1/admin/marketing/prospects/import")!;
    expect(call.body).toMatchObject({ source: "Jiji", owner_id: "a2" });
    expect((call.body as { rows: unknown[] }).rows).toHaveLength(4);
    expect(screen.getByText(/Row 5: no phone or email/)).toBeTruthy();
  });

  test("anyone can be invited by email, then opened in the pipeline", async () => {
    show(<NewPage />);
    fireEvent.change(await screen.findByLabelText("Email", {}, slow), { target: { value: "chioma@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send the invitation" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/classifieds/marketing/p2"), slow);
    expect(sent.find(item => item.path === "/v1/admin/marketing/invites")!.body).toMatchObject({ email: "chioma@example.com" });
  });

  test("a seller's page offers WhatsApp with the message, their invite link and the timeline, and logs what was sent", async () => {
    params = { id: "p1" };
    const open = vi.fn();
    vi.stubGlobal("open", open);
    show(<ProspectPage />);
    expect(await screen.findByDisplayValue("https://udozo.com/i/abc123def0", {}, slow)).toBeTruthy();
    expect(screen.getByText("Imported from a Jiji list with 1 advert.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open in WhatsApp" }));
    expect(open.mock.calls[0]![0]).toMatch(/^https:\/\/wa\.me\/2349032391587\?text=Hello%20Alpha/);
    await waitFor(() => expect(sent.some(item => item.path === "/v1/admin/marketing/prospects/p1/activities")).toBe(true), slow);
    expect(sent.find(item => item.path === "/v1/admin/marketing/prospects/p1/activities")!.body).toMatchObject({ kind: "message", channel: "whatsapp", template: "reach_out" });
  });
});
