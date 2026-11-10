import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { connectName, type ShopOrder } from "@bitocard/api-client/classifieds";
import { PrintButton } from "@/components/account/print-button";
import { requireSeller } from "@/lib/account";
import { labelFor } from "@/lib/connect-label";
import { customerApi } from "@/lib/customer";
import { uuidPattern } from "@/lib/shop";

export const metadata: Metadata = { title: "Parcel label", robots: { index: false, follow: false } };

/** A Connect order's parcel label for its seller to print and stick on the parcel: the number, its QR code and the centre. */
export default async function ParcelLabel({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSeller(`/account/orders/${id}/label`);
  if (!uuidPattern.test(id)) notFound();
  const result = await customerApi<ShopOrder>("GET", `/v1/classifieds/orders/${id}`);
  if (!result.ok) notFound();
  const label = labelFor(result.data);
  if (!label) notFound();
  const svg = await QRCode.toString(label.qr, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).catch(() => null);
  return (
    <div className="mx-auto grid max-w-md gap-4 px-4 py-6">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <a href={`/account/orders/${id}`} className="text-sm font-semibold text-brand-700 hover:underline">
          Back to the order
        </a>
        <PrintButton />
      </div>
      <section aria-label="Parcel label" className="grid gap-3 rounded-2xl border-2 border-dashed border-navy-900 bg-white p-5 text-navy-900">
        <p className="text-sm font-bold tracking-wide uppercase">{connectName}</p>
        <div className="flex items-center gap-4">
          {svg ? (
            // eslint-disable-next-line @next/next/no-img-element -- the QR code drawn here, as a data address
            <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={`QR code for ${label.number}`} width={128} height={128} className="size-32 shrink-0" />
          ) : null}
          <div className="min-w-0">
            <p className="text-xs font-semibold text-navy-600">Order</p>
            <p className="font-mono text-3xl font-extrabold">{label.number}</p>
          </div>
        </div>
        <div className="grid gap-0.5 border-t border-navy-200 pt-3 text-sm">
          <p className="text-xs font-semibold text-navy-600">To</p>
          <p className="font-bold">
            {label.centre.name} · {label.centre.number}
          </p>
          <p>{label.centre.address}</p>
          <p className="text-navy-600">
            {label.centre.hours} · {label.centre.phone}
          </p>
        </div>
        <div className="border-t border-navy-200 pt-3 text-sm">
          <p className="text-xs font-semibold text-navy-600">Item</p>
          <p>{label.item}</p>
        </div>
        <p className="text-xs text-navy-600">Hand it in at the counter. The buyer inspects it there before they take it.</p>
      </section>
    </div>
  );
}
