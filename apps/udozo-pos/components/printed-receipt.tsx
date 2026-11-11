/* eslint-disable @next/next/no-img-element -- the QR code is a data address drawn on the server. */
import { methodLabel, type PosReceipts, type PosSale, receiptAmount, shortName, vatText } from "@/lib/pos";

/** "10/11/2026 16:12", as receipts print the time (the shop's day, Lagos time as the rest of the till). */
export const receiptTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Lagos" }).replace(",", "");

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${strong ? "text-[1.25em] font-bold" : ""}`}>
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 text-right tabular-nums">{value}</span>
    </div>
  );
}

const Rule = () => <hr className="my-2 border-0 border-t border-dashed border-current opacity-60" />;

/**
 * A till receipt as the printer prints it, 80 mm or 58 mm wide: the shop, the sale, its lines and totals, how it was
 * paid, the WhatsApp QR code that gets the PDF, and the shop's line. A gift receipt hides prices and payments. The same
 * words as the PDF Udozo draws, for the browser's print and the receipt screen's preview.
 */
export function PrintedReceipt({ sale, receipts, width = 80, gift = false, qr = null }: { sale: PosSale; receipts: PosReceipts; width?: 58 | 80; gift?: boolean; qr?: string | null }) {
  const shop = receipts.shop;
  const owed = sale.payments.filter(payment => payment.method === "credit").reduce((sum, payment) => sum + payment.amount, 0);
  const contact = [shop.phone ? `Tel ${shop.phone}` : null, shop.tin ? `TIN ${shop.tin}` : null].filter(Boolean).join(" · ");
  return (
    <article aria-label={`Receipt ${sale.number}`} className="receipt bg-white font-sans text-[#111]" style={{ width: `${width}mm`, padding: width === 58 ? "3mm" : "4mm", fontSize: width === 58 ? "10px" : "11.5px", lineHeight: 1.35 }}>
      <header className="text-center">
        <p className="text-[1.35em] font-bold uppercase">{shop.name}</p>
        {shop.address ? <p>{shop.address}</p> : null}
        {contact ? <p>{contact}</p> : null}
        <p className="mt-2 font-bold">{gift ? "GIFT RECEIPT" : "SALES RECEIPT"}</p>
        {sale.status === "refunded" ? <p className="font-bold">REFUNDED</p> : null}
      </header>
      <Rule />
      <Row label="Receipt" value={sale.number} />
      <Row label="Date" value={receiptTime(sale.created_at)} />
      <Row label="Till" value={sale.till.name} />
      <Row label="Cashier" value={shortName(sale.sold_by)} />
      {sale.customer ? <Row label="Customer" value={sale.customer.name} /> : null}
      <Rule />
      <ul className="grid gap-1">
        {sale.lines.map(line => (
          <li key={line.listing_id}>
            <p className="font-bold">{line.title}</p>
            {gift ? <p>Qty {line.quantity}</p> : <Row label={`${line.quantity} x ${receiptAmount(line.unit_price)}${line.discount ? ` less ${receiptAmount(line.discount)}` : ""}`} value={receiptAmount(line.total)} />}
          </li>
        ))}
      </ul>
      <Rule />
      <Row label="Items" value={String(sale.items)} />
      {gift ? null : (
        <>
          <Row label="Subtotal" value={receiptAmount(sale.subtotal)} />
          <Row label="Discount" value={receiptAmount(sale.discount)} />
          {sale.vat_bps || sale.vat ? <Row label={`VAT ${vatText(sale.vat_bps)}`} value={receiptAmount(sale.vat)} /> : null}
          <div className="mt-1">
            <Row label={`TOTAL ${sale.currency}`} value={receiptAmount(sale.total)} strong />
          </div>
          <div className="mt-1">
            {sale.payments.map((payment, index) => (
              <div key={index}>
                <Row label={methodLabel(payment.method)} value={receiptAmount(payment.amount)} />
                {payment.method === "cash" && payment.tendered !== null ? <Row label="Tendered" value={receiptAmount(payment.tendered)} /> : null}
                {payment.reference ? <Row label="Ref" value={payment.reference} /> : null}
              </div>
            ))}
            <Row label="Change" value={receiptAmount(sale.change)} />
            {owed > 0 && sale.status !== "refunded" ? <Row label="Still to pay" value={receiptAmount(owed)} strong /> : null}
          </div>
        </>
      )}
      {qr ? (
        <>
          <Rule />
          <div className="text-center">
            <p className="font-bold">GET THIS RECEIPT AS A PDF</p>
            <img src={qr} alt="QR code: get this receipt as a PDF on WhatsApp" className="mx-auto my-1" style={{ width: width === 58 ? "27mm" : "34mm", height: width === 58 ? "27mm" : "34mm" }} />
            <p>Scan with your phone camera.</p>
            <p>It opens WhatsApp. Tap send.</p>
          </div>
        </>
      ) : null}
      <Rule />
      <footer className="text-center">
        {shop.footer ? <p>{shop.footer}</p> : null}
        <p>Thank you for shopping with us!</p>
        {shop.online ? <p>Shop online: {shop.online}</p> : null}
        <p className="mt-1 text-[0.9em]">Powered by Udozo POS</p>
      </footer>
    </article>
  );
}
