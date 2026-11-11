import type { Metadata } from "next";
import { OfflineTill } from "@/components/offline-till";

export const metadata: Metadata = { title: "Offline till", robots: { index: false, follow: false } };

/**
 * The offline till (milestone 9): a static page, kept by the service worker, that opens with no internet on a linked
 * till. Everything it needs is in this browser's own store; nothing here reads the server.
 */
export default function OfflinePage() {
  return (
    <>
      <header className="no-print bg-pos-night text-white">
        <div className="mx-auto flex max-w-[1200px] items-center gap-2.5 px-4 py-3 sm:px-6">
          {/* PosMark's look with a plain image the service worker keeps (an optimised one is fetched from the server). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/udozo-mark-light.png" alt="" width={36} height={36} className="h-9 w-9" />
          <span className="font-display text-[19px] font-bold text-white">Udozo POS</span>
        </div>
      </header>
      <main className="flex-1 bg-pos-page">
        <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
          <OfflineTill />
        </div>
      </main>
    </>
  );
}
