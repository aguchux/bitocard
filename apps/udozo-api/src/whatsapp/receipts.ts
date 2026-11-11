import { Injectable } from '@nestjs/common';

/** `RECEIPT POS-000123-K7M2Q9XA`, as a receipt's QR code fills it in: the sale's number and the receipt's code. */
export function receiptCodeIn(text: string) {
  const match = /^\s*receipt\s+(pos-\d{1,12})[\s-]+([a-z2-9]{8})\s*$/i.exec(text);
  return match ? { number: match[1]!.toUpperCase(), code: match[2]!.toUpperCase() } : null;
}

/** Who asked, on WhatsApp. */
export type ReceiptAsker = { contactId: string; waId: string };

/**
 * What Udozo POS does with a receipt asked for on WhatsApp: `request` for the text a receipt's QR code fills in,
 * `choose` for the receipt template's Get receipt button (`rcpt:<code>`) and Send the A4 invoice (`rinv:<code>`). Each
 * sends the PDF itself through the outbox and returns words to say instead when it cannot (null when sent).
 */
export type ReceiptHandler = {
  request(asker: ReceiptAsker, number: string, code: string): Promise<string | null>;
  choose(asker: ReceiptAsker, kind: 'receipt' | 'invoice', code: string): Promise<string | null>;
};

/**
 * Where Udozo POS registers its receipt handler, so the WhatsApp bot never imports the POS (the POS imports WhatsApp).
 * Without one (the POS not loaded), receipts are not answered.
 */
@Injectable()
export class WhatsappReceiptsHub {
  handler: ReceiptHandler | null = null;

  use(handler: ReceiptHandler) {
    this.handler = handler;
  }
}
