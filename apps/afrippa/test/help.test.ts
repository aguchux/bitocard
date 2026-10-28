import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
vi.mock("next/navigation", async original => ({ ...(await original<typeof import("next/navigation")>()), redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, unstable_cache: (fn: () => unknown) => fn }));

const help = await import("@/lib/help");
const { default: HelpPage } = await import("@/app/help/page");
const { default: TicketPage } = await import("@/app/help/[id]/page");

async function render(element: ReactElement) {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return (await new Response(stream).text()).replaceAll("<!-- -->", "");
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn();
type Call = [string, RequestInit & { headers: Record<string, string> }];
const calls = () => fetchMock.mock.calls as unknown as Call[];
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const ticketId = "5b1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a";
const customer = { object: "customer", id: "c1", email: "ada@example.com", name: "Ada Obi", email_verified: true, country: "NG", currency: "NGN", phone: null, phone_verified: false, created_at: "2026-10-01T00:00:00.000Z", two_step: { object: "two_step_state", pending: false, setup_required: false, method: "email", method_not_allowed: false } };

function answer(routes: Record<string, unknown>) {
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const path = url.replace("http://api.test", "");
    const key = `${init.method ?? "GET"} ${path}`;
    const found = key in routes ? routes[key] : path in routes ? routes[path] : undefined;
    if (found instanceof Response) return found;
    return found === undefined ? json({ error: { code: "resource_missing", message: "Not found." } }, 404) : json(found);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  redirect.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_URL", "http://api.test");
  vi.stubEnv("AFRIPPA_SERVER_SECRET", "afrippa-site-secret-afrippa-site-secret-ab");
  setRequest({ "x-real-ip": "203.0.113.7" }, { afr_session: "bcc_token" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("help", () => {
  test("asking Afrippa's team: the title, what it is about and the message, once (the form's nonce), then the thread", async () => {
    answer({ "POST /v1/afrippa/account/support/tickets": { object: "support_ticket", id: ticketId } });
    expect((await help.openTicket({}, form({ subject: "Hi", message: "Help me" }))).field).toBe("subject");
    await expect(help.openTicket({}, form({ subject: "My order is stuck", category: "order", message: "The seller has not released.", nonce: "nonce-12345678" }))).rejects.toThrow(`redirect:/help/${ticketId}`);
    const [url, init] = calls()[0];
    expect(url).toBe("http://api.test/v1/afrippa/account/support/tickets");
    expect(JSON.parse(String(init.body))).toEqual({ subject: "My order is stuck", category: "order", message: "The seller has not released." });
    expect(init.headers["idempotency-key"]).toBe("nonce-12345678");
  });

  test("the list says whose turn it is; a ticket shows Afrippa's answers as Afrippa, with reply and close", async () => {
    answer({
      "/v1/afrippa/account": customer,
      "/v1/afrippa/account/support/tickets": { object: "list", data: [{ id: ticketId, reference: "T-000012", status: "pending", subject: "My order is stuck", updated_at: "2026-10-28T10:00:00.000Z" }] },
      [`/v1/afrippa/account/support/tickets/${ticketId}`]: {
        id: ticketId,
        reference: "T-000012",
        status: "pending",
        subject: "My order is stuck",
        messages: [
          { id: "m1", author: "customer", body: "The seller has not released.", created_at: "2026-10-28T09:00:00.000Z" },
          { id: "m2", author: "afrippa", body: "We are looking at it.", created_at: "2026-10-28T10:00:00.000Z" },
        ],
      },
    });
    const list = await render(await HelpPage());
    expect(list).toContain("Afrippa replied");
    expect(list).toContain(`href="/help/${ticketId}"`);
    expect(list).toContain("Ask Afrippa");
    const page = await render(await TicketPage({ params: Promise.resolve({ id: ticketId }) }));
    expect(page).toContain("Afrippa ·");
    expect(page).toContain("We are looking at it.");
    expect(page).toContain("close it");
  });

  test("replying and closing go to the ticket's routes; a lost session signs in again", async () => {
    answer({ [`POST /v1/afrippa/account/support/tickets/${ticketId}/messages`]: { id: ticketId }, [`POST /v1/afrippa/account/support/tickets/${ticketId}/close`]: { id: ticketId } });
    expect(await help.replyToTicket({}, form({ id: ticketId, body: "Thanks" }))).toEqual({ notice: "Sent." });
    await help.closeTicket(form({ id: ticketId }));
    expect(calls().map(call => call[0])).toEqual([`http://api.test/v1/afrippa/account/support/tickets/${ticketId}/messages`, `http://api.test/v1/afrippa/account/support/tickets/${ticketId}/close`]);
    answer({ [`POST /v1/afrippa/account/support/tickets/${ticketId}/messages`]: json({ error: { code: "authentication_required", message: "Sign in." } }, 401) });
    await expect(help.replyToTicket({}, form({ id: ticketId, body: "Thanks" }))).rejects.toThrow(`redirect:/signin?next=%2Fhelp%2F${ticketId}`);
  });
});
