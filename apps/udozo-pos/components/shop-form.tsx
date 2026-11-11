"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { type PosShop, readVat, vatText } from "@/lib/pos";
import { updateShop } from "@/lib/pos-actions";

const input = "mt-1 h-12 w-full rounded-xl border border-pos-line bg-white px-3 text-pos-ink focus:border-pos-600 focus:ring-2 focus:ring-pos-50 focus:outline-none";
const label = "block text-sm font-semibold text-pos-ink-2";

/** The shop's details printed on receipts, and the VAT added to its sales. */
export function ShopForm({ shop }: { shop: PosShop }) {
  const router = useRouter();
  const ids = useId();
  const [form, setForm] = useState({ name: shop.name, address: shop.address ?? "", phone: shop.phone ?? "", tin: shop.tin ?? "", vat: vatText(shop.vat_bps).replace("%", ""), footer: shop.receipt_footer ?? "" });
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, start] = useTransition();
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const vat = readVat(form.vat);
    if (!form.name.trim()) return setState({ ok: false, message: "Give your shop's name." });
    if (vat === null) return setState({ ok: false, message: "VAT is a rate from 0% to 50%, such as 7.5." });
    start(async () => {
      const result = await updateShop(shop.id, { name: form.name, address: form.address || null, phone: form.phone || null, tin: form.tin || null, vat_bps: vat, receipt_footer: form.footer || null });
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
      {field("address", "Address", { maxLength: 300 })}
      <div className="grid gap-4 sm:grid-cols-2">
        {field("phone", "Shop phone", { maxLength: 30, inputMode: "tel" })}
        {field("tin", "Tax ID or TIN", { maxLength: 40 })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {field("vat", "VAT added to sales (%)", { inputMode: "decimal", maxLength: 6 })}
        {field("footer", "Line at the bottom of receipts", { maxLength: 300, placeholder: "Thank you for shopping with us" })}
      </div>
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
