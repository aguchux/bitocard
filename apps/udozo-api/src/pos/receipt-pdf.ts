import PDFDocument from 'pdfkit';
import { formatMoney } from '../notifications/templates.js';

/** What a receipt or invoice shows, already worded (dates in the shop's own zone). Amounts in minor units. */
export type ReceiptData = {
  shop: {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    tin: string | null;
    footer: string | null;
    bank: { name: string; accountName: string; accountNumber: string } | null;
    /** The shop on udozo.com (the owner's seller page), without the scheme. */
    online: string | null;
  };
  number: string;
  invoiceNumber: string | null;
  /** "10/11/2026 16:12" and "10 Nov 2026". */
  when: string;
  day: string;
  till: string;
  cashier: string;
  currency: string;
  refunded: { when: string; reason: string | null } | null;
  items: number;
  subtotal: number;
  discount: number;
  vatBps: number;
  vat: number;
  total: number;
  change: number;
  lines: Array<{ title: string; sku: string | null; quantity: number; unitPrice: number; discount: number; total: number }>;
  payments: Array<{ method: string; amount: number; tendered: number | null; change: number; reference: string | null }>;
  customer: { name: string; phone: string | null; email: string | null } | null;
  /** The WhatsApp QR code (PNG) that gets the PDF, printed under the total. */
  qr: Buffer | null;
};

export type ReceiptOptions = { width: 58 | 80; gift?: boolean };

/** How each way of paying reads on a receipt. */
export const paymentWords: Record<string, string> = {
  cash: 'Cash',
  transfer: 'Bank transfer',
  card: 'Card',
  other: 'Other',
  credit: 'Pay later',
  udozo_wallet: 'Udozo wallet',
  udozo_transfer: 'Transfer to Udozo account',
};

/** The amounts as receipts print them: the currency's code, never a symbol the printer's fonts may lack. */
const plain = (minor: number) => (minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const vatText = (bps: number) => `VAT ${(bps / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`;
/** What is still owed on it: the parts paid later. */
export const owedOf = (data: Pick<ReceiptData, 'payments'>) => data.payments.filter(payment => payment.method === 'credit').reduce((sum, payment) => sum + payment.amount, 0);

/** Where the invoice stands: refunded, paid, part paid (some paid later) or unpaid. */
export function invoiceStatus(data: Pick<ReceiptData, 'refunded' | 'payments' | 'total'>) {
  if (data.refunded) return 'REFUNDED';
  const owed = owedOf(data);
  if (owed <= 0) return 'PAID';
  return owed >= data.total ? 'UNPAID' : 'PART PAID';
}

const pt = (mm: number) => (mm * 72) / 25.4;

function finish(doc: PDFKit.PDFDocument) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/**
 * A till receipt on 80 mm or 58 mm paper, one long page as tall as it needs (drawn twice: once to measure, once on a
 * page that height). A gift receipt hides prices and payments.
 */
export async function receiptPdf(data: ReceiptData, options: ReceiptOptions): Promise<Buffer> {
  const width = pt(options.width);
  const measure = new PDFDocument({ size: [width, 20_000], margin: 0, autoFirstPage: true });
  const height = drawReceipt(measure, data, options);
  measure.end();
  const doc = new PDFDocument({ size: [width, Math.ceil(height + 12)], margin: 0, info: { Title: `Receipt ${data.number}`, Author: data.shop.name, Creator: 'Udozo POS' } });
  drawReceipt(doc, data, options);
  return finish(doc);
}

function drawReceipt(doc: PDFKit.PDFDocument, data: ReceiptData, options: ReceiptOptions) {
  const narrow = options.width === 58;
  const margin = narrow ? 8 : 11;
  const left = margin;
  const w = doc.page.width - margin * 2;
  const size = narrow ? 7 : 8;
  const ink = '#111111';
  doc.fillColor(ink);
  doc.y = margin + 2;

  const centre = (text: string, font = 'Helvetica', fontSize = size, gap = 0) => {
    doc.font(font).fontSize(fontSize).text(text, left, doc.y, { width: w, align: 'center' });
    if (gap) doc.moveDown(gap);
  };
  const row = (label: string, value: string, bold = false, fontSize = size) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
    const valueWidth = Math.min(w * 0.5, doc.widthOfString(value) + 2);
    doc.text(label, left, y, { width: w - valueWidth - 4 });
    const after = doc.y;
    doc.text(value, left, y, { width: w, align: 'right' });
    doc.y = Math.max(after, doc.y);
  };
  const rule = () => {
    doc.moveDown(0.3);
    doc.save().moveTo(left, doc.y).lineTo(left + w, doc.y).lineWidth(0.6).dash(2, { space: 2 }).strokeColor('#555555').stroke().restore();
    doc.moveDown(0.5);
  };

  centre(data.shop.name.toUpperCase(), 'Helvetica-Bold', size + 3, 0.15);
  if (data.shop.address) centre(data.shop.address);
  const contact = [data.shop.phone ? `Tel ${data.shop.phone}` : null, data.shop.tin ? `TIN ${data.shop.tin}` : null].filter(Boolean).join(' · ');
  if (contact) centre(contact);
  doc.moveDown(0.5);
  centre(options.gift ? 'GIFT RECEIPT' : 'SALES RECEIPT', 'Helvetica-Bold', size + 1);
  if (data.refunded) centre(`REFUNDED ${data.refunded.when}`, 'Helvetica-Bold', size);
  rule();

  row('Receipt', data.number);
  row('Date', data.when);
  row('Till', data.till);
  row('Cashier', data.cashier);
  if (data.customer) row('Customer', data.customer.name);
  rule();

  for (const line of data.lines) {
    doc.font('Helvetica-Bold').fontSize(size).text(line.title, left, doc.y, { width: w });
    if (options.gift) row(`Qty ${line.quantity}`, '');
    else {
      row(`${line.quantity} x ${plain(line.unitPrice)}${line.discount ? ` less ${plain(line.discount)}` : ''}`, plain(line.total));
    }
    doc.moveDown(0.25);
  }
  rule();

  row('Items', String(data.items));
  if (!options.gift) {
    row('Subtotal', plain(data.subtotal));
    row('Discount', plain(data.discount));
    if (data.vatBps > 0 || data.vat > 0) row(vatText(data.vatBps), plain(data.vat));
    doc.moveDown(0.2);
    row(`TOTAL ${data.currency}`, plain(data.total), true, size + 3);
    doc.moveDown(0.3);
    for (const payment of data.payments) {
      row(paymentWords[payment.method] ?? payment.method, plain(payment.amount));
      if (payment.method === 'cash' && payment.tendered !== null) row('Tendered', plain(payment.tendered));
      if (payment.reference) row('Ref', payment.reference);
    }
    row('Change', plain(data.change));
    const owed = owedOf(data);
    if (owed > 0 && !data.refunded) row('Still to pay', plain(owed), true);
  }

  if (data.qr) {
    rule();
    centre('GET THIS RECEIPT AS A PDF', 'Helvetica-Bold', size);
    const qrSize = narrow ? 78 : 96;
    doc.moveDown(0.3);
    const y = doc.y;
    doc.image(data.qr, left + (w - qrSize) / 2, y, { width: qrSize, height: qrSize });
    doc.y = y + qrSize + 4;
    centre('Scan with your phone camera.');
    centre('It opens WhatsApp. Tap send.');
  }

  rule();
  if (data.shop.footer) centre(data.shop.footer, 'Helvetica', size, 0.2);
  centre('Thank you for shopping with us!', 'Helvetica', size);
  if (data.shop.online) centre(`Shop online: ${data.shop.online}`);
  doc.moveDown(0.3);
  centre('Powered by Udozo POS', 'Helvetica', size - 1);
  return doc.y;
}

/** An A4 invoice: the shop, who it is billed to, the lines with SKUs, how it was paid and what is still owed. */
export function invoicePdf(data: ReceiptData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: `Invoice ${data.invoiceNumber ?? data.number}`, Author: data.shop.name, Creator: 'Udozo POS' } });
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const w = right - left;
  const navy = '#10212e';
  const muted = '#5f6b73';
  const money = (minor: number) => formatMoney(minor, data.currency);

  // The shop, then INVOICE and where it stands.
  const top = doc.y;
  doc.font('Helvetica-Bold').fontSize(18).fillColor(navy).text(data.shop.name, left, top, { width: w * 0.6 });
  doc.font('Helvetica').fontSize(9).fillColor(muted);
  for (const line of [data.shop.address, [data.shop.phone, data.shop.email].filter(Boolean).join(' · ') || null, [data.shop.tin ? `TIN ${data.shop.tin}` : null, data.shop.online].filter(Boolean).join(' · ') || null]) {
    if (line) doc.text(line, left, doc.y, { width: w * 0.6 });
  }
  const shopEnd = doc.y;
  doc.font('Helvetica-Bold').fontSize(22).fillColor(navy).text('INVOICE', left, top, { width: w, align: 'right' });
  const status = invoiceStatus(data);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(status === 'PAID' ? '#167a3b' : status === 'REFUNDED' ? '#a3241b' : '#9a5b00').text(status, left, doc.y + 2, { width: w, align: 'right' });
  doc.y = Math.max(shopEnd, doc.y) + 18;

  // Billed to, the invoice and the sale.
  const blockTop = doc.y;
  const third = w / 3;
  const block = (x: number, heading: string, lines: string[]) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(muted).text(heading.toUpperCase(), x, blockTop, { width: third - 10 });
    doc.font('Helvetica').fontSize(10).fillColor(navy);
    for (const line of lines) doc.text(line, x, doc.y, { width: third - 10 });
    return doc.y;
  };
  const billed = data.customer ? [data.customer.name, ...(data.customer.phone ? [data.customer.phone] : []), ...(data.customer.email ? [data.customer.email] : [])] : ['Walk-in customer'];
  const ends = [
    block(left, 'Bill to', billed),
    block(left + third, 'Invoice', [`No. ${data.invoiceNumber ?? data.number}`, `Issued ${data.day}`, 'Due on receipt']),
    block(left + third * 2, 'Sale', [`Receipt ${data.number}`, `${data.till} · ${data.cashier}`, data.when]),
  ];
  doc.y = Math.max(...ends) + 18;

  // The lines.
  const columns = [
    { label: '#', width: 24, align: 'left' as const },
    { label: 'Item', width: w - 24 - 70 - 40 - 90 - 95, align: 'left' as const },
    { label: 'SKU', width: 70, align: 'left' as const },
    { label: 'Qty', width: 40, align: 'right' as const },
    { label: 'Unit price', width: 90, align: 'right' as const },
    { label: 'Amount', width: 95, align: 'right' as const },
  ];
  const tableRow = (cells: string[], bold = false, colour = navy) => {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 60) doc.addPage();
    const y = doc.y;
    let x = left;
    let bottom = y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(colour);
    cells.forEach((cell, index) => {
      const column = columns[index]!;
      doc.text(cell, x + 2, y, { width: column.width - 4, align: column.align });
      bottom = Math.max(bottom, doc.y);
      x += column.width;
    });
    doc.y = bottom + 4;
    doc.save().moveTo(left, doc.y - 2).lineTo(right, doc.y - 2).lineWidth(0.4).strokeColor('#d6dde2').stroke().restore();
  };
  tableRow(columns.map(column => column.label), true, muted);
  data.lines.forEach((line, index) =>
    tableRow([String(index + 1), line.discount ? `${line.title} (less ${money(line.discount)})` : line.title, line.sku ?? '', String(line.quantity), money(line.unitPrice), money(line.total)]),
  );
  doc.moveDown(1);

  // How it was paid, beside the totals.
  const paidTop = doc.y;
  const owed = owedOf(data);
  const paid = data.total - owed;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(muted).text('PAYMENT', left, paidTop, { width: w * 0.5 });
  doc.font('Helvetica').fontSize(9).fillColor(navy);
  const methods = [...new Set(data.payments.filter(payment => payment.method !== 'credit').map(payment => (paymentWords[payment.method] ?? payment.method).toLowerCase()))];
  if (data.refunded) doc.text(`Refunded on ${data.refunded.when}${data.refunded.reason ? `: ${data.refunded.reason}` : ''}.`, left, doc.y, { width: w * 0.5 });
  else if (owed <= 0) doc.text(`Paid in full${methods.length ? ` by ${methods.join(' and ')}` : ''} on ${data.day}.`, left, doc.y, { width: w * 0.5 });
  else doc.text(`${money(paid)} paid${methods.length ? ` by ${methods.join(' and ')}` : ''}; ${money(owed)} to pay later.`, left, doc.y, { width: w * 0.5 });
  for (const payment of data.payments) if (payment.reference) doc.text(`Ref ${payment.reference}`, left, doc.y, { width: w * 0.5 });
  if (data.shop.bank) {
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(muted).text('FOR FUTURE PAYMENTS', left, doc.y, { width: w * 0.5 });
    doc.font('Helvetica').fontSize(9).fillColor(navy).text(`${data.shop.bank.name} · ${data.shop.bank.accountName} · ${data.shop.bank.accountNumber}`, left, doc.y, { width: w * 0.5 });
  }
  const paidEnd = doc.y;

  doc.y = paidTop;
  const totalsLeft = left + w * 0.55;
  const totalsWidth = w * 0.45;
  const totalRow = (label: string, value: string, bold = false) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor(navy);
    doc.text(label, totalsLeft, y, { width: totalsWidth / 2 });
    doc.text(value, totalsLeft, y, { width: totalsWidth, align: 'right' });
    doc.moveDown(0.2);
  };
  totalRow('Subtotal', money(data.subtotal));
  totalRow('Discount', money(data.discount));
  if (data.vatBps > 0 || data.vat > 0) totalRow(`${vatText(data.vatBps).replace('VAT ', 'VAT (')})`, money(data.vat));
  totalRow('Total', money(data.total), true);
  totalRow('Amount paid', money(data.refunded ? 0 : paid));
  totalRow('Balance due', money(data.refunded ? 0 : owed), true);
  doc.y = Math.max(paidEnd, doc.y) + 20;

  if (data.qr) {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 110) doc.addPage();
    const y = doc.y;
    doc.image(data.qr, left, y, { width: 84, height: 84 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(navy).text('Keep a copy on your phone', left + 96, y + 14, { width: w - 96 });
    doc.font('Helvetica').fontSize(9).fillColor(muted).text('Scan with your phone camera to get this invoice as a PDF on WhatsApp.', left + 96, doc.y, { width: w - 96 });
    doc.y = y + 96;
  }
  if (data.shop.footer) doc.font('Helvetica').fontSize(9).fillColor(muted).text(data.shop.footer, left, doc.y, { width: w });

  const pages = doc.bufferedPageRange();
  for (let index = 0; index < pages.count; index += 1) {
    doc.switchToPage(pages.start + index);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor(muted).text(`Generated by Udozo POS · Page ${index + 1} of ${pages.count}`, left, doc.page.height - 30, { width: w, align: 'center' });
    doc.page.margins.bottom = bottom;
  }
  return finish(doc);
}
