"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { type PosShop, type PosShopKind, readVat, vatText } from "@/lib/pos";
import { updateShop } from "@/lib/pos-actions";

const input = "mt-1 h-12 w-full rounded-xl border border-pos-line bg-white px-3 text-pos-ink focus:border-pos-600 focus:ring-2 focus:ring-pos-50 focus:outline-none";
const label = "block text-sm font-semibold text-pos-ink-2";

/** The shop's details printed on receipts, the VAT added to its sales, and what kind of shop it is (the till leads with its categories). */
export function ShopForm({ shop, kinds = [] }: { shop: PosShop; kinds?: PosShopKind[] }) {
  const router = useRouter();
  const ids = useId();
  const [form, setForm] = useState({
    name: shop.name,
    address: shop.address ?? "",
    phone: shop.phone ?? "",
    tin: shop.tin ?? "",
    vat: vatText(shop.vat_bps).replace("%", ""),
    footer: shop.receipt_footer ?? "",
    kind: shop.kind?.code ?? "general",
    email: shop.email ?? "",
    bank: shop.bank?.name ?? "",
    accountName: shop.bank?.account_name ?? "",
    accountNumber: shop.bank?.account_number ?? "",
  });
  const [receiptQr, setReceiptQr] = useState(shop.receipt_qr !== false);
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, start] = useTransition();
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const vat = readVat(form.vat);
    if (!form.name.trim()) return setState({ ok: false, message: "Give your shop's name." });
    if (vat === null) return setState({ ok: false, message: "VAT is a rate from 0% to 50%, such as 7.5." });
    const bank = [form.bank, form.accountName, form.accountNumber].map(value => value.trim());
    if (bank.some(Boolean) && !bank.every(Boolean)) return setState({ ok: false, message: "Give the bank, the account name and its number, or leave all three empty." });
    start(async () => {
      const result = await updateShop(shop.id, {
        name: form.name,
        address: form.address || null,
        phone: form.phone || null,
        tin: form.tin || null,
        vat_bps: vat,
        receipt_footer: form.footer || null,
        ...(kinds.length ? { kind: form.kind } : {}),
        email: form.email || null,
        bank_name: form.bank || null,
        bank_account_name: form.accountName || null,
        bank_account_number: form.accountNumber || null,
        receipt_qr: receiptQr,
      });
      setState(result.ok ? { ok: true, message: "Saved." } : { ok: false, message: result.message });
      if (result.ok) router.refresh();
    });
  };
  const field = (key: keyof typeof form, text: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={`${ids}-${key}`} className={label}>
        {text}
      </label>
      <input id={`${ids}-${key}`} value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} className={input} {...extra} />
    </div>
  );
  return (
    <form onSubmit={save} className="grid gap-4">
      {field("name", "Shop name", { required: true, maxLength: 80 })}
      {kinds.length ? (
        <div>
          <label htmlFor={`${ids}-kind`} className={label}>
            Kind of shop
          </label>
          <select id={`${ids}-kind`} value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value })} className={input}>
            {kinds.map(kind => (
              <option key={kind.code} value={kind.code}>
                {kind.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-pos-muted">Your till shows this kind&apos;s categories first, and is tailored to it as Udozo POS grows.</p>
        </div>
      ) : null}
      {field("address", "Address", { maxLength: 300 })}
      <div className="grid gap-4 sm:grid-cols-2">
        {field("phone", "Shop phone", { maxLength: 30, inputMode: "tel" })}
        {field("tin", "Tax ID or TIN", { maxLength: 40 })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {field("vat", "VAT added to sales (%)", { inputMode: "decimal", maxLength: 6 })}
        {field("footer", "Line at the bottom of receipts", { maxLength: 300, placeholder: "Returns within 7 days with this receipt" })}
      </div>
      {field("email", "Shop email, on invoices", { type: "email", maxLength: 254 })}
      <fieldset className="grid gap-4 rounded-xl border border-pos-line p-4">
        <legend className="px-1 text-sm font-semibold text-pos-ink-2">Your bank account, printed on invoices for later payments</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          {field("bank", "Bank", { maxLength: 80 })}
          {field("accountName", "Account name", { maxLength: 120 })}
          {field("accountNumber", "Account number", { maxLength: 30, inputMode: "numeric" })}
        </div>
        <p className="text-xs text-pos-muted">Customers pay into it themselves. Udozo never uses it.</p>
      </fieldset>
      <label className="flex items-center gap-2 text-pos-ink">
        <input type="checkbox" checked={receiptQr} onChange={event => setReceiptQr(event.target.checked)} className="size-5 accent-pos-600" />
        Print the WhatsApp QR code on receipts, so customers can get a PDF copy
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="flex h-12 items-center rounded-xl bg-pos-600 px-6 font-bold text-white hover:bg-pos-700 disabled:opacity-60">
          Save shop details
        </button>
        {state ? (
          <p role={state.ok ? "status" : "alert"} className={state.ok ? "font-semibold text-pos-700" : "font-semibold text-pos-error"}>
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
