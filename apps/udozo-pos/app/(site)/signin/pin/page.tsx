import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChangePinForm } from "@/components/staff-auth";
import { actorKind } from "@/lib/pos-api";
import { staffMe } from "@/lib/pos-data";
import { hasDevice } from "@/lib/session";

export const metadata: Metadata = { title: "Your PIN", robots: { index: false, follow: false } };

/** A member of staff changes their PIN: required for a PIN from before PINs were 6 digits, else when they choose. */
export default async function ChangePinPage() {
  if ((await actorKind()) !== "staff") redirect("/signin");
  const me = await staffMe();
  if (!me.ok) redirect("/signin/staff/end");
  return (
    <div className="px-4 py-12">
      <ChangePinForm staffId={me.data.staff.id} onDevice={await hasDevice()} required={Boolean(me.data.pin_change_required)} />
    </div>
  );
}
