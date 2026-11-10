// Get help: the header's menu (open places as links, the rest marked Soon), the Contact us form and what it sends to
// Udozo's support team, and the FAQs.
import "./request";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ customerApi: vi.fn() }));
vi.mock("@/lib/customer", async original => ({ ...(await original<typeof import("@/lib/customer")>()), customerApi: api.customerApi }));
vi.mock("next/navigation", () => ({ usePathname: () => "/ng", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const { HelpMenu } = await import("@/components/help-menu");
const { ContactForm, contactProblem } = await import("@/components/help/contact-form");
const { sendContact } = await import("@/lib/contact-actions");
const { faqGroups, helpLinks } = await import("@/lib/help");
const { default: FaqsPage } = await import("@/app/(global)/help/faqs/page");

beforeEach(() => api.customerApi.mockReset());

describe("the Get help menu", () => {
  const html = renderToStaticMarkup(createElement(HelpMenu));

  it("lists every place in order; UdozoPay, FAQs, Resell on Udozo, Connect Centres and Contact us open, the rest marked Soon", () => {
    expect(helpLinks.map(link => link.label)).toEqual(["Help Centre", "UdozoPay", "Track orders", "FAQs", "Resell on Udozo", "Connect Centres", "Contact us"]);
    const links = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map(match => match[1]);
    expect(links).toEqual(["/safe-trade#udozopay", "/help/faqs", "/start-here", "/connect-centres", "/help/contact"]);
    for (const label of ["Help Centre", "Track orders"]) {
      const row = html.slice(html.lastIndexOf("<li", html.indexOf(label)), html.indexOf("</li>", html.indexOf(label)));
      expect(row).toContain('aria-disabled="true"');
      expect(row).toContain("Soon");
      expect(row).not.toContain("<a ");
    }
  });

  it("is a dropdown from a Get help button, its menu dropped with a pointer to it", () => {
    expect(html).toMatch(/<details[^>]*>\s*<summary[^>]*aria-label="Get help"/);
    expect(html).toContain('class="menu-drop ');
    expect(html).toContain('<nav aria-label="Get help"');
  });
});

describe("Contact us", () => {
  const ok = { kind: "safe_pay", name: "Chiamaka Eze", email: "chiamaka@example.com", phone: "", body: "The seller has not answered my order." };

  it("checks the form before sending, in the API's limits", () => {
    expect(contactProblem(ok)).toBeNull();
    expect(contactProblem({ ...ok, kind: "" })?.field).toBe("kind");
    expect(contactProblem({ ...ok, name: "C" })?.field).toBe("name");
    expect(contactProblem({ ...ok, email: "chiamaka" })?.field).toBe("email");
    expect(contactProblem({ ...ok, phone: "call me" })?.field).toBe("phone");
    expect(contactProblem({ ...ok, phone: "+234 803 112 0042" })).toBeNull();
    expect(contactProblem({ ...ok, body: "Help" })?.field).toBe("body");
  });

  it("sends the message once per form, with the country, and shows the reference", async () => {
    api.customerApi.mockResolvedValue({ ok: true, data: { object: "contact_message", reference: "C-000042", kind: "safe_pay", created_at: "2026-11-01T10:00:00.000Z" } });
    const sent = await sendContact({ ...ok, phone: " ", body: "  The seller has not answered my order.  ", country: "ng", nonce: "form-nonce-1234" });
    expect(sent).toEqual({ ok: true, data: { reference: "C-000042" } });
    expect(api.customerApi).toHaveBeenCalledWith("POST", "/v1/contact-messages", { kind: "safe_pay", name: "Chiamaka Eze", email: "chiamaka@example.com", body: "The seller has not answered my order.", country: "NG" }, { idempotencyKey: "form-nonce-1234" });
  });

  it("refuses an unknown topic before asking, and names the field the API refused", async () => {
    expect(await sendContact({ ...ok, kind: "jobs", country: null, nonce: "form-nonce-1234" })).toMatchObject({ ok: false, field: "kind" });
    expect(api.customerApi).not.toHaveBeenCalled();
    api.customerApi.mockResolvedValue({ ok: false, status: 429, code: "contact_limit", message: "You have sent us several messages in the last hour.", param: null });
    expect(await sendContact({ ...ok, country: null, nonce: "form-nonce-5678" })).toEqual({ ok: false, message: "You have sent us several messages in the last hour.", field: null });
  });

  it("the form: every topic, the reply address, an optional phone, and a warning never to send codes", () => {
    const html = renderToStaticMarkup(createElement(ContactForm, { initial: { name: "Chiamaka Eze", email: "chiamaka@example.com", phone: "" }, country: "NG" }));
    for (const topic of ["An order", "UdozoPay", "My account", "Selling", "Reselling on Seller HQ", "Reporting a person or listing", "Partnerships and press", "Something else"]) expect(html).toContain(`>${topic}</option>`);
    expect(html).toContain('value="chiamaka@example.com"');
    expect(html).toContain("(optional)");
    expect(html).toContain("Never send a password");
    expect(html).toContain("Send message");
  });

  it("the page gives the email, WhatsApp on one number and calls on another", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ object: "list", data: [], showcase: false })));
    const { default: ContactPage } = await import("@/app/(global)/help/contact/page");
    const html = renderToStaticMarkup(await ContactPage());
    vi.unstubAllGlobals();
    expect(html).toContain('href="mailto:support@udozo.com"');
    expect(html).toContain('href="https://wa.me/447440412759"');
    expect(html).toContain("+44 7440 412759");
    expect(html).toContain('href="tel:+447503040682"');
    expect(html).toContain("+44 7503 040682");
    expect(html).not.toContain("tel:+447440412759");
  });
});

describe("the FAQs", () => {
  const html = renderToStaticMarkup(createElement(FaqsPage));

  it("a section per topic, each question opening its answer, then Contact us", () => {
    for (const group of faqGroups) {
      expect(html).toContain(`id="${group.id}"`);
      expect(html).toContain(`href="#${group.id}"`);
    }
    expect(html.match(/<details/g)?.length).toBe(faqGroups.reduce((sum, group) => sum + group.faqs.length, 0));
    expect(html).toContain('href="/help/contact"');
  });

  it("keeps to what is true: listing free, UdozoPay's fee shown first, never a code asked for", () => {
    const text = faqGroups.flatMap(group => group.faqs.map(faq => `${faq.q} ${faq.a}`)).join(" ");
    expect(text).toContain("Signing up and listing are free");
    expect(text).toContain("A small fee, shown before");
    expect(text).toMatch(/Udozo will not ask for your password/);
    expect(text).not.toMatch(/guarantee|24\/7|WhatsApp/i);
  });
});
