import type { Metadata } from "next";
import { OfflineTill } from "@/components/offline-till";
import { PosMark } from "@/components/site-chrome";

export const metadata: Metadata = { title: "Offline till", robots: { index: false, follow: false } };

/**
 * The offline till (milestone 9): a static page, kept by the service worker, that opens with no internet on a linked
 * till. Everything it needs is in this browser's own store; nothing here reads the server.
 */
export default function OfflinePage() {
  return (
    <>
      <header className="no-print bg-pos-night text-white">
        <div className="mx-auto flex max-w-[1200px] items-center px-4 py-3 sm:px-6">
          <PosMark />
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
