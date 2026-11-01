// @vitest-environment jsdom
// The chat dock on every page of a signed-in customer: a button bottom right with what is unread, a panel of tabs, one
// per conversation, each with who is online, and the open tab's chat with a call button where a call can be made.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ShopChat, ShopConversation } from "@bitocard/api-client/classifieds";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nav = { path: "/ng" };
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => createElement("a", { href, ...rest }, children) }));

const conversation = (id: string, over: Partial<ShopConversation> = {}): ShopConversation => ({
  object: "classified_conversation",
  id,
  role: "buyer",
  listing: { id: `l-${id}`, ref: 100, title: `TV ${id}`, slug: "tv", status: "active", country: "NG", price: { kind: "fixed", amount: 1000, currency: "NGN" } as never, cover_url: null },
  with: { name: `Seller ${id}`, online: false },
  last_message: null,
  unread: 0,
  open_offer: null,
  blocked: { by_me: false, by_them: false },
  can_call: true,
  last_message_at: "2026-11-01T10:00:00.000Z",
  created_at: "2026-11-01T09:00:00.000Z",
  ...over,
});

const state = { chats: [] as ShopConversation[] };
const actions = vi.hoisted(() => ({ listChats: vi.fn(), loadChat: vi.fn() }));
vi.mock("@/lib/shop-actions", () => ({
  listChats: actions.listChats,
  loadChat: actions.loadChat,
  answerOffer: vi.fn(),
  blockChat: vi.fn(),
  makeOffer: vi.fn(),
  reportChat: vi.fn(),
  sendMessage: vi.fn(),
  assistantSuggestion: vi.fn(),
}));

const { ChatDock, callState, firstChat } = await import("@/components/chat-dock");
const { CallProvider } = await import("@/components/calls/call-provider");

const unmounts: Array<() => void> = [];
beforeEach(() => {
  nav.path = "/ng";
  // jsdom lays nothing out.
  Element.prototype.scrollIntoView = () => undefined;
  actions.listChats.mockImplementation(async () => ({ ok: true, data: { data: state.chats, total: state.chats.length } }));
  actions.loadChat.mockImplementation(async (id: string) => ({ ok: true, data: { ...state.chats.find(chat => chat.id === id)!, messages: [], has_more: false } satisfies ShopChat }));
  // The call provider's presence check: calls are set up.
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ object: "classified_presence", calls: true, incoming: null })));
});
afterEach(() => {
  unmounts.splice(0).forEach(unmount => unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(CallProvider, null, createElement(ChatDock))));
  unmounts.push(() => act(() => root.unmount()));
  return host;
}

const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

describe("the chat dock", () => {
  test("nothing until the customer has a chat, and never on the Messages pages", async () => {
    state.chats = [];
    expect((await mount()).innerHTML).not.toContain('aria-label="Chats');
    state.chats = [conversation("a")];
    nav.path = "/account/messages/a";
    expect((await mount()).innerHTML).not.toContain('aria-label="Chats"');
  });

  test("the button shows what is unread and opens the panel on the latest unread chat, its tabs saying who is online", async () => {
    state.chats = [conversation("a", { with: { name: "Obi N.", online: true } }), conversation("b", { unread: 2 }), conversation("c", { unread: 1 })];
    await mount();
    const panel = document.querySelector<HTMLElement>('section[aria-label="Chats"]')!;
    expect(panel.hasAttribute("data-open")).toBe(false);
    expect(panel.getAttribute("aria-hidden")).toBe("true");
    await act(async () => button("Chats: 3 unread")!.click());
    expect(panel.hasAttribute("data-open")).toBe(true);
    expect(actions.loadChat).toHaveBeenCalledWith("b");
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map(tab => tab.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(tabs[0]!.textContent).toContain("Online");
    expect(tabs[1]!.textContent).toContain("Offline");
    expect(document.querySelector('section[aria-label="Chat with Seller b"]')).not.toBeNull();
    expect(tabs[1]!.textContent).not.toMatch(/2$/);

    await act(async () => tabs[0]!.click());
    expect(actions.loadChat).toHaveBeenLastCalledWith("a");
    expect(document.querySelector("#chat-dock-thread")?.textContent).toContain("Online");

    await act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(panel.hasAttribute("data-open")).toBe(false);
  });

  test("calls the other side from the chat when they are online; offline, it says why", async () => {
    state.chats = [conversation("a", { with: { name: "Obi N.", online: true }, unread: 1 }), conversation("b")];
    await mount();
    await act(async () => button("Chats: 1 unread")!.click());
    const call = button("Call Obi N.")!;
    expect(call.disabled).toBe(false);
    await act(async () => document.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!.click());
    const offline = button("Call Seller b")!;
    expect(offline.disabled).toBe(true);
    expect(offline.title).toBe("Seller b is not on Udozo right now");
  });

  test("the first chat and the call button's state", () => {
    expect(firstChat([{ id: "a", unread: 0 }, { id: "b", unread: 4 }])).toBe("b");
    expect(firstChat([{ id: "a", unread: 0 }])).toBe("a");
    expect(firstChat([])).toBeNull();
    const chat = { can_call: true, with: { name: "Obi N.", online: true } };
    expect(callState(chat, null).show).toBe(false);
    expect(callState({ ...chat, can_call: false }, { available: true, busy: false }).show).toBe(false);
    expect(callState(chat, { available: false, busy: false }).show).toBe(false);
    expect(callState(chat, { available: true, busy: true })).toMatchObject({ show: true, ready: false });
    expect(callState(chat, { available: true, busy: false })).toMatchObject({ show: true, ready: true });
  });
});
