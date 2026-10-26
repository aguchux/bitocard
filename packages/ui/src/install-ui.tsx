"use client";

import { useEffect, useRef, useState } from "react";
import { installRoute, installStateKey, installVisitKey, installed, promptDelayMs, readInstallState, reminded, shouldRemind, type InstallState } from "./install";

/** Chrome's install event (not in TypeScript's DOM types). */
type InstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

declare global {
  interface Window {
    /** Kept by `installCaptureScript` (`./install`) from the moment the page starts, before React runs. */
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
 * On every page of an installable site: registers its service worker (in production; `/sw.js`, or SHQ's push worker)
 * and remembers when the site is installed, so it is never asked again.
 */
export function InstallSupport({ worker = "/sw.js" }: { worker?: string }) {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register(worker, { scope: "/" }).catch(() => undefined);
    if (runningAsApp()) save(installed(load()));
    const done = () => save(installed(load()));
    window.addEventListener("appinstalled", done);
    return () => window.removeEventListener("appinstalled", done);
  }, [worker]);
  return null;
}

/**
 * Asks the visitor to install the site as an app, where an admin switched it on (`enabled`): a flat dialog, docked to
 * the bottom on phones, a few seconds into a visit; at most three times, on visits an hour apart (`./install`). Where
 * the browser has its own install dialog it opens it; on iPhones and iPads it says how (Share, then Add to Home Screen).
 */
export function InstallPrompt({ enabled, appName }: { enabled: boolean; appName: string }) {
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
      className="m-0 mt-auto w-full max-w-none rounded-none border-0 border-t-4 border-brand-700 bg-white p-0 text-navy-900 backdrop:bg-navy-900/45 sm:m-auto sm:max-w-md"
      onClick={event => event.target === event.currentTarget && close()}
      onClose={() => setRoute(null)}
    >
      <InstallSheet route={route} appName={appName} onInstall={() => void install()} onClose={close} />
    </dialog>
  );
}

const icon = "size-5 shrink-0";
const ShareIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`${icon} text-brand-700`} aria-hidden="true">
    <path d="M12 2v13M16 6l-4-4-4 4M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
  </svg>
);
const AddIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`${icon} text-brand-700`} aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className={icon} aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

/** What the prompt says: flat, square corners, no shadow. `prompt` offers Install; `ios` shows the two steps. */
export function InstallSheet({ route, appName, onInstall, onClose }: { route: "prompt" | "ios"; appName: string; onInstall: () => void; onClose: () => void }) {
  return (
    // Focused when the dialog opens (not the close button, which would show its focus ring at once).
    <div tabIndex={-1} autoFocus className="grid gap-4 p-5 outline-none">
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- the site's own 192px icon, shown at 48px */}
        <img src="/icon-192.png" alt="" width={48} height={48} className="size-12 shrink-0" />
        <div className="grid flex-1 gap-1">
          <h2 id="install-title" className="text-lg leading-tight font-extrabold">
            Install {appName}
          </h2>
          <p id="install-text" className="text-sm text-navy-600">
            Add it to your home screen: open it in one tap, full screen, like an app. You can remove it any time.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-10 shrink-0 place-items-center text-navy-600 hover:bg-navy-50">
          <CloseIcon />
        </button>
      </div>
      {route === "ios" ? (
        <ol className="grid gap-2 text-sm">
          <li className="flex items-center gap-2 border border-navy-200 p-3">
            <ShareIcon />
            <span>
              1. Tap <strong>Share</strong> in your browser&apos;s toolbar.
            </span>
          </li>
          <li className="flex items-center gap-2 border border-navy-200 p-3">
            <AddIcon />
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
