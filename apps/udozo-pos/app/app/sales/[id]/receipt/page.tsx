import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { PrintedReceipt } from "@/components/printed-receipt";
import { ReceiptShare } from "@/components/receipt-share";
import { needs } from "@/lib/gates";
import { methodLabel, money, shortName } from "@/lib/pos";
import { ownerSale, saleReceipts } from "@/lib/pos-data";

export const metadata: Metadata = { title: "Receipt", robots: { index: false, follow: false } };

/** A sale's receipt (S10): the receipt as it prints, and how the customer gets it: WhatsApp, email or print. */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  await needs("own_sales", "all_sales");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [sale, receipts] = await Promise.all([ownerSale(id), saleReceipts(id)]);
  if (!sale.ok || !receipts.ok) {
    if ((!sale.ok && sale.status === 404) || (!receipts.ok && receipts.status === 404)) notFound();
    return (
      <p role="alert" className="rounded-[20px] bg-white p-6 text-pos-error">
        {!sale.ok ? sale.message : !receipts.ok ? receipts.message : null}
      </p>
    );
  }
  const row = sale.data;
  const qrLink = receipts.data.print.qr?.whatsapp_url ?? null;
  const qr = qrLink ? await QRCode.toDataURL(qrLink, { errorCorrectionLevel: "M", margin: 1, width: 300 }) : null;
  const paidBy = [...new Set(row.payments.map(payment => methodLabel(payment.method).toLowerCase()))].join(" and ");
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/app/sales/${row.id}`} className="text-sm font-semibold">
            ← Sale {row.number}
          </Link>
          <h1 className="mt-2 font-display text-3xl font-bold text-pos-ink">
            {row.status === "refunded" ? "Refunded" : "Sale complete"} · {money(row.total, row.currency)}
          </h1>
          <p className="mt-1 text-pos-ink-2">
            {row.number} · Paid by {paidBy} · {row.till.name} · {shortName(row.sold_by)}
          </p>
        </div>
        <Link href="/app/till" className="flex h-12 items-center rounded-xl bg-pos-ink px-6 font-bold text-white">
          New sale
        </Link>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
        <section aria-label="The receipt" className="grid justify-items-center gap-2">
          <div className="max-w-full overflow-x-auto rounded-xl shadow-sm">
            <PrintedReceipt sale={row} receipts={receipts.data} width={receipts.data.print.width} qr={qr} />
          </div>
          <a href={`/app/sales/${row.id}/pdf?kind=invoice`} target="_blank" rel="noopener" className="text-sm font-semibold">
            Open the A4 invoice{receipts.data.invoice_number ? ` ${receipts.data.invoice_number}` : ""}
          </a>
        </section>
        <ReceiptShare saleId={row.id} receipts={receipts.data} />
      </div>
    </div>
  );
}
