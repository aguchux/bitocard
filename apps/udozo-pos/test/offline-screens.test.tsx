// @vitest-environment jsdom
// pos.udozo.com milestone 9 screens: the offline till (staff tiles, PIN against the till's own check, selling from the
// copy and saving the sale on the device), offline sales to look at and held sales, checking stock in from transit,
// closing a shop, and a product's prices per shop.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfflineCopy } from "@/lib/offline-rules";
import type { PosFlaggedSale, PosOfflineHeld, PosShop, PosStockTransfer } from "@/lib/pos";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({ importOfflineFile: vi.fn(), addShop: vi.fn(), chooseShop: vi.fn(), closeShop: vi.fn(), receiveStock: vi.fn(), takeBackStock: vi.fn(), moveStock: vi.fn(), resolveFlags: vi.fn(), decideHeld: vi.fn(), setShopPrice: vi.fn(), shopPrices: vi.fn() }));
const store = vi.hoisted(() => ({ readCopy: vi.fn(), readMeta: vi.fn(), readSales: vi.fn(), readEntries: vi.fn(async () => []), readShift: vi.fn(async () => null), readRefunded: vi.fn(async () => new Set()), hasPinCheck: vi.fn(), checkPin: vi.fn(), saveSale: vi.fn(), saveEntry: vi.fn(), writeShift: vi.fn(), markRefunded: vi.fn(), signPayload: vi.fn(), writeMeta: vi.fn() }));
const sync = vi.hoisted(() => ({ syncNow: vi.fn() }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/pos-actions", () => actions);
vi.mock("@/lib/offline-store", () => store);
vi.mock("@/lib/offline-sync", () => sync);
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { OfflineTill } = await import("@/components/offline-till");
const { FlaggedSale, HeldSale, ImportUnsent } = await import("@/components/offline-review");
const { TransferRow } = await import("@/components/move-stock");
const { ShopsPanel } = await import("@/components/shops-panel");
const { ShopPrices } = await import("@/components/shop-prices");

HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  this.open = false;
};
if (!globalThis.crypto.randomUUID) Object.assign(globalThis.crypto, { randomUUID: () => "0b0e7b4a-1111-4222-8333-444455556666" });

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
});
const settle = () => act(async () => void (await new Promise(resolve => setTimeout(resolve, 0))));
const type = (field: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
const button = (host: ParentNode, text: string) => [...host.querySelectorAll("button")].find(item => item.textContent?.trim().startsWith(text))!;
const click = (element: HTMLElement) => act(async () => void element.click());

const copy: OfflineCopy = {
  object: "pos_offline_copy",
  synced_at: new Date().toISOString(),
  limits: { hours: 72, sales: 500, warn_hours: 48 },
  account: { id: "acc", currency: "NGN", country: "NG", plan: { code: "premium", name: "Premium" } },
  shop: { id: "s", name: "Ikeja shop", address: "1 Allen Avenue", phone: null, tin: null, email: null, shop_code: "IKE-1234", vat_bps: 0, receipt_footer: "Thank you", receipt_qr: true, bank: null, paused: false, closed: false },
  till: { id: "t", name: "Till 2", printer_width: 80, auto_print: false },
  payment_methods: ["cash", "transfer", "card", "other"],
  staff: [
    { id: "bola", name: "Bola Ade", first_name: "Bola", initials: "BA", role: { id: "cashier", name: "Cashier", discount_limit_bps: 500 }, permissions: { sell: "yes" } },
    { id: "chi", name: "Chi Obi", first_name: "Chi", initials: "CO", role: { id: "cashier", name: "Cashier", discount_limit_bps: 500 }, permissions: { sell: "yes" } },
    { id: "dan", name: "Dan Eze", first_name: "Dan", initials: "DE", role: { id: "stock_keeper", name: "Stock keeper", discount_limit_bps: 0 }, permissions: { sell: "no" } },
  ],
  categories: [],
  products: [
    { id: "radio", ref: 1, sku: "RAD-000001", title: "Sony radio", barcode: "5012345678900", price: 20_000, category: null, photo_url: null, available: 1, blocked: null },
    { id: "tv", ref: 2, sku: "TV-000002", title: "Hisense TV", barcode: null, price: 100_000, category: null, photo_url: null, available: 0, blocked: "out_of_stock" },
  ],
};

describe("the offline till", () => {
  function open() {
    store.readCopy.mockResolvedValue(copy);
    store.readMeta.mockResolvedValue({ synced_at: copy.synced_at, next_number: 42, offline_sales: 0 });
    store.readSales.mockResolvedValue([]);
    store.hasPinCheck.mockImplementation(async (id: string) => id === "bola");
    sync.syncNow.mockResolvedValue({ waiting: 0, uploaded: 0 });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    return mount(createElement(OfflineTill));
  }

  it("lists who may sell, and only those who signed in here online can sign in offline", async () => {
    const host = open();
    await settle();
    expect(host.textContent).toContain("Ikeja shop · Till 2");
    expect(host.textContent).toContain("Offline");
    expect(button(host, "BABola Ade").disabled).toBe(false);
    expect(button(host, "COChi Obi").disabled).toBe(true);
    expect(host.textContent).toContain("Sign in here online once first");
    expect(host.textContent).not.toContain("Dan Eze");
    expect(sync.syncNow).not.toHaveBeenCalled();
  });

  it("checks the PIN on the till, sells from the copy and saves the sale with the till's number", async () => {
    const host = open();
    await settle();
    await click(button(host, "BABola Ade"));
    store.checkPin.mockResolvedValueOnce("wrong").mockResolvedValueOnce("ok");
    await type(host.querySelector<HTMLInputElement>("input[type=password]")!, "1111");
    await settle();
    expect(host.textContent).toContain("That PIN is not right.");
    await type(host.querySelector<HTMLInputElement>("input[type=password]")!, "7391");
    await settle();
    expect(store.checkPin).toHaveBeenLastCalledWith("bola", "7391");
    expect(host.textContent).toContain("Basket");

    // Past the copy's stock needs a colleague's PIN; nobody who could give it signed in here.
    await click(button(host, "Hisense TV"));
    expect(host.textContent).toContain("A manager’s PIN");
    expect(host.textContent).toContain("Nobody who can approve it");
    await click(button(host, "Cancel"));
    await click(button(host, "Sony radio"));
    await click(button(host, "Sony radio"));
    await click(button(host, "Cancel"));
    expect(host.textContent).toContain("Only 1 of “Sony radio” free on this till's copy.");
    await type(host.querySelector<HTMLInputElement>('input[aria-label="Cash handed over"]')!, "250");
    await click(button(host, "Take this payment"));
    await click(button(host, "Complete sale"));
    await settle();
    expect(store.saveSale).toHaveBeenCalledWith(expect.objectContaining({ client_number: "T2-0042", staff_id: "bola", total: 20_000, change: 5_000, status: "waiting", lines: [{ listing_id: "radio", title: "Sony radio", quantity: 1, unit_price: 20_000 }] }));
    expect(store.writeMeta).toHaveBeenCalledWith(expect.objectContaining({ next_number: 43, offline_sales: 1 }));
    expect(host.textContent).toContain("Receipt T2-0042 · Till 2");
    expect(host.textContent).toContain("Made offline");
  });

  it("stops selling past the offline limit", async () => {
    store.readCopy.mockResolvedValue({ ...copy, synced_at: new Date(Date.now() - 80 * 3_600_000).toISOString() });
    store.readMeta.mockResolvedValue({ synced_at: null, next_number: 1, offline_sales: 0 });
    store.readSales.mockResolvedValue([]);
    store.hasPinCheck.mockResolvedValue(true);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const host = mount(createElement(OfflineTill));
    await settle();
    expect(host.textContent).toContain("This till cannot sell offline now");
    expect(host.textContent).toContain("more than 72 hours");
  });

  const manager = { id: "mgr", name: "Ngozi Uche", first_name: "Ngozi", initials: "NU", role: { id: "manager", name: "Manager", discount_limit_bps: null }, permissions: { sell: "yes", refund: "yes", stock_adjust: "yes", till: "yes", cash_up: "yes" } } as const;
  const withManager: OfflineCopy = { ...copy, device: { id: "dev", key: true }, staff: [{ ...copy.staff[0]!, permissions: { sell: "yes", till: "yes", refund: "approval" } }, manager] };
  async function signIn() {
    store.readCopy.mockResolvedValue(withManager);
    store.readMeta.mockResolvedValue({ synced_at: withManager.synced_at, next_number: 7, offline_sales: 0 });
    store.hasPinCheck.mockResolvedValue(true);
    sync.syncNow.mockResolvedValue({ waiting: 0, uploaded: 0 });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const host = mount(createElement(OfflineTill));
    await settle();
    await click(button(host, "BABola Ade"));
    store.checkPin.mockResolvedValue("ok");
    await type(host.querySelector<HTMLInputElement>("input[type=password]")!, "7391");
    await settle();
    return host;
  }

  it("sells past the copy with a manager's PIN, and keeps the receipt to send", async () => {
    store.readSales.mockResolvedValue([]);
    const host = await signIn();
    await click(button(host, "Hisense TV"));
    await click(button(host, "Ngozi Uche"));
    await type(host.querySelector<HTMLInputElement>("input[type=password]")!, "5820");
    await settle();
    expect(store.checkPin).toHaveBeenLastCalledWith("mgr", "5820");
    expect(host.textContent).toContain("Approved by Ngozi Uche");
    await click(button(host, "Take this payment"));
    await type(host.querySelector<HTMLInputElement>('input[aria-label="Email address for the receipt"]')!, "ada@example.com");
    await click(button(host, "Complete sale"));
    await settle();
    expect(store.saveSale).toHaveBeenCalledWith(expect.objectContaining({ approved_by_staff_id: "mgr", receipt: { whatsapp: null, email: "ada@example.com" }, total: 100_000 }));
  });

  it("opens the shift and refunds with a manager's PIN, saving each step to upload", async () => {
    const sale = { client_sale_id: "s1", client_number: "T2-0006", created_at: new Date().toISOString(), staff_id: "bola", staff_name: "Bola Ade", approved_by_staff_id: null, lines: [{ listing_id: "radio", title: "Sony radio", quantity: 1, unit_price: 20_000 }], discount: 0, vat_bps: 0, subtotal: 20_000, vat: 0, total: 20_000, change: 0, payments: [{ method: "cash", amount: 20_000, tendered: null, reference: null }], status: "uploaded", number: "POS-000006", error: null };
    store.readSales.mockResolvedValue([sale]);
    const host = await signIn();
    await click(button(host, "Shift"));
    await type(host.querySelector<HTMLInputElement>("input[inputmode=decimal]")!, "50");
    await click(button(host, "Open the shift"));
    await settle();
    expect(store.saveEntry).toHaveBeenCalledWith(expect.objectContaining({ kind: "shift_open", entry: expect.objectContaining({ kind: "shift_open", staff_id: "bola", opening_float: 5_000 }) }));
    expect(store.writeShift).toHaveBeenCalledWith(expect.objectContaining({ opening_float: 5_000, opened_by: "Bola Ade" }));

    await click(button(host, "Refund"));
    await click(button(host, "POS-000006"));
    await type([...host.querySelectorAll<HTMLInputElement>("input")].find(input => !input.type || input.type === "text")!, "Faulty");
    await click(button(host, "Refund ₦200"));
    await click(button(host, "Ngozi Uche"));
    await type(host.querySelector<HTMLInputElement>("input[type=password]")!, "5820");
    await settle();
    expect(store.saveEntry).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "refund", entry: expect.objectContaining({ sale_client_id: "s1", reason: "Faulty", restock: true, staff_id: "bola", approved_by_staff_id: "mgr" }) }));
    expect(store.markRefunded).toHaveBeenCalledWith("s1");
  });
});

describe("offline sales to look at", () => {
  const flagged: PosFlaggedSale = { object: "pos_flagged_sale", id: "f", number: "POS-000012", client_number: "T2-0040", till: "Till 2", sold_by: "Bola Ade", total: 30_000, currency: "NGN", flags: [{ code: "oversold", listing_id: "radio", title: "Sony radio", short: 1 }], sold_at: "2026-11-11T09:00:00Z", uploaded_at: "2026-11-11T10:00:00Z", resolved_at: null, resolved_by: null };
  const held: PosOfflineHeld = { object: "pos_offline_held", id: "h", device: { id: "d", name: "Front counter", till: "Till 2" }, client_number: "T2-0041", sold_at: "2026-11-11T09:00:00Z", items: 2, total: 40_000, payments: [{ method: "cash", amount: 40_000 }], status: "held", decided_by: null, decided_at: null, sale_id: null, uploaded_at: "2026-11-11T10:00:00Z" };

  it("says what happened and marks it looked at; held sales are accepted after a confirmation", async () => {
    actions.resolveFlags.mockResolvedValue({ ok: true, data: { ...flagged, resolved_at: "x" } });
    actions.decideHeld.mockResolvedValue({ ok: true, data: { ...held, status: "accepted" } });
    const host = mount(createElement("ul", null, createElement(FlaggedSale, { sale: flagged, canResolve: true }), createElement(HeldSale, { held, currency: "NGN" })));
    expect(host.textContent).toContain("1 more “Sony radio” sold than there was");
    expect(host.textContent).toContain("receipt T2-0040");
    await click(button(host, "Mark as looked at"));
    expect(actions.resolveFlags).toHaveBeenCalledWith("f");
    await click(button(host, "Accept"));
    await click([...document.querySelectorAll("dialog button")].find(item => item.textContent === "Accept the sale") as HTMLElement);
    expect(actions.decideHeld).toHaveBeenCalledWith("h", "accept");
  });
});

describe("stock in transit and shops", () => {
  const transfer: PosStockTransfer = { object: "pos_stock_transfer", id: "t1", number: "ST-000003", from: { id: "a", name: "Ikeja shop" }, to: { id: "b", name: "Lekki shop" }, lines: [{ listing_id: "radio", title: "Sony radio", quantity: 4 }], units: 4, note: null, by: "Ada Okafor", status: "in_transit", received_at: null, received_by: null, received_lines: null, created_at: "2026-11-11T09:00:00Z" };

  it("checks in what arrived", async () => {
    actions.receiveStock.mockResolvedValue({ ok: true, data: { ...transfer, status: "received", received_lines: [{ listing_id: "radio", sent: 4, received: 3, lost: 1 }] } });
    const host = mount(createElement("ul", null, createElement(TransferRow, { transfer, canAct: true })));
    expect(host.textContent).toContain("On its way");
    await click(button(host, "Check in"));
    await type(host.querySelector<HTMLInputElement>("form input")!, "3");
    await act(async () => void host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(actions.receiveStock).toHaveBeenCalledWith("t1", [{ listing_id: "radio", quantity: 3 }]);
    expect(host.textContent).toContain("1 written off as lost on the way");
  });

  it("closes a shop, its stock going where the owner chooses", async () => {
    actions.closeShop.mockResolvedValue({ ok: true, data: {} });
    const shop = (id: string, name: string, main: boolean) => ({ object: "pos_shop", id, name, shop_code: "X", main, fulfils_online: main, paused: false, tills: [] }) as unknown as PosShop;
    const host = mount(createElement(ShopsPanel, { shops: [shop("a", "Ikeja shop", true), shop("b", "Lekki shop", false)], limit: 10, planName: "Multi-shop" }));
    await click(button(host, "Close shop: Lekki shop") ?? [...host.querySelectorAll("button")].filter(item => item.textContent?.startsWith("Close shop"))[1]!);
    const dialog = [...document.querySelectorAll("dialog")].find(item => item.open)!;
    expect(dialog.textContent).toContain("Close Lekki shop?");
    await act(async () => void dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(actions.closeShop).toHaveBeenCalledWith("b", "a");
  });

  it("sets a shop's own price", async () => {
    const prices = { object: "pos_shop_prices", listing_id: "radio", title: "Sony radio", currency: "NGN", udozo_price: 20_000, shops: [{ shop_id: "a", name: "Ikeja shop", own: false, price: 20_000, by: null, updated_at: null }] };
    actions.shopPrices.mockResolvedValue({ ok: true, data: prices });
    actions.setShopPrice.mockResolvedValue({ ok: true, data: { ...prices, shops: [{ ...prices.shops[0], own: true, price: 22_000, by: "Ada" }] } });
    const host = mount(createElement(ShopPrices, { id: "radio", title: "Sony radio" }));
    await click(button(host, "Prices per shop"));
    await settle();
    await type(document.querySelector<HTMLInputElement>("dialog input")!, "220");
    await click(button(document, "Save"));
    expect(actions.setShopPrice).toHaveBeenCalledWith("radio", "a", 22_000);
    expect(document.body.textContent).toContain("Ikeja shop now sells it at ₦220.");
  });
});

describe("a till's file of unsent sales", () => {
  it("is uploaded by the owner, saying what was applied", async () => {
    actions.importOfflineFile.mockResolvedValue({ ok: true, data: { device: { id: "dev", name: "Front counter" }, results: [{ client_id: "a", kind: "sale", status: "applied" }, { client_id: "b", kind: "sale", status: "duplicate" }] } });
    const host = mount(createElement(ImportUnsent));
    const input = host.querySelector<HTMLInputElement>("input[type=file]")!;
    const file = new File([JSON.stringify({ payload: "{}", signature: "x" })], "unsent.json", { type: "application/json" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => void input.dispatchEvent(new Event("change", { bubbles: true })));
    await settle();
    await settle();
    expect(actions.importOfflineFile).toHaveBeenCalledWith(JSON.stringify({ payload: "{}", signature: "x" }));
    expect(host.textContent).toContain("Front counter: 1 applied, 1 already in, 0 held, 0 refused.");
    expect(router.refresh).toHaveBeenCalled();
  });
});
