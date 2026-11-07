import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PageTitle } from "@/components/account/nav";
import { WhatsappConnect } from "@/components/account/whatsapp-connect";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";
import { type WhatsappConnection, whatsappScreen } from "@/lib/whatsapp";

export const metadata: Metadata = { title: "WhatsApp" };

const card = "grid gap-3 rounded-2xl border border-navy-200 bg-white p-4 sm:p-5";

/**
 * Profile > WhatsApp (docs/UDOZO_WHATSAPP_PLAN.md): connect the customer's WhatsApp to their Udozo account with a
 * one-time code sent from it, choose what comes there, and disconnect. Closed where Udozo is not on WhatsApp yet.
 */
export default async function WhatsappPage() {
  await requireCustomer(whatsappScreen);
  const result = await customerApi<WhatsappConnection>("GET", "/v1/store/account/whatsapp");
  const data = result.ok ? result.data : null;
  return (
    <div className="grid max-w-2xl gap-5">
      <Link href="/account/profile" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-navy-700 hover:underline">
        <ChevronLeft className="size-4" aria-hidden="true" /> Profile
      </Link>
      <PageTitle title="WhatsApp" note="Use Udozo from WhatsApp: find, sell, chat and ask for what you need." post={false} />
      <section aria-label="Your WhatsApp" className={card}>
        {!data ? (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Your WhatsApp could not be loaded just now. Try again shortly.</p>
        ) : !data.available && !data.connected ? (
          <p className="text-sm text-navy-600">Udozo is not on WhatsApp in your country yet. We will show it here once it is.</p>
        ) : (
          <WhatsappConnect initial={data} />
        )}
      </section>
      <p className="text-xs text-navy-500">
        Udozo uses WhatsApp (Meta) to carry these messages. Send STOP to Udozo on WhatsApp any time for no more messages.{" "}
        <Link href="/legal/privacy#whatsapp" className="font-semibold underline">
          How Udozo uses WhatsApp
        </Link>
      </p>
    </div>
  );
}
