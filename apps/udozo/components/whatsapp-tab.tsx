"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, LogIn, MessageCircle, UserPlus } from "lucide-react";
import { continueWithWhatsapp } from "@/lib/whatsapp-sign-in-actions";
import { Dropdown } from "./dropdown";
import { WhatsappMark, whatsappGreen } from "./whatsapp-mark";

/** Udozo's number with the first message filled in: the menu answers "Hi". */
export const startChatHref = (number: string) => `https://wa.me/${number.replace(/\D/g, "")}?text=${encodeURIComponent("Hi")}`;

/**
 * The WhatsApp tab hanging from under the header (WhatsApp's green), where Udozo is on WhatsApp in the market shown:
 * pulled down, it starts a chat with Udozo's number, and signed out signs up or in with WhatsApp (`continueWithWhatsapp`,
 * coming back to this page); signed in, it connects their WhatsApp. A `Dropdown`, so it closes on a click outside,
 * Escape or choosing a link.
 */
export function WhatsappTab({ number, signedIn }: { number: string; signedIn: boolean }) {
  const path = usePathname() || "/";
  const next = path.startsWith("/signin") || path.startsWith("/signup") ? "/" : path;
  const row = "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left font-semibold text-navy-900 hover:bg-navy-50";
  return (
    <div data-whatsapp-tab className="pointer-events-none absolute inset-x-0 top-full">
      <div className="mx-auto flex max-w-[1400px] px-4 sm:px-6 lg:px-8">
        <Dropdown className="group pointer-events-auto relative lg:ml-[176px]">
          <summary
            className="-mt-px inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-b-xl px-3.5 text-sm font-bold text-[#06361c] shadow-[0_6px_14px_rgba(6,54,28,0.18)] hover:brightness-95 [&::-webkit-details-marker]:hidden"
            style={{ background: whatsappGreen }}
            aria-label="Udozo on WhatsApp"
          >
            <WhatsappMark className="size-4" />
            WhatsApp
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
          </summary>
          <div className="menu-drop absolute top-full left-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-navy-200 bg-white text-[15px] shadow-lg">
            <p className="px-4 py-3 text-sm font-semibold text-[#06361c]" style={{ background: whatsappGreen }}>
              Udozo on WhatsApp: find, sell and chat without the app.
            </p>
            <div className="grid gap-0.5 p-2">
              <a href={startChatHref(number)} target="_blank" rel="noopener noreferrer" className={row}>
                <MessageCircle className="size-5 shrink-0 text-[#128C7E]" aria-hidden="true" /> Start a chat with Udozo
              </a>
              {signedIn ? (
                <Link href="/account/profile/whatsapp" className={row}>
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
            </div>
          </div>
        </Dropdown>
      </div>
    </div>
  );
}
