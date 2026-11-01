"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, LoaderCircle, MessageCircle, PhoneCall, X } from "lucide-react";
import { listingPath, nameInitials, type ShopChat, type ShopConversation } from "@bitocard/api-client/classifieds";
import { listChats, loadChat } from "@/lib/shop-actions";
import { ChatThread } from "./account/chat-thread";
import { useCalls } from "./calls/call-provider";

/** How often the chats are read: who wrote, who is online. */
const listMs = 10_000;
const hiddenListMs = 30_000;

/** The chat to open first: the latest with something unread, else the latest. */
export function firstChat(chats: Pick<ShopConversation, "id" | "unread">[]) {
  return (chats.find(chat => chat.unread > 0) ?? chats[0])?.id ?? null;
}

/** Whether a call can be made from a chat now, and if not, why (the call button's title). */
export function callState(chat: Pick<ShopConversation, "can_call" | "with">, calls: { available: boolean; busy: boolean } | null) {
  if (!calls || !calls.available || !chat.can_call) return { show: false, ready: false, title: "" };
  if (calls.busy) return { show: true, ready: false, title: "You are already in a call" };
  if (!chat.with.online) return { show: true, ready: false, title: `${chat.with.name} is not on Udozo right now` };
  return { show: true, ready: true, title: `Call ${chat.with.name} privately on Udozo: no numbers shared` };
}

function Avatar({ name, online, size = "size-9" }: { name: string; online?: boolean; size?: string }) {
  return (
    <span className="relative shrink-0" aria-hidden="true">
      <span className={`grid ${size} place-items-center rounded-full bg-navy-900 text-[12px] font-bold text-white`}>{nameInitials(name)}</span>
      <span className={`absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-white ${online ? "bg-mint-500" : "bg-slate-300"}`} />
    </span>
  );
}

/**
 * Chats on every page of a signed-in customer on udozo.com who has any: a button bottom right (badged with what is
 * unread) opens a panel flying in from the right at full height (pulled up from the bottom across the screen on phones),
 * one tab per conversation sliding sideways, each with the other person's initials and whether they are on Udozo now.
 * The open tab is the chat itself, with a call button where a call can be made. Never on the Messages pages, which are
 * the chats already.
 */
export function ChatDock() {
  const calls = useCalls();
  const path = usePathname();
  const [chats, setChats] = useState<ShopConversation[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [thread, setThread] = useState<ShopChat | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    const result = await listChats();
    if (result.ok) setChats(result.data.data);
    return result.ok || !result.signIn;
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      const carryOn = await refresh();
      if (stopped || !carryOn) return;
      timer = window.setTimeout(() => void tick(), document.visibilityState === "visible" ? listMs : hiddenListMs);
    };
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [refresh]);

  // The chosen tab's chat, read in full (which marks it read).
  useEffect(() => {
    if (!open || !active) return;
    let current = true;
    // The tab shows its own chat once read (`thread.id`), or why it could not be (`error.id`).
    void loadChat(active).then(result => {
      if (!current) return;
      if (result.ok) {
        setThread(result.data);
        setChats(list => list.map(chat => (chat.id === active ? { ...chat, unread: 0 } : chat)));
      } else setError({ id: active, message: result.message });
    });
    return () => {
      current = false;
    };
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    tabs.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      opener.current?.focus();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open]);

  if (!chats.length || path.startsWith("/account/messages")) return null;
  const unread = chats.reduce((sum, chat) => sum + chat.unread, 0);
  const chosen = chats.find(chat => chat.id === active) ?? null;
  const call = chosen ? callState(chosen, calls) : null;

  const show = () => {
    if (!active || !chats.some(chat => chat.id === active)) setActive(firstChat(chats));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };
  const step = (by: number) => {
    const index = chats.findIndex(chat => chat.id === active);
    const next = chats[(index + by + chats.length) % chats.length];
    if (next) setActive(next.id);
  };
  const buy = thread && thread.role === "buyer" && thread.listing.status === "active" && thread.listing.slug ? { path: `/${thread.listing.country.toLowerCase()}/l/${thread.listing.ref}/buy` } : null;

  return (
    <>
      {open ? null : (
        <button
          ref={opener}
          type="button"
          onClick={show}
          aria-label={unread ? `Chats: ${unread} unread` : "Chats"}
          className="fixed right-4 bottom-24 z-30 grid size-14 place-items-center rounded-full bg-navy-900 text-white shadow-[0_8px_24px_rgba(15,23,42,0.35)] hover:bg-navy-800 sm:right-6 sm:bottom-6"
        >
          <MessageCircle className="size-6" aria-hidden="true" />
          {unread ? <span className="absolute -top-1 -right-1 min-w-6 rounded-full bg-brand-500 px-1.5 py-0.5 text-center text-xs font-bold ring-2 ring-white">{unread > 99 ? "99+" : unread}</span> : null}
        </button>
      )}
      {open ? <div className="fixed inset-0 z-30 bg-navy-900/40 sm:hidden" onClick={close} aria-hidden="true" /> : null}
      <section
        aria-label="Chats"
        aria-hidden={!open}
        inert={!open}
        data-open={open ? "" : undefined}
        className={`fixed inset-x-0 bottom-0 z-40 flex h-[92dvh] flex-col rounded-t-3xl bg-white text-navy-900 shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none sm:inset-x-auto sm:top-0 sm:right-0 sm:h-dvh sm:w-[26rem] sm:rounded-none sm:rounded-l-3xl ${open ? "translate-y-0 sm:translate-x-0" : "translate-y-full sm:translate-x-full sm:translate-y-0"}`}
      >
        <span className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-slate-300 sm:hidden" aria-hidden="true" />
        <header className="flex items-center gap-2 px-4 pt-2 pb-1 sm:pt-4">
          <h2 className="flex-1 text-lg font-extrabold">Chats</h2>
          <Link href="/account/messages" className="text-sm font-semibold text-brand-700 hover:underline">
            All messages
          </Link>
          <button type="button" onClick={close} className="grid size-10 place-items-center rounded-full hover:bg-slate-100" aria-label="Close chats">
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex items-stretch border-b border-slate-200">
          <button type="button" onClick={() => tabs.current?.scrollBy({ left: -220, behavior: "smooth" })} className="hidden w-8 shrink-0 place-items-center text-slate-500 hover:text-navy-900 sm:grid" aria-label="Earlier chats">
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
          <div
            ref={tabs}
            role="tablist"
            aria-label="Conversations"
            onKeyDown={event => {
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                step(event.key === "ArrowRight" ? 1 : -1);
              }
            }}
            className="flex min-w-0 flex-1 snap-x gap-1 overflow-x-auto scroll-smooth px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {chats.map(chat => {
              const selected = chat.id === active;
              return (
                <button
                  key={chat.id}
                  type="button"
                  role="tab"
                  id={`chat-tab-${chat.id}`}
                  aria-selected={selected}
                  aria-controls="chat-dock-thread"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActive(chat.id)}
                  className={`flex max-w-44 shrink-0 snap-start items-center gap-2 border-b-2 px-2 py-2.5 text-left ${selected ? "border-brand-500" : "border-transparent hover:bg-slate-50"}`}
                >
                  <Avatar name={chat.with.name} online={chat.with.online} />
                  <span className="grid min-w-0">
                    <span className={`truncate text-sm ${chat.unread ? "font-extrabold" : "font-semibold"}`}>{chat.with.name}</span>
                    <span className="truncate text-xs text-slate-500">{chat.listing.title ?? "A listing"}</span>
                  </span>
                  {chat.unread ? <span className="rounded-full bg-brand-500 px-1.5 text-xs font-bold text-white">{chat.unread}</span> : null}
                  <span className="sr-only">{chat.with.online ? "Online" : "Offline"}</span>
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => tabs.current?.scrollBy({ left: 220, behavior: "smooth" })} className="hidden w-8 shrink-0 place-items-center text-slate-500 hover:text-navy-900 sm:grid" aria-label="Later chats">
            <ChevronRight className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div id="chat-dock-thread" role="tabpanel" aria-labelledby={active ? `chat-tab-${active}` : undefined} className="flex min-h-0 flex-1 flex-col gap-2 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {chosen ? (
            <div className="flex items-center gap-3">
              <Avatar name={chosen.with.name} online={chosen.with.online} size="size-10" />
              <span className="grid min-w-0 flex-1">
                <strong className="truncate">{chosen.with.name}</strong>
                <span className="flex items-center gap-1.5 text-xs text-slate-600">
                  <span className={chosen.with.online ? "text-mint-700" : ""}>{chosen.with.online ? "Online" : "Offline"}</span>
                  {chosen.listing.slug ? (
                    <Link href={listingPath(chosen.listing.country, chosen.listing.ref, chosen.listing.slug)} className="truncate hover:underline">
                      · {chosen.listing.title ?? "A listing"}
                    </Link>
                  ) : (
                    <span className="truncate">· {chosen.listing.title ?? "A listing"}</span>
                  )}
                </span>
              </span>
              {call?.show ? (
                <button
                  type="button"
                  onClick={() => calls?.start({ conversation_id: chosen.id })}
                  disabled={!call.ready}
                  title={call.title}
                  aria-label={`Call ${chosen.with.name}`}
                  className="grid size-10 shrink-0 place-items-center rounded-full bg-mint-700 text-white hover:bg-mint-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                >
                  <PhoneCall className="size-5" aria-hidden="true" />
                </button>
              ) : null}
              <Link href={`/account/messages/${chosen.id}`} className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-slate-100" aria-label="Open in Messages">
                <ExternalLink className="size-5" aria-hidden="true" />
              </Link>
            </div>
          ) : null}
          {thread && thread.id === active ? (
            <div className="min-h-0 flex-1">
              <ChatThread key={thread.id} initial={thread} buy={buy} fill />
            </div>
          ) : error?.id === active ? (
            <p className="text-sm text-brand-700" role="alert">
              {error.message}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-slate-600" role="status">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Opening the chat…
            </p>
          )}
        </div>
      </section>
    </>
  );
}
