"use client";

import { useEffect, useState } from "react";
import { syncNow } from "@/lib/offline-sync";
import { keepData } from "@/lib/offline-store";

const everyMs = 5 * 60_000;

/**
 * On a linked till (milestone 9): installs the POS's service worker so the offline till opens with no internet, asks
 * the browser to keep this site's data, and keeps the till's copy fresh (on opening, every five minutes and when the
 * connection returns), uploading anything sold offline first. Says how many sales still wait, and where to sell when
 * the internet is gone.
 */
export function OfflineSync() {
  const [waiting, setWaiting] = useState(0);
  const [online, setOnline] = useState(true);
  const [kept, setKept] = useState(true);

  useEffect(() => {
    let stopped = false;
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    void keepData().then(ok => !stopped && setKept(ok));
    const run = async () => {
      const result = await syncNow();
      if (!stopped && result) setWaiting(result.waiting);
    };
    const goOnline = () => {
      setOnline(true);
      void run();
    };
    const goOffline = () => setOnline(false);
    // Not in the effect's own body: a state change there would render twice.
    const first = setTimeout(() => {
      setOnline(navigator.onLine);
      void run();
    }, 0);
    const timer = setInterval(() => void run(), everyMs);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (online && waiting === 0 && kept) return null;
  return (
    <div role="status" className="bg-pos-warn-bg px-4 py-2 text-sm font-semibold text-pos-warn">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-2">
        <span>
          {!online ? "Offline: sales here wait for the internet." : waiting ? `Syncing: ${waiting} ${waiting === 1 ? "sale" : "sales"} made offline waiting to upload.` : "This browser may clear the till's offline copy. Install the app, or use a normal (not private) window."}
        </span>
        {!online ? (
          <a href="/offline" className="font-bold">
            Open the offline till
          </a>
        ) : null}
      </div>
    </div>
  );
}
