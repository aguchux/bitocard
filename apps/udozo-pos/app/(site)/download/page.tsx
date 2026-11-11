import type { Metadata } from "next";
import Link from "next/link";
import { posApps } from "@/lib/pos-data";

export const metadata: Metadata = {
  title: "Apps",
  description: "Use Udozo POS in any browser at pos.udozo.com. Apps for Android, iPhone and iPad, and Windows are on their way.",
  alternates: { canonical: "/download" },
};

const devices = [
  { key: "android", name: "Android", body: "Phones, tablets and Android POS terminals, with Bluetooth receipt printers and barcode scanners.", store: "Get it on Google Play" },
  { key: "ios", name: "iPhone and iPad", body: "Turn an iPad into a counter till, or sell from an iPhone at markets and pop-ups.", store: "Download on the App Store" },
  { key: "windows", name: "Windows", body: "For counter PCs with USB printers, cash drawers and scanners. Windows 10 or 11.", store: "Get it from the Microsoft Store" },
] as const;

/**
 * Where to get Udozo POS. Each app's button goes to its store once admins set the link; until then it says Coming soon
 * and is not a link. Windows is only ever the Microsoft Store listing, never a file from this site.
 */
export default async function DownloadPage() {
  const apps = await posApps();
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="font-display text-4xl font-bold text-pos-ink">Sell from any device</h1>
      <p className="mt-3 max-w-2xl text-lg text-pos-ink-2">Use pos.udozo.com in a browser, or install the Udozo POS app. Everyone signs in the same way: owners with their Udozo account, staff with the shop code and their PIN.</p>
      <ul className="mt-10 grid gap-5 md:grid-cols-2">
        {devices.map(device => {
          const url = apps[device.key];
          return (
            <li key={device.key} className="flex flex-col gap-3 rounded-[20px] border border-pos-line bg-white p-6">
              <h2 className="font-display text-2xl font-bold text-pos-ink">{device.name}</h2>
              <p className="text-pos-ink-2">{device.body}</p>
              {url ? (
                <a href={url} rel="noopener" className="mt-auto flex h-12 items-center justify-center rounded-xl bg-pos-600 font-bold text-white no-underline hover:bg-pos-700">
                  {device.store}
                </a>
              ) : (
                <span className="mt-auto flex h-12 items-center justify-center rounded-xl border border-dashed border-pos-line font-semibold text-pos-muted">Coming soon</span>
              )}
            </li>
          );
        })}
        <li className="flex flex-col gap-3 rounded-[20px] border-2 border-pos-600 bg-white p-6">
          <h2 className="font-display text-2xl font-bold text-pos-ink">Any browser</h2>
          <p className="text-pos-ink-2">Nothing to install. Open pos.udozo.com on a laptop, Chromebook, tablet or phone.</p>
          <Link href="/app" className="mt-auto flex h-12 items-center justify-center rounded-xl bg-pos-600 font-bold text-white no-underline hover:bg-pos-700">
            Open pos.udozo.com
          </Link>
        </li>
      </ul>
    </div>
  );
}
