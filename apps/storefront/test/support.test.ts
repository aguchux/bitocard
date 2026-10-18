import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";
import { ticketAuthor, ticketStatusLabel } from "@/lib/support";
import { activeTab } from "@/components/app/tabs";
import { accountSections } from "@/components/app/account-sections";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const revalidatePath = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

const { closeTicket, openTicket, replyToTicket } = await import("@/lib/support-actions");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  setRequest({ host: "acme.bitocard.com" }, { bc_customer: "bcc_session" });
  redirect.mockClear();
  revalidatePath.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("support labels and places", () => {
  test("say whose turn it is in the customer's words, and never name staff", () => {
    expect(["open", "pending", "resolved"].map(status => ticketStatusLabel(status as "open"))).toEqual(["Waiting for the store", "Waiting for you", "Resolved"]);
    expect(ticketAuthor({ author: "reseller", author_name: null }, "Acme")).toBe("Acme");
    expect(ticketAuthor({ author: "bitocard", author_name: null }, "Acme")).toBe("BitoCard");
    expect(ticketAuthor({ author: "bot", author_name: "Ada" }, "Acme")).toBe("Ada (assistant)");
    expect(ticketAuthor({ author: "customer", author_name: "Chidi" }, "Acme")).toBe("You");
  });

  test("support pages sit under the Account tab, listed with its screens", () => {
    expect(activeTab("/account/support/abc")).toBe("/account/profile");
    expect(accountSections.find(section => section.key === "support")?.href).toBe("/account/support");
  });
});

describe("support actions", () => {
  test("asking sends the question (and the order) with the customer's session and store, then opens the ticket", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ object: "support_ticket", id: "t1" }), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await expect(openTicket({}, form({ checkout_id: "c1", category: "order", subject: "Token?", message: "No token yet." }))).rejects.toThrow("redirect:/account/support/t1");
    const [[url, init]] = fetch.mock.calls as unknown as Call[];
    expect([url, init.method]).toEqual(["http://api.test/v1/store/support/tickets", "POST"]);
    expect(JSON.parse(String(init.body))).toEqual({ subject: "Token?", category: "order", message: "No token yet.", checkout_id: "c1" });
    expect([init.headers["bitocard-customer-session"], init.headers["bitocard-store"]]).toEqual(["bcc_session", "acme"]);
  });

  test("a question without an order sends none; an expired session signs in again and comes back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { type: "authentication_error", code: "session_expired", message: "Sign in", request_id: "r" } }), { status: 401 })));
    await expect(openTicket({}, form({ category: "other", subject: "Hello", message: "A question" }))).rejects.toThrow(`redirect:/signin?next=${encodeURIComponent("/account/support/new")}`);
  });

  test("replying and closing post to the ticket and refresh it; errors are shown", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ object: "support_ticket", id: "t1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await replyToTicket({}, form({ id: "t1", body: "Thanks" }))).toEqual({ notice: "Sent." });
    expect(await closeTicket({}, form({ id: "t1" }))).toEqual({ notice: "Closed. Reply any time to reopen it." });
    const urls = (fetch.mock.calls as unknown as Call[]).map(([url]) => url);
    expect(urls).toEqual(["http://api.test/v1/store/support/tickets/t1/messages", "http://api.test/v1/store/support/tickets/t1/close"]);
    expect(revalidatePath).toHaveBeenCalledWith("/account/support/t1");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { type: "invalid_request_error", code: "parameter_invalid", message: "Too long", param: "body", request_id: "r" } }), { status: 400 })));
    expect(await replyToTicket({}, form({ id: "t1", body: "x" }))).toEqual({ error: "Too long", field: "body" });
  });
});
