"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { HelpCircle, LogIn, Megaphone, MessageCircle, Search, ShieldCheck, Sparkles, Tag, UserPlus, X } from "lucide-react";
import { continueWithWhatsapp } from "@/lib/whatsapp-sign-in-actions";
import { useDismiss } from "./dropdown";
import { WhatsappMark, whatsappGreen } from "./whatsapp-mark";

/** Udozo's number with a message filled in (the menu answers "Hi"; the bot also takes FIND, SELL, WANT, HELP…). */
export const whatsappWith = (number: string, text: string) => `https://wa.me/${number.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
export const startChatHref = (number: string) => whatsappWith(number, "Hi");

/** What Udozo does on WhatsApp, each opening the chat with the word that starts it. */
export const whatsappFeatures = [
  { word: "FIND", title: "Find something", detail: "Send what you are looking for and tap a listing to see its photo, price and place.", icon: Search },
  { word: "SELL", title: "Sell something", detail: "Post an ad step by step: title, category, price, place and photos, all in the chat.", icon: Tag },
  { word: "WANT", title: "Post a request", detail: "Say what you need and sellers with a match answer you with their listing.", icon: Megaphone },
  { word: "CHATS", title: "Chat with sellers", detail: "Messages go through Udozo, so nobody sees your number. Reply to a message to answer it.", icon: MessageCircle },
  { word: "Hi", title: "Ask Udozo's assistant", detail: "Questions about buying, selling, prices and staying safe, answered by AI where it is on. It can make mistakes.", icon: Sparkles },
  { word: "HELP", title: "Help", detail: "MENU shows the menu, CANCEL stops what you are doing, STOP means no more messages.", icon: HelpCircle },
] as const;

/**
 * The WhatsApp tab standing on the right edge of every udozo.com page where Udozo is on WhatsApp in the market shown:
 * a thin green line runs down the edge, with the tab (written upwards) on it. Clicked, a flyout slides in from the right
 * with the WhatsApp menu: start a chat, sign up or in with WhatsApp (`continueWithWhatsapp`, back to this page) or, signed
 * in, connect their WhatsApp; then what Udozo does on WhatsApp, each opening the chat with its word. It closes on Escape,
 * a click outside or its close button, and is kept out of the tab order and screen readers while closed (`inert`).
 */
export function WhatsappTab({ number, signedIn }: { number: string; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const tab = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  useDismiss(area, open, close, () => tab.current);
  const path = usePathname() || "/";
  const next = path.startsWith("/signin") || path.startsWith("/signup") ? "/" : path;
  const row = "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left font-semibold text-navy-900 hover:bg-navy-50";
  return (
    <div data-whatsapp-tab ref={area}>
      {/* The peep line: WhatsApp's green down the right edge, from which the tab and the flyout come. */}
      <span aria-hidden="true" className="pointer-events-none fixed inset-y-0 right-0 z-30 w-1" style={{ background: whatsappGreen }} />
      <button
        ref={tab}
        type="button"
        aria-expanded={open}
        aria-controls="whatsapp-flyout"
        onClick={() => setOpen(value => !value)}
        className={`fixed top-1/2 right-1 z-30 flex -translate-y-1/2 flex-col items-center gap-2 rounded-l-xl px-2 py-3.5 text-sm font-bold text-[#06361c] shadow-[-4px_4px_14px_rgba(6,54,28,0.22)] transition-opacity hover:brightness-95 motion-reduce:transition-none ${open ? "pointer-events-none opacity-0" : ""}`}
        style={{ background: whatsappGreen }}
      >
        <WhatsappMark className="size-4.5" />
        <span className="rotate-180 tracking-wide [writing-mode:vertical-rl]">WhatsApp</span>
      </button>

      <div
        id="whatsapp-flyout"
        role="dialog"
        aria-label="Udozo on WhatsApp"
        inert={!open}
        className={`fixed inset-y-0 right-0 z-40 flex w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col border-l-4 bg-white shadow-[-12px_0_32px_rgba(16,33,46,0.18)] transition-[transform,visibility] duration-200 ease-out motion-reduce:transition-none ${open ? "visible translate-x-0" : "invisible translate-x-full"}`}
        style={{ borderColor: whatsappGreen }}
      >
        <header className="flex items-start gap-3 p-4 text-[#06361c]" style={{ background: whatsappGreen }}>
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/90">
            <WhatsappMark className="size-6" color="#128C7E" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg leading-tight font-extrabold">Udozo on WhatsApp</h2>
            <p className="text-sm font-medium">Find, sell and chat without the app.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              close();
              tab.current?.focus();
            }}
            aria-label="Close"
            className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-black/10"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="grid flex-1 content-start gap-4 overflow-y-auto p-3">
          <nav aria-label="WhatsApp" className="grid gap-0.5">
            <a href={startChatHref(number)} target="_blank" rel="noopener noreferrer" className={row}>
              <MessageCircle className="size-5 shrink-0 text-[#128C7E]" aria-hidden="true" /> Start a chat with Udozo
            </a>
            {signedIn ? (
              <Link href="/account/profile/whatsapp" onClick={close} className={row}>
                <WhatsappMark className="size-5 shrink-0" color="#128C7E" /> Connect your WhatsApp
              </Link>
            ) : (
              <>
                <form action={continueWithWhatsapp}>
                  <input type="hidden" name="intent" value="signup" />
                  <input type="hidden" name="next" value={next} />
                  <button type="submit" className={row}>
                    <UserPlus className="size-5 shrink-0 text-[#128C7E]" aria-hidden="true" /> Sign up with WhatsApp
                  </button>
                </form>
                <form action={continueWithWhatsapp}>
                  <input type="hidden" name="intent" value="signin" />
                  <input type="hidden" name="next" value={next} />
                  <button type="submit" className={row}>
                    <LogIn className="size-5 shrink-0 text-[#128C7E]" aria-hidden="true" /> Sign in with WhatsApp
                  </button>
                </form>
              </>
            )}
          </nav>

          <section aria-labelledby="whatsapp-features" className="grid gap-1 border-t border-navy-100 pt-3">
            <h3 id="whatsapp-features" className="px-3 text-xs font-bold tracking-wide text-navy-500 uppercase">
              What you can do there
            </h3>
            <ul className="grid gap-0.5">
              {whatsappFeatures.map(feature => (
                <li key={feature.title}>
                  <a href={whatsappWith(number, feature.word)} target="_blank" rel="noopener noreferrer" className="flex gap-3 rounded-xl p-3 hover:bg-navy-50">
                    <feature.icon className="mt-0.5 size-5 shrink-0 text-[#128C7E]" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block font-semibold text-navy-900">
                        {feature.title} <span className="ml-1 rounded bg-navy-50 px-1.5 py-0.5 font-mono text-xs text-navy-700">{feature.word}</span>
                      </span>
                      <span className="block text-sm text-navy-600">{feature.detail}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <p className="flex gap-2 rounded-xl bg-navy-50 p-3 text-sm text-navy-700">
            <ShieldCheck className="mt-0.5 size-4.5 shrink-0 text-[#128C7E]" aria-hidden="true" />
            <span>Udozo never asks for your codes or passwords on WhatsApp. See the item before you pay, or use Safe pay on udozo.com.</span>
          </p>
        </div>
      </div>
    </div>
  );
}
