"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ApprovalBox } from "@/components/approval-box";
import { movementText, type PosApprover, type PosStockMovement, saleTime } from "@/lib/pos";
import { type Approval, adjustStock, type StockKind, stockHistory } from "@/lib/pos-actions";

const kinds: Array<{ value: StockKind; label: string; quantity: string }> = [
  { value: "restock", label: "New stock arrived", quantity: "How many arrived" },
  { value: "count", label: "I counted the shelf", quantity: "How many are there" },
  { value: "damage", label: "Damaged or lost", quantity: "How many" },
];

/**
 * Changing a product's stock from the POS: new stock in, a shelf count, or units damaged or lost, each kept with its
 * history. The stock is the listing's own, so udozo.com shows it at once.
 */
export function StockAdjust({ id, title, stock, approvers = [] }: { id: string; title: string; stock: number; approvers?: PosApprover[] }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<StockKind>("restock");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<PosStockMovement[] | null>(null);
  const [pending, start] = useTransition();
  const [approving, setApproving] = useState<string | null>(null);

  const open = () => {
    setMessage(null);
    setQuantity("");
    setNote("");
    dialog.current?.showModal();
    start(async () => {
      const result = await stockHistory(id);
      setHistory(result.ok ? result.data : []);
    });
  };

  const submit = (approval: Approval | null) => {
    const count = Number(quantity);
    if (quantity.trim() === "" || !Number.isInteger(count)) {
      setMessage("Give a whole number.");
      return;
    }
    start(async () => {
      const result = await adjustStock(id, kind, count, note, approval);
      if (!result.ok) {
        if (result.code === "approval_required" || result.code === "approval_invalid") {
          setApproving(result.message);
          setMessage(null);
          return;
        }
        setMessage(result.message);
        return;
      }
      setApproving(null);
      dialog.current?.close();
      router.refresh();
    });
  };
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    submit(null);
  };

  const field = "mt-1 h-12 w-full rounded-xl border border-pos-line bg-white px-4 text-base";
  return (
    <>
      <button type="button" onClick={open} className="w-fit text-sm font-semibold text-pos-700">
        Change stock
        <span className="sr-only"> of {title}</span>
      </button>
      <dialog ref={dialog} aria-labelledby={`stock-${id}`} className="m-auto w-[min(100%-2rem,28rem)] rounded-[20px] p-0 backdrop:bg-black/50">
        {approving ? (
          <div className="p-5">
            <ApprovalBox approvers={approvers} what="stock_adjust" reason={approving} pending={pending} onApprove={approval => submit(approval)} onCancel={() => setApproving(null)} />
          </div>
        ) : null}
        <form onSubmit={save} hidden={approving !== null} className="grid gap-3 p-5">
          <h2 id={`stock-${id}`} className="font-display text-xl font-bold text-pos-ink">
            {title}
          </h2>
          <p className="text-pos-ink-2">In stock now: {stock.toLocaleString("en-GB")}</p>
          <fieldset className="grid gap-1">
            <legend className="text-sm font-semibold text-pos-ink-2">What happened</legend>
            {kinds.map(item => (
              <label key={item.value} className="flex items-center gap-2">
                <input type="radio" name={`kind-${id}`} value={item.value} checked={kind === item.value} onChange={() => setKind(item.value)} className="size-5" />
                {item.label}
              </label>
            ))}
          </fieldset>
          <label className="text-sm font-semibold text-pos-ink-2">
            {kinds.find(item => item.value === kind)?.quantity}
            <input inputMode="numeric" value={quantity} onChange={event => setQuantity(event.target.value.replace(/\D/g, ""))} required className={field} />
          </label>
          <label className="text-sm font-semibold text-pos-ink-2">
            Note (optional)
            <input value={note} onChange={event => setNote(event.target.value)} maxLength={200} className={field} />
          </label>
          {message ? (
            <p role="alert" className="text-pos-error">
              {message}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => dialog.current?.close()} className="h-12 rounded-xl border border-pos-line font-bold">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="h-12 rounded-xl bg-pos-600 font-bold text-white hover:bg-pos-700 disabled:opacity-50">
              Save
            </button>
          </div>
          {history?.length ? (
            <div>
              <h3 className="text-sm font-semibold text-pos-ink-2">Recent changes</h3>
              <ul className="mt-1 grid gap-1 text-sm">
                {history.slice(0, 8).map(movement => (
                  <li key={movement.id} className="flex justify-between gap-2">
                    <span>
                      {movementText(movement)}
                      {movement.sale?.number ? ` (${movement.sale.number})` : ""}
                      {movement.note ? ` · ${movement.note}` : ""}
                    </span>
                    <span className="shrink-0 text-pos-muted">{saleTime(movement.created_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </form>
      </dialog>
    </>
  );
}
