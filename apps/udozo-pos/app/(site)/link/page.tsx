import type { Metadata } from "next";
import { LinkDeviceForm } from "@/components/staff-auth";

export const metadata: Metadata = { title: "Link this device", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Linking a browser to a till with the one-time code the owner makes on Shop and tills (10 minutes, once). */
export default function LinkPage() {
  return (
    <div className="mx-auto grid max-w-md gap-5 px-4 py-12">
      <div>
        <h1 className="font-display text-3xl font-bold text-pos-ink">Link this device to a till</h1>
        <p className="mt-2 text-pos-ink-2">The shop owner makes a code under Shop and tills. Once linked, staff sign in here with their name and PIN.</p>
      </div>
      <section className="rounded-[20px] bg-white p-6">
        <LinkDeviceForm />
      </section>
      <p className="text-sm text-pos-muted">Use a device the shop keeps at the counter. Anyone who can open this browser can choose a name tile, so each person’s PIN is what keeps their sales their own.</p>
    </div>
  );
}
