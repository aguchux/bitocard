import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { request, setRequest } from "./request";
import { assistantFor, assistantHeaders } from "@/lib/assistant";
import { rateAnswer, reportAnswer, startConversation, talkToPerson } from "@/lib/assistant-actions";
import { POST as ask } from "@/app/api/assistant/[thread]/messages/route";

type Call = { url: string; method: string; headers: Headers; body: unknown };
let calls: Call[];
let reply: (url: string, method: string) => Response | null;
const thread = "6f1c2e8a-1b2c-4d3e-8f90-1234567890ab";
const visitor = `bav_${"a".repeat(43)}`;

beforeEach(() => {
  vi.stubEnv("API_URL", "https://api.test");
  setRequest({ host: "shop.bitocard.com" });
  calls = [];
  reply = () => null;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : null });
    return reply(url, method) ?? Response.json({ error: { code: "resource_missing", message: "No such thing." } }, { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("who is asking", () => {
  test("a signed-in customer by their session; a visitor by their token; never both", async () => {
    setRequest({}, { udz_customer: "bcc_token", udz_assistant: visitor });
    expect(await assistantHeaders()).toEqual({ "bitocard-customer-session": "bcc_token" });
    setRequest({}, { udz_assistant: visitor });
    expect(await assistantHeaders()).toEqual({ "bitocard-assistant-visitor": visitor });
    setRequest({}, { udz_assistant: "bav_short" });
    expect(await assistantHeaders()).toEqual({});
  });

  test("a visitor's first conversation keeps the token in this site's own cookie, never handed to the page", async () => {
    reply = () => Response.json({ object: "assistant_thread", id: thread, visitor_token: visitor, messages: [] }, { status: 201 });
    const started = await startConversation("ng", "en", "browse");
    expect(started.ok && "visitor_token" in started.data).toBe(false);
    expect(request.set).toEqual([{ name: "udz_assistant", value: visitor, options: expect.objectContaining({ httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30 }) }]);
    expect(calls[0]!.body).toEqual({ country: "NG", surface: "browse", language: "en" });
    expect((await startConversation("ng", null, "browse", "not-an-id")).ok).toBe(false);
  });

  test("the country's assistant, or null where none answers", async () => {
    reply = () => Response.json({ object: "shop_assistant", assistant: null, languages: [] });
    expect(await assistantFor("NG")).toBeNull();
    reply = () => Response.json({ object: "shop_assistant", assistant: { name: "Anjio" }, languages: [] });
    expect((await assistantFor("NG", "yo"))?.assistant?.name).toBe("Anjio");
    expect(calls.at(-1)!.url).toBe("https://api.test/v1/classifieds/assistant?country=NG&language=yo");
  });

  test("ratings, reports and Talk to a person check what they send", async () => {
    reply = () => Response.json({ object: "ok", chat_id: "c1", rating: 1 });
    expect((await rateAnswer("nope", "up")).ok).toBe(false);
    expect((await reportAnswer(thread, "x")).ok).toBe(false);
    await rateAnswer(thread, "down");
    await reportAnswer(thread, "Linked somewhere odd");
    await talkToPerson(thread);
    expect(calls.map(call => [call.url.replace("https://api.test", ""), call.body])).toEqual([
      [`/v1/classifieds/assistant/messages/${thread}/rating`, { rating: "down" }],
      [`/v1/classifieds/assistant/messages/${thread}/report`, { reason: "Linked somewhere odd" }],
      [`/v1/classifieds/assistant/threads/${thread}/human`, {}],
    ]);
  });
});

describe("streamed answers", () => {
  const post = (body: unknown, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) => ask(new Request(`https://shop.bitocard.com/api/assistant/${thread}/messages`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), { params: Promise.resolve({ thread }) });

  test("passed through from the API with the shopper's identity; only from this site's own pages", async () => {
    setRequest({}, { udz_assistant: visitor });
    reply = () => new Response("event: message\ndata: {\"id\":\"m1\"}\n\n", { headers: { "content-type": "text/event-stream" } });
    const res = await post({ body: "Any phones?" });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await res.text()).toBe('event: message\ndata: {"id":"m1"}\n\n');
    expect(calls[0]!.headers.get("accept")).toBe("text/event-stream");
    expect(calls[0]!.headers.get("bitocard-assistant-visitor")).toBe(visitor);
    expect(calls[0]!.body).toEqual({ body: "Any phones?" });
    expect((await post({ body: "Hi" }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post({ body: "  " })).status).toBe(400);
  });

  test("a refusal before streaming comes back as the API's error", async () => {
    reply = () => Response.json({ error: { code: "assistant_limit_reached", message: "Try again tomorrow." } }, { status: 429 });
    const res = await post({ body: "Hi" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: "assistant_limit_reached", message: "Try again tomorrow." } });
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    expect((await post({ body: "Hi" })).status).toBe(503);
  });
});
