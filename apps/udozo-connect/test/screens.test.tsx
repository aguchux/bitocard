// @vitest-environment jsdom
// The application page in each state, its visit and withdraw actions (confirmed in Udozo Connect's own dialog), and
// the wizard's Check and send step with its requirements' links.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { application } from "./fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({
  confirmVisit: vi.fn(),
  rescheduleVisit: vi.fn(),
  withdrawApplication: vi.fn(),
  saveApplication: vi.fn(),
  loadApplication: vi.fn(),
  removePhoto: vi.fn(),
  acceptAgreement: vi.fn(),
  submitApplication: vi.fn(),
}));
vi.mock("@/lib/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const { ApplicationView } = await import("@/components/application-view");
const { ApplyWizard } = await import("@/components/apply-wizard");

const visit = { at: "2026-11-12T10:00:00.000Z", note: "Please have the storeroom open.", visitor: { name: "Tunde Bello", phone: "+2348030000000" }, confirmed_at: null, reschedule_note: null, visited_at: null };
const html = (app: ReturnType<typeof application>) => renderToStaticMarkup(createElement(ApplicationView, { application: app }));

const mounted: Array<() => void> = [];
function mount(element: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(element));
  mounted.push(() => act(() => root.unmount()));
  return host;
}
afterEach(() => {
  mounted.splice(0).forEach(unmount => unmount());
  document.body.innerHTML = "";
  Object.values(actions).forEach(fn => fn.mockReset());
});
const button = (host: HTMLElement, words: string) => [...host.querySelectorAll("button")].find(item => item.textContent?.trim() === words)!;

describe("the application page", () => {
  it("asks for the changes Udozo wants, back into the wizard", () => {
    const page = html(application({ status: "changes_requested", submitted_at: "2026-11-09T10:00:00.000Z", changes: { note: "A clearer shopfront photo, please.", at: "2026-11-10T10:00:00.000Z" } }));
    expect(page).toContain("Udozo asked for changes");
    expect(page).toContain("A clearer shopfront photo, please.");
    expect(page).toContain('href="/apply"');
    expect(page).toContain("Make the changes");
    expect(page).toContain("Withdraw application");
  });

  it("shows a scheduled visit with who comes, Confirm this time and Ask for another time", () => {
    const page = html(application({ status: "visit_scheduled", visit }));
    expect(page).toContain("Tunde Bello");
    expect(page).toContain('href="tel:+2348030000000"');
    expect(page).toContain("Please have the storeroom open.");
    expect(page).toContain("Confirm this time");
    expect(page).toContain("Ask for another time");
  });

  it("confirms the visit and asks for another time with a note", async () => {
    const updated = application({ status: "visit_scheduled", visit: { ...visit, confirmed_at: "2026-11-10T10:00:00.000Z" } });
    actions.confirmVisit.mockResolvedValue({ ok: true, application: updated });
    const host = mount(createElement(ApplicationView, { application: application({ status: "visit_scheduled", visit }) }));
    await act(async () => button(host, "Confirm this time").click());
    expect(actions.confirmVisit).toHaveBeenCalledWith(updated.id);
    expect(host.textContent).toContain("You confirmed this time.");

    actions.rescheduleVisit.mockResolvedValue({ ok: true, application: application({ status: "visit_scheduled", visit: { ...visit, reschedule_note: "Any weekday after 2pm" } }) });
    await act(async () => button(host, "Ask for another time").click());
    const dialog = document.querySelector("dialog")!;
    expect(dialog.textContent).toContain("When suits you");
    const send = [...dialog.querySelectorAll("button")].find(item => item.textContent === "Send")!;
    expect(send.disabled).toBe(true);
    const box = dialog.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(box, "Any weekday after 2pm");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => send.click());
    expect(actions.rescheduleVisit).toHaveBeenCalledWith(updated.id, "Any weekday after 2pm");
  });

  it("withdraws only after the confirmation, saying the deposit goes back", async () => {
    const paid = application({ status: "submitted", submitted_at: "2026-11-09T10:00:00.000Z", deposit: { amount: 5_000_000, currency: "NGN", paid_at: "2026-11-09T10:00:00.000Z", returned_at: null } });
    actions.withdrawApplication.mockResolvedValue({ ok: true, application: { ...paid, status: "withdrawn", withdrawn_at: "2026-11-10T10:00:00.000Z" } });
    const host = mount(createElement(ApplicationView, { application: paid }));
    await act(async () => button(host, "Withdraw application").click());
    const dialog = document.querySelector("dialog")!;
    expect(dialog.textContent).toContain("your deposit goes back to your UdozoPay wallet");
    await act(async () => [...dialog.querySelectorAll("button")].find(item => item.textContent === "Keep it")!.click());
    expect(actions.withdrawApplication).not.toHaveBeenCalled();
    await act(async () => button(host, "Withdraw application").click());
    await act(async () => [...document.querySelector("dialog")!.querySelectorAll("button")].find(item => item.textContent === "Withdraw application")!.click());
    expect(actions.withdrawApplication).toHaveBeenCalledWith(paid.id);
    expect(host.textContent).toContain("You withdrew this application");
  });

  it("names the centre once approved and opens it", () => {
    const page = html(application({ status: "approved", decision: { at: "2026-11-13T10:00:00.000Z", reason: null }, centre: { id: "c1", number: "CC-000003", status: "active" } }));
    expect(page).toContain("You are a Udozo Connect Centre");
    expect(page).toContain("CC-000003");
    expect(page).toContain('href="/centre/c1"');
    expect(page).toContain("Open your centre");
    expect(page).not.toContain("Withdraw application");
  });

  it("gives the reason when rejected, and that a paid deposit is back", () => {
    const page = html(
      application({
        status: "rejected",
        decision: { at: "2026-11-13T10:00:00.000Z", reason: "The office is too small." },
        deposit: { amount: 5_000_000, currency: "NGN", paid_at: "2026-11-09T10:00:00.000Z", returned_at: "2026-11-13T10:00:00.000Z" },
      }),
    );
    expect(page).toContain("The office is too small.");
    expect(page).toContain("Your deposit is back in your UdozoPay wallet");
    expect(page).not.toContain("Withdraw application");
  });

  it("never uses the browser's own confirm or prompt", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(__dirname, "..");
    const files = ["app", "components", "lib"].flatMap(dir => readdirSync(join(root, dir), { recursive: true, encoding: "utf8" }).filter(name => /\.tsx?$/.test(name)).map(name => join(root, dir, name)));
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(/\bwindow\.(confirm|prompt|alert)\s*\(|(^|[^.\w])(confirm|prompt|alert)\s*\(\s*["'`]/m);
  });
});

describe("Check and send", () => {
  const settings = {
    object: "connect_apply_settings" as const,
    country: "NG",
    open: true,
    deposit: { amount: 5_000_000, currency: "NGN" },
    states: [{ id: "s1", name: "Lagos", slug: "lagos", open: true }],
    agreement: { version: "2026-11-09", path: "/legal/connect-centres", accepted: false },
    photos: { kinds: ["shopfront", "counter", "storage", "other"] as const, required: ["shopfront", "counter", "storage"] as const, max: 12 },
    application_id: null,
  };
  const requirements = [
    { key: "details" as const, met: true, label: "Your business" },
    { key: "photos" as const, met: true, label: "Photos" },
    { key: "state" as const, met: true, label: "State" },
    { key: "identity" as const, met: false, label: "Your identity check" },
    { key: "mobile" as const, met: false, label: "A confirmed mobile number" },
    { key: "agreement" as const, met: false, label: "The Connect Centre agreement" },
    { key: "deposit" as const, met: false, label: "The deposit in your UdozoPay wallet" },
  ];
  const wizard = (overrides = {}) =>
    mount(
      createElement(ApplyWizard, {
        settings: { ...settings, photos: { ...settings.photos, kinds: [...settings.photos.kinds], required: [...settings.photos.required] } },
        states: [{ id: "s1", name: "Lagos", areas: [{ id: "a1", name: "Ikeja" }] }],
        application: application({ requirements, editable: true, ...overrides }),
        initialStep: "send",
        udozo: "https://udozo.test",
      }),
    );

  it("links each unmet requirement to where it is put right, shows the deposit and holds Send until all are met", () => {
    const host = wizard();
    const links = [...host.querySelectorAll("a")].map(link => link.getAttribute("href"));
    expect(links).toContain("https://udozo.test/account/verification");
    expect(links).toContain("https://udozo.test/account/profile#phone");
    expect(links).toContain("https://udozo.test/account/wallet");
    expect(links).toContain("https://udozo.test/legal/connect-centres");
    expect(host.textContent).toContain("₦50,000");
    expect(button(host, "Send application").disabled).toBe(true);
  });

  it("accepts the agreement's version, and sends with the deposit seen", async () => {
    const met = requirements.map(item => ({ ...item, met: true }));
    const host = wizard({ requirements: met });
    actions.acceptAgreement.mockResolvedValue({ ok: true, application: application({ requirements: met }) });
    await act(async () => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    expect(actions.acceptAgreement).toHaveBeenCalledWith(expect.any(String), "2026-11-09");
    actions.submitApplication.mockResolvedValue({ ok: false, message: "Still needed: your identity check.", code: "application_incomplete", param: "identity" });
    await act(async () => button(host, "Send application").click());
    expect(actions.submitApplication).toHaveBeenCalledWith(expect.any(String), 5_000_000);
    expect(host.textContent).toContain("Still needed: your identity check.");
  });

  it("opens the step a refusal names", async () => {
    const met = requirements.map(item => ({ ...item, met: true }));
    const host = wizard({ requirements: met });
    actions.submitApplication.mockResolvedValue({ ok: false, message: "Still needed: photos.", code: "application_incomplete", param: "photos" });
    await act(async () => button(host, "Send application").click());
    expect(host.querySelector("#step-title")!.textContent).toBe("Photos");
    expect(host.textContent).toContain("Still needed: photos.");
  });
});
