"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Cookie } from "lucide-react";
import { consentChangedEvent, consentCookieValue, consentSettingsEvent, readConsent, type ConsentChoice } from "@/lib/cookie-consent";

const button = "inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-navy-900 bg-navy-900 px-4 text-sm font-semibold text-white hover:bg-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 sm:flex-none";

/** What the banner says, and its two equal choices (rejecting is as easy as accepting). */
export function CookieConsentBody({ noticeHref, current, onChoose }: { noticeHref: string; current: ConsentChoice | null; onChoose: (choice: ConsentChoice) => void }) {
  return (
    <section aria-labelledby="cookie-consent-heading" className="fixed inset-x-0 bottom-0 z-[60] border-t border-navy-200 bg-white shadow-[0_-8px_24px_rgba(15,23,42,0.12)]">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:gap-6 lg:px-8">
        <Cookie className="hidden size-7 shrink-0 text-brand-600 lg:block" aria-hidden="true" />
        <div className="grid gap-1 text-sm text-navy-700">
          <h2 id="cookie-consent-heading" className="font-bold text-navy-900">
            Cookies on Udozo
          </h2>
          <p>
            We use cookies that are needed to sign you in and keep Udozo safe. If you agree, we also use one optional cookie to remember what you look at on udozo.com, so we can show you listings you are likely to want. Never for advertising.{" "}
            <a href={noticeHref} className="font-semibold text-navy-900 underline">
              Read the cookie notice
            </a>
          </p>
          {current ? <p className="text-xs text-navy-500">You chose {current === "all" ? "Accept all" : "Necessary only"}. You can change it here at any time.</p> : null}
        </div>
        <div className="flex shrink-0 gap-2 lg:ml-auto">
          <button type="button" className={button} onClick={() => onChoose("necessary")}>
            Necessary only
          </button>
          <button type="button" className={button} onClick={() => onChoose("all")}>
            Accept all
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * The cookie banner on every page of Udozo's sites (udozo.com and resellers' stores): shown until the visitor chooses,
 * and again when a footer's Cookie settings asks. Drawn only in the browser, so cached pages never carry it.
 */
export function CookieConsent({ noticeHref }: { noticeHref: string }) {
  // The saved choice, "none" before one is made, "server" while rendering on the server (nothing is drawn there).
  const saved = useSyncExternalStore<ConsentChoice | "none" | "server">(subscribe, () => readConsent(document.cookie)?.choice ?? "none", () => "server");
  const [reopened, setReopened] = useState(false);

  useEffect(() => {
    const reopen = () => setReopened(true);
    window.addEventListener(consentSettingsEvent, reopen);
    return () => window.removeEventListener(consentSettingsEvent, reopen);
  }, []);

  if (saved === "server" || (saved !== "none" && !reopened)) return null;
  const choose = (choice: ConsentChoice) => {
    document.cookie = consentCookieValue(choice, new Date(), location.protocol === "https:");
    setReopened(false);
    window.dispatchEvent(new CustomEvent(consentChangedEvent, { detail: choice }));
  };
  return <CookieConsentBody noticeHref={noticeHref} current={saved === "none" ? null : saved} onChoose={choose} />;
}

/** Re-reads the saved choice whenever one is made, in this tab. */
function subscribe(changed: () => void) {
  window.addEventListener(consentChangedEvent, changed);
  return () => window.removeEventListener(consentChangedEvent, changed);
}

/** The footers' Cookie settings: opens the banner again. */
export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button type="button" className={className ?? "cursor-pointer hover:underline"} onClick={() => window.dispatchEvent(new Event(consentSettingsEvent))}>
      Cookie settings
    </button>
  );
}
