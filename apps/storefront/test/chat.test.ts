import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { request, setRequest } from "./request";
import { answeringPerson, chatAuthor, chatStatusLine } from "@/components/app/chat-widget";
import { initials, startsRun } from "@bitocard/ui/chat";

const { askForPerson, endChat, loadChat, pollChat, sendChatMessage, startChat } = await import("@/lib/chat-actions");
const { POST: uploadFile } = await import("@/app/api/chat/attachments/route");
const { GET: readFile } = await import("@/app/api/chat/files/[chat]/[file]/route");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const id = "0b7c2a1e-4d5f-4a6b-8c9d-0e1f2a3b4c5d";
const after = "1c8d3b2f-5e6a-4b7c-9d0e-1f2a3b4c5d6e";
const token = `bcv_${"a".repeat(43)}`;
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  setRequest({ host: "acme.bitocard.com" }, { bc_customer: "bcc_session" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("chat labels", () => {
  test("the person who answered by name, an assistant by its name; say whose turn it is", () => {
    expect(chatAuthor({ author: "reseller", author_name: "Ada Obi" }, "Acme")).toBe("Ada Obi");
    expect(chatAuthor({ author: "reseller", author_name: null }, "Acme")).toBe("Acme");
    expect(chatAuthor({ author: "bitocard", author_name: "Tunde" }, "BitoCard")).toBe("Tunde");
    expect(chatAuthor({ author: "bot", author_name: "Kemi" }, "Acme")).toBe("Kemi (assistant)");
    expect(chatAuthor({ author: "customer", author_name: "Chidi" }, "Acme")).toBe("You");
    expect(chatStatusLine("waiting", "Acme")).toMatch(/Waiting for Acme/);
    expect(chatStatusLine("with_staff", "Acme", "Ada Obi")).toBe("Ada Obi from Acme is chatting with you.");
    expect(chatStatusLine(null, "Acme")).toMatch(/Never send codes/);
    expect(answeringPerson([{ author: "reseller", author_name: "Ada" }, { author: "customer", author_name: "Chidi" }, { author: "reseller", author_name: "Bola" }])).toBe("Bola");
    expect(answeringPerson([{ author: "bot", author_name: "Kemi" }])).toBeNull();
  });

  test("avatars use initials, and a run of messages shows its avatar once", () => {
    expect([initials("Ada Obi"), initials("bitocard"), initials("  "), initials("Ngozi Ada Eze")]).toEqual(["AO", "B", "?", "NE"]);
    const at = (minute: number) => `2026-10-19T10:${String(minute).padStart(2, "0")}:00.000Z`;
    const messages = [
      { id: "1", author: "customer", author_name: "Chidi", created_at: at(0) },
      { id: "2", author: "customer", author_name: "Chidi", created_at: at(1) },
      { id: "3", author: "reseller", author_name: "Ada", created_at: at(2) },
      { id: "4", author: "reseller", author_name: "Bola", created_at: at(3) },
      { id: "5", author: "reseller", author_name: "Bola", created_at: at(12) },
    ];
    expect(messages.map((_, index) => startsRun(messages, index))).toEqual([true, false, true, true, true]);
  });
});

describe("chat actions", () => {
  test("a customer sends with their session and store; an empty message is never sent", async () => {
    const fetch = vi.fn(async () => reply({ object: "support_chat", id, status: "waiting", messages: [] }, 201));
    vi.stubGlobal("fetch", fetch);
    expect(await sendChatMessage("  Hello  ", "customer")).toMatchObject({ ok: true, chat: { id } });
    const [[url, init]] = fetch.mock.calls as unknown as Call[];
    expect([url, init.method, JSON.parse(String(init.body))]).toEqual(["http://api.test/v1/store/support/chat/messages", "POST", { body: "Hello" }]);
    expect([init.headers["bitocard-customer-session"], init.headers["bitocard-store"]]).toEqual(["bcc_session", "acme"]);
    expect(await sendChatMessage("   ", "customer")).toEqual({ ok: false, error: "Write a message first." });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("polling asks for messages after the last one; bad ids are refused before calling", async () => {
    const fetch = vi.fn(async () => reply({ status: "with_staff", data: [{ id: "m", author: "reseller", author_name: "Ada", body: "Hi", attachments: [], created_at: "2026-10-19T10:00:00.000Z" }] }));
    vi.stubGlobal("fetch", fetch);
    expect(await pollChat(id, after, "customer")).toMatchObject({ ok: true, status: "with_staff" });
    expect((fetch.mock.calls as unknown as Call[])[0][0]).toBe(`http://api.test/v1/store/support/chat/${id}/messages?after=${after}`);
    expect(await pollChat("nope", null, "customer")).toEqual({ ok: false, error: "This chat was not found." });
    expect(await pollChat(id, null, "admin" as never)).toEqual({ ok: false, error: "This chat was not found." });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("loading reads the customer's chat; an ended session falls back to the visitor chat; ending closes it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ object: "support_chat_current", chat: null, assistant: { name: "Kemi", avatar_url: null, greeting: "Hi!" } })));
    expect(await loadChat()).toEqual({ ok: true, chat: null, assistant: { name: "Kemi", avatar_url: null, greeting: "Hi!" }, identity: "customer", visitor: null });
    const fallback = vi.fn(async (url: string) => (url.includes("visitor-chat") ? reply({ object: "support_chat_current", chat: null, assistant: null, visitor: null }) : reply({ error: { code: "unauthenticated", message: "Sign in" } }, 401)));
    vi.stubGlobal("fetch", fallback);
    expect(await loadChat()).toEqual({ ok: true, chat: null, assistant: null, identity: null, visitor: null });
    const fetch = vi.fn(async () => reply({ object: "support_chat", id, status: "closed", messages: [] }));
    vi.stubGlobal("fetch", fetch);
    expect(await endChat(id, "customer")).toEqual({ ok: true, chat: null });
    expect((fetch.mock.calls as unknown as Call[])[0][0]).toBe(`http://api.test/v1/store/support/chat/${id}/close`);
  });

  test("asking for a person posts to the chat and shows it waiting", async () => {
    const fetch = vi.fn(async () => reply({ object: "support_chat", id, status: "waiting", messages: [] }));
    vi.stubGlobal("fetch", fetch);
    expect(await askForPerson(id, "customer")).toMatchObject({ ok: true, chat: { status: "waiting" } });
    expect((fetch.mock.calls as unknown as Call[])[0][0]).toBe(`http://api.test/v1/store/support/chat/${id}/human`);
  });
});

describe("visitors", () => {
  test("a visitor starts with name and email; the token is kept in this store's own httpOnly cookie and sent after", async () => {
    setRequest({ host: "acme.bitocard.com" });
    expect(await startChat({ name: "Ngozi", email: "not-an-email", body: "Hi" })).toMatchObject({ ok: false });
    expect(await startChat({ name: "", email: "n@example.com", body: "Hi" })).toEqual({ ok: false, error: "Tell us your name." });
    const fetch = vi.fn(async () => reply({ object: "support_visitor_chat", token, visitor: { name: "Ngozi", email: "n@example.com" }, chat: { object: "support_chat", id, status: "waiting", messages: [] } }, 201));
    vi.stubGlobal("fetch", fetch);
    expect(await startChat({ name: " Ngozi ", email: "n@example.com", body: "Do you sell Steam?" })).toMatchObject({ ok: true, visitor: { name: "Ngozi" } });
    const [[url, init]] = fetch.mock.calls as unknown as Call[];
    expect([url, JSON.parse(String(init.body))]).toEqual(["http://api.test/v1/store/support/visitor-chat", { name: "Ngozi", email: "n@example.com", body: "Do you sell Steam?" }]);
    expect(init.headers["bitocard-customer-session"]).toBeUndefined();
    expect(request.set).toEqual([{ name: "bc_chat", value: token, options: expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }) }]);

    const send = vi.fn(async () => reply({ object: "support_chat", id, status: "waiting", messages: [] }, 201));
    vi.stubGlobal("fetch", send);
    await sendChatMessage("Hello again", "visitor");
    const [[sentTo, sent]] = send.mock.calls as unknown as Call[];
    expect([sentTo, sent.headers["bitocard-chat-visitor"], sent.headers["bitocard-store"]]).toEqual(["http://api.test/v1/store/support/visitor-chat/messages", token, "acme"]);
  });

  test("a visitor whose token is unknown is asked to introduce themselves again", async () => {
    setRequest({ host: "acme.bitocard.com" }, { bc_chat: token });
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "visitor_unknown", message: "Tell us your name and email to chat." } }, 401)));
    expect(await sendChatMessage("Hi", "visitor")).toEqual({ ok: false, error: "Tell us your name and email to chat.", signIn: false, introduce: true });
  });
});

describe("chat files", () => {
  test("uploads are only from this site, passed on as multipart with the caption", async () => {
    const fetch = vi.fn(async () => reply({ object: "support_chat", id, status: "waiting", messages: [] }, 201));
    vi.stubGlobal("fetch", fetch);
    const form = new FormData();
    form.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff])], "receipt.jpg", { type: "image/jpeg" }));
    form.set("body", "My receipt");
    form.set("as", "customer");
    const refused = await uploadFile(new Request("https://acme.bitocard.com/api/chat/attachments", { method: "POST", body: form, headers: { "sec-fetch-site": "cross-site" } }));
    expect(refused.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    const sent = await uploadFile(new Request("https://acme.bitocard.com/api/chat/attachments", { method: "POST", body: form, headers: { "sec-fetch-site": "same-origin" } }));
    expect(sent.status).toBe(200);
    const [[url, init]] = fetch.mock.calls as unknown as Call[];
    expect(url).toBe("http://api.test/v1/store/support/chat/attachments");
    const forwarded = init.body as FormData;
    expect([forwarded.get("body"), (forwarded.get("file") as File).name, init.headers["bitocard-customer-session"], init.headers["content-type"]]).toEqual(["My receipt", "receipt.jpg", "bcc_session", undefined]);
  });

  test("files are read through the API as the shopper, never cached, sandboxed", async () => {
    const file = "2d9e4c3a-6f7b-4c8d-9e0f-1a2b3c4d5e6f";
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }));
    vi.stubGlobal("fetch", fetch);
    const res = await readFile(new Request(`https://acme.bitocard.com/api/chat/files/${id}/${file}?as=customer`), { params: Promise.resolve({ chat: id, file }) });
    expect([res.status, res.headers.get("content-type"), res.headers.get("cache-control")]).toEqual([200, "image/jpeg", "no-store, private"]);
    expect(res.headers.get("content-security-policy")).toMatch(/sandbox/);
    expect((fetch.mock.calls as unknown as Call[])[0][0]).toBe(`http://api.test/v1/store/support/chat/${id}/files/${file}`);
    expect((await readFile(new Request("https://acme.bitocard.com/api/chat/files/x/y"), { params: Promise.resolve({ chat: "x", file: "y" }) })).status).toBe(404);
  });
});
