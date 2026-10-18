import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";
import { chatAuthor, chatStatusLine } from "@/components/app/chat-widget";

const { endChat, loadChat, pollChat, sendChatMessage } = await import("@/lib/chat-actions");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const id = "0b7c2a1e-4d5f-4a6b-8c9d-0e1f2a3b4c5d";
const after = "1c8d3b2f-5e6a-4b7c-9d0e-1f2a3b4c5d6e";

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  setRequest({ host: "acme.bitocard.com" }, { bc_customer: "bcc_session" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("chat labels", () => {
  test("never name staff; an assistant by its name; say whose turn it is", () => {
    expect(chatAuthor({ author: "reseller", author_name: "Ada" }, "Acme")).toBe("Acme");
    expect(chatAuthor({ author: "bot", author_name: "Kemi" }, "Acme")).toBe("Kemi (assistant)");
    expect(chatAuthor({ author: "customer", author_name: "Chidi" }, "Acme")).toBe("You");
    expect(chatStatusLine("waiting", "Acme")).toMatch(/Waiting for Acme/);
    expect(chatStatusLine("with_staff", "Acme")).toBe("You are chatting with Acme.");
    expect(chatStatusLine(null, "Acme")).toMatch(/Never send codes/);
  });
});

describe("chat actions", () => {
  test("sending posts the message with the customer's session and store; an empty one is never sent", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ object: "support_chat", id, status: "waiting", messages: [] }), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    expect(await sendChatMessage("  Hello  ")).toMatchObject({ ok: true, chat: { id } });
    const [[url, init]] = fetch.mock.calls as unknown as Call[];
    expect([url, init.method, JSON.parse(String(init.body))]).toEqual(["http://api.test/v1/store/support/chat/messages", "POST", { body: "Hello" }]);
    expect([init.headers["bitocard-customer-session"], init.headers["bitocard-store"]]).toEqual(["bcc_session", "acme"]);
    expect(await sendChatMessage("   ")).toEqual({ ok: false, error: "Write a message first." });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("polling asks for messages after the last one; bad ids are refused before calling", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: "with_staff", data: [{ id: "m", author: "reseller", author_name: null, body: "Hi", created_at: "2026-10-19T10:00:00.000Z" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const polled = await pollChat(id, after);
    expect(polled).toMatchObject({ ok: true, status: "with_staff" });
    expect((fetch.mock.calls as unknown as Call[])[0][0]).toBe(`http://api.test/v1/store/support/chat/${id}/messages?after=${after}`);
    expect(await pollChat("nope", null)).toEqual({ ok: false, error: "This chat was not found." });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("loading reads the open chat; an ended session asks to sign in; ending closes it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ object: "support_chat_current", chat: null }), { status: 200 })));
    expect(await loadChat()).toEqual({ ok: true, chat: null });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { type: "authentication_error", code: "session_expired", message: "Sign in", request_id: "r" } }), { status: 401 })));
    expect(await loadChat()).toEqual({ ok: false, error: "Sign in", signIn: true });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ object: "support_chat", id, status: "closed", messages: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await endChat(id)).toEqual({ ok: true, chat: null });
    expect((fetch.mock.calls as unknown as Call[])[0][0]).toBe(`http://api.test/v1/store/support/chat/${id}/close`);
  });
});
