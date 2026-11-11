import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DeviceGone, TillTiles } from "@/components/staff-auth";
import { linkedDevice } from "@/lib/pos-data";
import { hasDevice } from "@/lib/session";

export const metadata: Metadata = { title: "Who’s selling?", robots: { index: false, follow: false } };

/** A linked till's sign-in: the name tiles of whoever may sell at it, then their PIN. */
export default async function TillSignInPage() {
  if (!(await hasDevice())) redirect("/link");
  const device = await linkedDevice();
  return (
    <div className="mx-auto grid max-w-[1100px] gap-6 px-4 py-10 sm:px-6">
      {device.ok ? (
        <TillTiles device={device.data} />
      ) : device.status === 401 ? (
        <section className="mx-auto grid w-full max-w-md gap-4 rounded-[20px] bg-white p-6">
          <h1 className="font-display text-2xl font-bold text-pos-ink">This device is no longer linked</h1>
          <p className="text-pos-ink-2">The shop unlinked it. Ask the shop owner for a new link code.</p>
          <DeviceGone />
        </section>
      ) : (
        <p role="alert" className="rounded-[20px] bg-white p-6 text-pos-error">
          {device.message}
        </p>
      )}
      <p className="text-center text-sm text-pos-muted">
        Shop owner? <Link href="/signin/udozo?next=/app">Sign in with your Udozo account</Link>
      </p>
    </div>
  );
}
