// @vitest-environment jsdom
// pos.udozo.com's receipt screen (milestone 6, S10): the receipt as it prints (a gift receipt without prices), and how
// the customer gets it: a QR code waiting until they have had the PDF, their WhatsApp, their email, or the printer.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PosReceipts, PosSale } from "@/lib/pos";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({ showReceiptCode: vi.fn(), receiptCodeStatus: vi.fn(), sendReceiptWhatsapp: vi.fn(), sendReceiptEmail: vi.fn() }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/receipt-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,QR") } }));

const { ReceiptShare } = await import("@/components/receipt-share");
const { PrintedReceipt, receiptTime } = await import("@/components/printed-receipt");

const mounted: Array<() => void> = [];
function mount(element: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(element));
  mounted.push(() => act(() => root.unmount()));
  return host;
}
afterEach(() => {
  mounted.splice(0).forEach(unmount => unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.useRealTimers();
});

const radio = (host: ParentNode, text: string) => [...host.querySelectorAll('[role="radio"]')].find(item => item.textContent?.startsWith(text)) as HTMLButtonElement;
const button = (host: ParentNode, text: string) => [...host.querySelectorAll("button")].find(item => item.textContent?.trim().startsWith(text))!;
const type = (field: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
const submit = (form: HTMLFormElement) => act(async () => void form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

const saleId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const sale: PosSale = {
  object: "pos_sale",
  id: saleId,
  number: "POS-010482",
  client_sale_id: "c",
  status: "completed",
  shop: { id: "s1", name: "Ada's Gadget Hub" },
  till: { id: "t1", name: "Till 1" },
  currency: "NGN",
  items: 3,
  subtotal: 3_350_000,
  discount: 0,
  vat_bps: 750,
  vat: 251_250,
  total: 3_601_250,
  change: 0,
  lines: [
    { listing_id: "l1", title: "Wireless Earbuds Pro", sku: "AUD-000014", barcode: null, quantity: 1, unit_price: 1_850_000, discount: 0, total: 1_850_000 },
    { listing_id: "l2", title: "USB-C Fast Charger 25W", sku: null, barcode: null, quantity: 2, unit_price: 750_000, discount: 0, total: 1_500_000 },
  ],
  payments: [{ method: "transfer", amount: 3_601_250, tendered: null, change: 0, reference: "GTB 0042" }],
  customer: { id: "c1", name: "Chief Okoro", number: "C-000001" },
  sold_by: "Blessing Musa",
  sold_by_staff_id: null,
  refunded_by: null,
  note: null,
  refunded_at: null,
  refund_reason: null,
  restocked: null,
  created_at: "2026-11-10T15:12:00Z",
  client_created_at: null,
} as PosSale;
const receipts = (extra: Partial<PosReceipts> = {}): PosReceipts => ({
  object: "pos_receipts",
  sale_id: saleId,
  number: "POS-010482",
  invoice_number: null,
  whatsapp: { available: true, reason: null },
  email: { available: true },
  print: { width: 80, auto_print: false, qr: { text: "RECEIPT POS-010482-K7M2Q9XA", whatsapp_url: "https://wa.me/2348000000000?text=RECEIPT" } },
  shop: { name: "Ada's Gadget Hub", address: "12 Allen Avenue, Ikeja", phone: "0803 000 1111", tin: "12345678-0001", email: null, footer: "Returns within 7 days with this receipt.", online: "udozo.com/ng/seller/adagadgets" },
  customer: { id: "c1", name: "Chief Okoro", phone: null, email: null },
  sends: [],
  ...extra,
});

describe("the printed receipt", () => {
  it("prints the shop, lines, totals in the currency's code, payments and the QR code; a gift receipt hides prices", () => {
    const host = mount(createElement(PrintedReceipt, { sale, receipts: receipts(), width: 80, qr: "data:image/png;base64,QR" }));
    const text = host.textContent!;
    for (const words of ["Ada's Gadget Hub", "Tel 0803 000 1111 · TIN 12345678-0001", "SALES RECEIPT", "POS-010482", "10/11/2026 16:12", "Blessing M.", "Chief Okoro", "2 x 7,500.00", "VAT 7.5%", "TOTAL NGN", "36,012.50", "Transfer", "GTB 0042", "GET THIS RECEIPT AS A PDF", "Returns within 7 days", "Shop online: udozo.com/ng/seller/adagadgets", "Powered by Udozo POS"]) expect(text).toContain(words);
    expect(host.querySelector("img")!.getAttribute("alt")).toMatch(/WhatsApp/);
    expect((host.querySelector("article") as HTMLElement).style.width).toBe("80mm");

    const gift = mount(createElement(PrintedReceipt, { sale, receipts: receipts(), width: 58, gift: true }));
    expect(gift.textContent).toContain("GIFT RECEIPT");
    expect(gift.textContent).toContain("Qty 2");
    expect(gift.textContent).not.toContain("36,012.50");
    expect(gift.textContent).not.toContain("GTB 0042");
    expect(gift.querySelector("img")).toBeNull();
    expect(receiptTime("2026-11-10T23:30:00Z")).toBe("11/11/2026 00:30");
  });
});

describe("how the customer gets it", () => {
  it("shows a QR code, waits for the scan and says where the PDF went", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    actions.showReceiptCode.mockResolvedValue({ ok: true, data: { object: "pos_receipt_code", id: "code1", kind: "receipt", purpose: "screen", expires_at: new Date(Date.now() + 600_000).toISOString(), used_at: null, delivered_to: null, text: "RECEIPT POS-010482-K7M2Q9XA", whatsapp_url: "https://wa.me/2348000000000?text=RECEIPT" } });
    actions.receiptCodeStatus.mockResolvedValue({ ok: true, data: { object: "pos_receipt_code", id: "code1", kind: "receipt", purpose: "screen", expires_at: new Date(Date.now() + 600_000).toISOString(), used_at: "2026-11-11T15:13:00Z", delivered_to: "+234 803 ••• 4417" } });
    const host = mount(createElement(ReceiptShare, { saleId, receipts: receipts() }));
    expect(radio(host, "Scan a QR code").getAttribute("aria-checked")).toBe("true");
    await act(async () => button(host, "Show the QR code").click());
    expect(actions.showReceiptCode).toHaveBeenCalledWith(saleId, "receipt");
    await act(async () => void (await Promise.resolve()));
    expect(host.querySelector('img[alt^="QR code"]')).not.toBeNull();
    expect(host.textContent).toContain("Waiting for them to scan");
    await act(async () => void vi.advanceTimersByTime(3100));
    await act(async () => void (await Promise.resolve()));
    expect(actions.receiptCodeStatus).toHaveBeenCalledWith(saleId, "code1");
    expect(host.textContent).toContain("PDF delivered to +234 803 ••• 4417");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("sends to their WhatsApp, keeping the number for the customer who has none", async () => {
    actions.sendReceiptWhatsapp.mockResolvedValue({ ok: true, data: { object: "pos_receipt_send", id: "s1", kind: "invoice", via: "whatsapp", to: "+234 803 ••• 4417", status: "sending", template: false, error: null, by: null, created_at: "" } });
    const host = mount(createElement(ReceiptShare, { saleId, receipts: receipts() }));
    act(() => radio(host, "Send to WhatsApp").click());
    type(host.querySelector('input[inputmode="tel"]') as HTMLInputElement, "0803 111 4417");
    act(() => (([...host.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[])[0]!).click());
    expect(host.textContent).toContain("Keep this number for Chief Okoro");
    await submit(host.querySelector("form")!);
    expect(actions.sendReceiptWhatsapp).toHaveBeenCalledWith(saleId, { phone: "0803 111 4417", kind: "invoice", save: true });
    expect(host.querySelector('[role="status"]')!.textContent).toContain("Sending to +234 803 ••• 4417");
  });

  it("emails the receipt, the invoice or both, and says why one was refused", async () => {
    actions.sendReceiptEmail.mockResolvedValue({ ok: false, message: "This sale's receipt has been sent 10 times today.", code: "receipt_send_limit", param: null });
    const host = mount(createElement(ReceiptShare, { saleId, receipts: receipts({ customer: { id: "c1", name: "Chief Okoro", phone: null, email: "okoro@example.com" } }) }));
    act(() => radio(host, "Email").click());
    expect((host.querySelector('input[type="email"]') as HTMLInputElement).value).toBe("okoro@example.com");
    expect(host.textContent).not.toContain("Keep this email");
    act(() => ([...host.querySelectorAll('input[type="radio"]')].find(item => item.parentElement?.textContent === "Both") as HTMLInputElement).click());
    await submit(host.querySelector("form")!);
    expect(actions.sendReceiptEmail).toHaveBeenCalledWith(saleId, { email: "okoro@example.com", attach: "both", save: false });
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("This sale's receipt has been sent 10 times today.");
  });

  it("prints on the till's paper or 58 mm, as a gift receipt, and opens the PDFs", () => {
    const host = mount(createElement(ReceiptShare, { saleId, receipts: receipts({ print: { width: 58, auto_print: true, qr: null } }) }));
    act(() => radio(host, "Print").click());
    const links = () => [...host.querySelectorAll("a")].map(link => link.getAttribute("href"));
    expect(links()).toContain(`/print/${saleId}?width=58&auto=1`);
    act(() => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    const select = host.querySelector("select") as HTMLSelectElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "80");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(links()).toEqual([`/print/${saleId}?width=80&gift=1&auto=1`, `/app/sales/${saleId}/pdf?width=80&gift=1&download=1`, `/app/sales/${saleId}/pdf?kind=invoice`]);
  });

  it("where WhatsApp is closed: only email and print, saying why; and what was sent is listed", () => {
    const host = mount(
      createElement(ReceiptShare, {
        saleId,
        receipts: receipts({
          whatsapp: { available: false, reason: "Receipts on WhatsApp are not open in your country yet." },
          sends: [{ object: "pos_receipt_send", id: "s1", kind: "receipt", via: "email", to: "b***@example.com", status: "sent", template: false, error: null, by: "Blessing Musa", created_at: "2026-11-11T15:13:00Z" }],
        }),
      }),
    );
    expect([...host.querySelectorAll('[role="radio"]')].map(item => item.firstElementChild!.textContent)).toEqual(["Email", "Print"]);
    expect(host.textContent).toContain("not open in your country yet");
    expect(host.textContent).toContain("Receipt by email to b***@example.com, sent");
    expect(host.textContent).toContain("16:13, Blessing Musa");
  });
});
