// @vitest-environment jsdom
// Udozo on WhatsApp on udozo.com (docs/UDOZO_WHATSAPP_PLAN.md): Profile > WhatsApp connects a number with a one-time
// code sent from it, then its choices and Disconnect; listing pages offer Ask on WhatsApp where it is open, the footer
// links Udozo's number and Post a request, and wanted requests are posted, closed and answered.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const calls = vi.hoisted(() => ({ list: [] as Array<{ method: string; path: string; body?: unknown }>, replies: new Map<string, unknown>() }));
vi.mock("@/lib/customer", () => ({
  customerApi: async (method: string, path: string, body?: unknown) => {
    calls.list.push({ method, path, body });
    const reply = calls.replies.get(`${method} ${path}`);
    return reply ?? { ok: false, status: 404, code: null, message: "No", param: null };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/api", () => ({
  shopApi: async (path: string) => (path === "/v1/classifieds/channels?country=NG" ? { ok: true, data: { object: "classified_channels", country: "NG", whatsapp: { available: true, number: "+2348000000000" }, wanted: true } } : { ok: false, status: 0, code: null }),
}));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { askOnWhatsappHref, channelsFor, whatsappErrorText, whatsappHref } = await import("@/lib/whatsapp");
const { startWhatsappLink, setWhatsappChoices, disconnectWhatsapp } = await import("@/lib/whatsapp-actions");
const { conditionsFor, wantedErrorText, wantedWhen } = await import("@/lib/wanted");
const { answerWanted, closeWanted, postWanted } = await import("@/lib/wanted-actions");
const { WhatsappConnect } = await import("@/components/account/whatsapp-connect");
const { SiteFooter } = await import("@/components/footer");

const connection = (extra = {}) => ({ object: "whatsapp_connection" as const, available: true, number: "+2348000000000", chat_link: "https://wa.me/2348000000000?text=Hi", connected: false, phone: null, connected_at: null, opted_out: false, chats: true, alerts: true, window_open: false, ...extra });

let container: HTMLDivElement;
beforeEach(() => {
  calls.list = [];
  calls.replies = new Map();
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

describe("links to Udozo's number", () => {
  it("wa.me links carry Udozo's digits and the message; Ask on WhatsApp sends L <ref>", () => {
    expect(whatsappHref("+234 800 000 0000", "Hi")).toBe("https://wa.me/2348000000000?text=Hi");
    expect(askOnWhatsappHref("+2348000000000", 1234)).toBe("https://wa.me/2348000000000?text=L%201234");
    expect([whatsappHref(null), whatsappHref("123")]).toEqual([null, null]);
  });

  it("a market's channels come from the API, and are closed while it cannot answer or the code is not a country", async () => {
    expect((await channelsFor("ng")).whatsapp).toEqual({ available: true, number: "+2348000000000" });
    expect((await channelsFor("GH")).whatsapp.available).toBe(false);
    expect((await channelsFor("nope")).wanted).toBe(false);
  });

  it("the footer links Post a request and Udozo on WhatsApp only when given them", () => {
    const html = renderToStaticMarkup(createElement(SiteFooter, { country: { code: "NG", name: "Nigeria" }, whatsapp: "https://wa.me/2348000000000?text=Hi", wanted: "/ng/wanted/new" }));
    expect(html).toContain('href="https://wa.me/2348000000000?text=Hi"');
    expect(html).toContain('href="/ng/wanted/new"');
    const plain = renderToStaticMarkup(createElement(SiteFooter, { country: null }));
    expect(plain).not.toContain("WhatsApp");
    expect(plain).not.toContain("Post a request");
  });
});

describe("Profile > WhatsApp", () => {
  it("Connect makes a code and opens WhatsApp with LINK <code>; I sent it reads the connection again", async () => {
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    calls.replies.set("POST /v1/store/account/whatsapp/link", { ok: true, data: { object: "whatsapp_link", code: "ABCD2345", link: "https://wa.me/2348000000000?text=LINK%20ABCD2345", expires_at: "2026-11-07T10:10:00.000Z" } });
    calls.replies.set("GET /v1/store/account/whatsapp", { ok: true, data: connection({ connected: true, phone: "+2348031234567" }) });
    const root = createRoot(container);
    await act(async () => root.render(createElement(WhatsappConnect, { initial: connection() })));
    const connect = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Connect WhatsApp"))!;
    await act(async () => connect.click());
    expect(opened).toHaveBeenCalledWith("https://wa.me/2348000000000?text=LINK%20ABCD2345", "_blank", "noopener");
    expect(container.textContent).toContain("LINK ABCD2345");
    const sent = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("I sent it"))!;
    await act(async () => sent.click());
    expect(container.textContent).toContain("Connected to +2348031234567");
    expect(container.querySelectorAll('[role="switch"]').length).toBe(2);
    act(() => root.unmount());
  });

  it("a choice is saved, and undone when the API refuses it", async () => {
    calls.replies.set("PATCH /v1/store/account/whatsapp", { ok: false, status: 409, code: "whatsapp_not_connected", message: "x", param: null });
    const root = createRoot(container);
    await act(async () => root.render(createElement(WhatsappConnect, { initial: connection({ connected: true, phone: "+2348031234567" }) })));
    const chats = container.querySelector<HTMLButtonElement>('[aria-labelledby="wa-chats"]')!;
    await act(async () => chats.click());
    expect(chats.getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).toContain("Connect your WhatsApp first.");
    act(() => root.unmount());
  });

  it("the actions call the account's WhatsApp routes and word refusals plainly", async () => {
    calls.replies.set("PATCH /v1/store/account/whatsapp", { ok: true, data: connection({ connected: true, chats: false }) });
    calls.replies.set("DELETE /v1/store/account/whatsapp", { ok: true, data: connection() });
    expect((await setWhatsappChoices({ chats: false, alerts: "yes" as never })).ok).toBe(true);
    expect(calls.list.at(-1)).toEqual({ method: "PATCH", path: "/v1/store/account/whatsapp", body: { chats: false } });
    expect((await disconnectWhatsapp()).ok).toBe(true);
    expect(await startWhatsappLink()).toEqual({ ok: false, message: "No" });
    expect(whatsappErrorText({ status: 429, code: "link_code_limit", message: "" })).toMatch(/several codes/);
    expect(whatsappErrorText({ status: 401, code: null, message: "" })).toBe("Sign in again to carry on.");
  });
});

describe("wanted requests", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";
  const form = (values: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    return data;
  };

  it("posting checks what it can, sends the budget in minor units and the condition as stored", async () => {
    expect(await postWanted(null, form({ words: "tv", category_id: uuid }))).toMatchObject({ ok: false, param: "words" });
    expect(await postWanted(null, form({ words: "LG OLED TV", category_id: "x" }))).toMatchObject({ ok: false, param: "category_id" });
    expect(await postWanted(null, form({ words: "LG OLED TV", category_id: uuid, budget_max: "cheap" }))).toMatchObject({ ok: false, param: "budget_max" });
    calls.replies.set("POST /v1/classifieds/wanted", { ok: true, data: { id: uuid, number: "WR-000001", matches: [], sellers_told: 3 } });
    const posted = await postWanted(null, form({ words: "LG OLED TV", category_id: uuid, area_id: uuid, budget_max: "400,000", condition: "used", details: "Black" }));
    expect(posted?.ok).toBe(true);
    expect(calls.list.at(-1)?.body).toEqual({ words: "LG OLED TV", category_id: uuid, area_id: uuid, budget_max: 40000000, details: "Black", conditions: ["used", "untested"] });
    expect(conditionsFor("any")).toEqual([]);
  });

  it("closing and answering call the request's routes; refusals are worded", async () => {
    calls.replies.set(`POST /v1/classifieds/wanted/${uuid}/close`, { ok: true, data: { id: uuid, status: "fulfilled" } });
    expect((await closeWanted(uuid, true)).ok).toBe(true);
    expect(calls.list.at(-1)?.body).toEqual({ fulfilled: true });
    calls.replies.set(`POST /v1/classifieds/wanted/${uuid}/respond`, { ok: false, status: 409, code: "already_answered", message: "x", param: null });
    expect(await answerWanted(uuid, uuid, " It is here ")).toEqual({ ok: false, message: "You already answered this request." });
    expect(calls.list.at(-1)?.body).toEqual({ listing_id: uuid, note: "It is here" });
    expect(await answerWanted("nope", uuid, "")).toEqual({ ok: false, message: "Choose one of your listings." });
    expect(wantedErrorText({ status: 409, code: "too_many_requests", message: "" })).toMatch(/Close one first/);
  });

  it("says when a request ends", () => {
    const now = Date.parse("2026-11-07T10:00:00.000Z");
    expect(wantedWhen({ status: "open", expires_at: "2026-11-10T09:00:00.000Z" }, now)).toBe("Ends in 3 days");
    expect(wantedWhen({ status: "open", expires_at: "2026-11-08T09:00:00.000Z" }, now)).toBe("Ends tomorrow");
    expect(wantedWhen({ status: "fulfilled", expires_at: "2026-11-08T09:00:00.000Z" }, now)).toBe("Found it");
  });
});

describe("codes on WhatsApp", () => {
  it("the profile's phone form offers Send it on WhatsApp beside the text where Udozo is on WhatsApp, and only WhatsApp where the country cannot text", async () => {
    const { PhoneForm } = await import("@/components/account/phone-form");
    const both = renderToStaticMarkup(createElement(PhoneForm, { phone: "+2348031234567", verified: false, country: "NG", available: true, whatsapp: true }));
    expect(both).toContain("Verify this number");
    expect(both).toMatch(/<button type="submit" value="whatsapp"[^>]*name="channel">Send it on WhatsApp/);
    const onlyWhatsapp = renderToStaticMarkup(createElement(PhoneForm, { phone: "+2348031234567", verified: false, country: "NG", available: false, whatsapp: true }));
    expect(onlyWhatsapp).toContain("Verify this number on WhatsApp");
    expect(onlyWhatsapp).not.toContain("not available in your country");
    const textOnly = renderToStaticMarkup(createElement(PhoneForm, { phone: "+2348031234567", verified: false, country: "NG", available: true }));
    expect(textOnly).not.toContain("WhatsApp");
  });
});
