import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { AutoPrint } from "@/components/auto-print";
import { PrintedReceipt } from "@/components/printed-receipt";
import { needs } from "@/lib/gates";
import { ownerSale, saleReceipts } from "@/lib/pos-data";

export const metadata: Metadata = { title: "Print receipt", robots: { index: false, follow: false } };

/**
 * A sale's receipt on its own, for the browser's print: the till's paper (80 mm or 58 mm, or `width`), a gift receipt
 * with `gift=1`, printing by itself with `auto=1` (the till's "Print each receipt"). Never the till's menus.
 */
export default async function PrintReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ width?: string; gift?: string; auto?: string }> }) {
  await needs("own_sales", "all_sales");
  const { id } = await params;
  const asked = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [sale, receipts] = await Promise.all([ownerSale(id), saleReceipts(id)]);
  if (!sale.ok || !receipts.ok) {
    if ((!sale.ok && sale.status === 404) || (!receipts.ok && receipts.status === 404)) notFound();
    return (
      <p role="alert" className="m-6 rounded-[20px] bg-white p-6 text-pos-error">
        {!sale.ok ? sale.message : !receipts.ok ? receipts.message : null}
      </p>
    );
  }
  const width = asked.width === "58" ? 58 : asked.width === "80" ? 80 : receipts.data.print.width;
  const qrLink = receipts.data.print.qr?.whatsapp_url ?? null;
  const qr = qrLink ? await QRCode.toDataURL(qrLink, { errorCorrectionLevel: "M", margin: 1, width: 300 }) : null;
  return (
    <main className="grid min-h-svh place-items-start justify-center gap-4 bg-pos-50 p-4 print:block print:bg-white print:p-0">
      <style>{`@page { size: ${width}mm auto; margin: 0; } @media print { .no-print { display: none !important; } html, body { background: #fff; } }`}</style>
      <div className="no-print flex flex-wrap items-center gap-3">
        <AutoPrint auto={asked.auto === "1"} />
        <Link href={`/app/sales/${id}/receipt`} className="font-semibold">
          Back to the receipt
        </Link>
      </div>
      <PrintedReceipt sale={sale.data} receipts={receipts.data} width={width} gift={asked.gift === "1"} qr={qr} />
    </main>
  );
}
