"use client";

import { useEffect, useRef, useState } from "react";
import { Share, SquarePlus, X } from "lucide-react";
import { installRoute, installStateKey, installVisitKey, installed, promptDelayMs, readInstallState, reminded, shouldRemind, type InstallState } from "@/lib/install";

/** Chrome's install event (not in TypeScript's DOM types). */
type InstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

declare global {
  interface Window {
    /** Kept by `installCaptureScript` (`lib/install.ts`) from the moment the page starts, before React runs. */
    __bcInstall?: InstallPromptEvent | null;
  }
  interface Navigator {
    /** Safari on iPhone and iPad: opened from the Home Screen. */
    standalone?: boolean;
  }
}

// Storage can be blocked (private windows, strict settings): the prompt then simply never shows.
function load(): InstallState {
  try {
    return readInstallState(localStorage.getItem(installStateKey));
  } catch {
    return readInstallState(null);
  }
}
function save(state: InstallState) {
  try {
    localStorage.setItem(installStateKey, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
function visitSeen() {
  try {
    return sessionStorage.getItem(installVisitKey) !== null;
  } catch {
    return true;
  }
}
function markVisit() {
  try {
    sessionStorage.setItem(installVisitKey, "1");
  } catch {}
}

const runningAsApp = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

/**
 * On every page: registers the service worker (`/sw.js`: installable, and its own page when the network is gone) and
 * remembers when the site is installed, so it is never asked again.
 */
export function InstallSupport() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    if (runningAsApp()) save(installed(load()));
    const done = () => save(installed(load()));
    window.addEventListener("appinstalled", done);
    return () => window.removeEventListener("appinstalled", done);
  }, []);
  return null;
}

/**
 * Asks the visitor to install BitoCard Shop as an app (the market's `install_prompt`): a flat dialog, from the bottom on
 * phones, after a few seconds on a visit; at most three times, on visits an hour apart (`lib/install.ts`). Where the
 * browser has its own install dialog it opens it; on iPhones and iPads it says how (Share, then Add to Home Screen).
 */
export function InstallPrompt({ enabled }: { enabled: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [route, setRoute] = useState<"prompt" | "ios" | null>(null);

  useEffect(() => {
    if (!enabled || runningAsApp() || visitSeen() || !shouldRemind(load(), Date.now())) return;
    const timer = window.setTimeout(() => {
      const how = installRoute({ hasPrompt: Boolean(window.__bcInstall), userAgent: navigator.userAgent, touchPoints: navigator.maxTouchPoints });
      // Nothing to offer on this browser: neither shown nor counted. Unsaved, it would ask on every visit: never shown.
      if (how === "none" || !save(reminded(load(), Date.now()))) return;
      markVisit();
      setRoute(how);
    }, promptDelayMs);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  useEffect(() => {
    if (route && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [route]);

  const close = () => dialog.current?.close();

  async function install() {
    const event = window.__bcInstall;
    if (!event) return close();
    window.__bcInstall = null;
    await event.prompt();
    const choice = await event.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    if (choice.outcome === "accepted") save(installed(load()));
    close();
  }

  if (!route) return null;
  return (
    <dialog
      ref={dialog}
      aria-labelledby="install-title"
      aria-describedby="install-text"
      className="sheet m-0 mt-auto w-full max-w-none rounded-none border-0 border-t-4 border-brand-700 bg-white p-0 text-navy-900 sm:m-auto sm:max-w-md"
      onClick={event => event.target === event.currentTarget && close()}
      onClose={() => setRoute(null)}
    >
      <InstallSheet route={route} onInstall={() => void install()} onClose={close} />
    </dialog>
  );
}

/** What the prompt says: flat, square corners, no shadow. `prompt` offers Install; `ios` shows the two steps. */
export function InstallSheet({ route, onInstall, onClose }: { route: "prompt" | "ios"; onInstall: () => void; onClose: () => void }) {
  return (
    // Focused when the dialog opens (not the close button, which would show its focus ring at once).
    <div tabIndex={-1} autoFocus className="grid gap-4 p-5 outline-none">
      <div className="flex items-start gap-3">
        <img src="/icon-192.png" alt="" width={48} height={48} className="size-12 shrink-0" />
        <div className="grid flex-1 gap-1">
          <h2 id="install-title" className="text-lg leading-tight font-extrabold">
            Install BitoCard Shop
          </h2>
          <p id="install-text" className="text-sm text-navy-600">
            Add it to your home screen: open it in one tap, full screen, like an app. You can remove it any time.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-10 shrink-0 place-items-center text-navy-600 hover:bg-navy-50">
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      {route === "ios" ? (
        <ol className="grid gap-2 text-sm">
          <li className="flex items-center gap-2 border border-navy-200 p-3">
            <Share className="size-5 shrink-0 text-brand-700" aria-hidden="true" />
            <span>
              1. Tap <strong>Share</strong> in your browser&apos;s toolbar.
            </span>
          </li>
          <li className="flex items-center gap-2 border border-navy-200 p-3">
            <SquarePlus className="size-5 shrink-0 text-brand-700" aria-hidden="true" />
            <span>
              2. Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
            </span>
          </li>
        </ol>
      ) : null}
      <div className="flex gap-2">
        {route === "prompt" ? (
          <>
            <button type="button" onClick={onClose} className="h-12 flex-1 border border-navy-300 bg-white text-sm font-bold text-navy-900 hover:bg-navy-50">
              Not now
            </button>
            <button type="button" onClick={onInstall} className="h-12 flex-1 bg-navy-900 text-sm font-bold text-white hover:bg-navy-800">
              Install
            </button>
          </>
        ) : (
          <button type="button" onClick={onClose} className="h-12 flex-1 bg-navy-900 text-sm font-bold text-white hover:bg-navy-800">
            Got it
          </button>
        )}
      </div>
    </div>
  );
}
