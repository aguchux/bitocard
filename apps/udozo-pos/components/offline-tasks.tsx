"use client";

import { useState } from "react";
import { PinPad } from "@/components/pin-pad";
import { findProducts, money, readAmount } from "@/lib/pos";
import {
  type ApprovalNeed,
  approversFor,
  countsBlind,
  expectedCash,
  exportPayload,
  level,
  type LocalSale,
  type LocalShift,
  newEntry,
  type OfflineCopy,
  type OutboxEntry,
  pendingUpload,
  type Refundable,
  refundables,
} from "@/lib/offline-rules";
import { checkPin, markRefunded, saveEntry, signPayload, writeShift } from "@/lib/offline-store";

type Person = OfflineCopy["staff"][number];
const button = "inline-flex h-12 items-center justify-center rounded-xl px-5 font-bold disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${button} bg-pos-600 text-white hover:bg-pos-700`;
const quiet = `${button} border border-pos-line bg-white text-pos-ink hover:bg-pos-50`;
const field = "h-11 w-full min-w-0 rounded-xl border border-pos-line px-3";
const newId = () => crypto.randomUUID();

const needWords: Record<ApprovalNeed["kind"], string> = {
  discount: "this discount",
  oversell: "selling more than this till's copy shows",
  refund: "this refund",
  stock: "this stock change",
};

/**
 * A manager's PIN offline (milestone 9): a colleague whose own role covers what is asked, and who signed in on this
 * till online before, types their PIN; it is checked against this till's own check. Udozo checks the approval again
 * when the step is uploaded.
 */
export function ManagerPin({ staff, checks, need, asking, onApproved, onCancel }: { staff: Person[]; checks: ReadonlySet<string>; need: ApprovalNeed; asking: string; onApproved: (approver: Person) => void; onCancel: () => void }) {
  const [who, setWho] = useState<Person | null>(null);
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const people = approversFor(staff, checks, need, asking);
  return (
    <section aria-labelledby="approve" className="mx-auto grid w-full max-w-md gap-4 rounded-[20px] bg-white p-6">
      <h2 id="approve" className="font-display text-2xl font-bold text-pos-ink">
        A manager’s PIN
      </h2>
      <p className="text-pos-ink-2">Your role needs a colleague to approve {needWords[need.kind]}.</p>
      {!people.length ? (
        <p role="alert" className="font-semibold text-pos-warn">
          Nobody who can approve it has signed in on this till online. It can be done once the till is back online.
        </p>
      ) : who ? (
        <>
          <PinPad
            value={pin}
            label={`${who.name}’s PIN`}
            autoFocus
            onChange={next => {
              setPin(next);
              if (next.length !== 4) return;
              void checkPin(who.id, next).then(answer => {
                setPin("");
                if (answer === "ok") onApproved(who);
                else setMessage(answer === "locked" ? "Too many wrong PINs on this till. Try again in 15 minutes." : "That PIN is not right.");
              });
            }}
          />
          <button type="button" onClick={() => (setWho(null), setMessage(null))} className={quiet}>
            Someone else
          </button>
        </>
      ) : (
        <ul className="grid gap-2">
          {people.map(person => (
            <li key={person.id}>
              <button type="button" onClick={() => setWho(person)} className={`${quiet} w-full justify-between`}>
                <span>{person.name}</span>
                <span className="text-sm font-normal text-pos-muted">{person.role.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {message ? (
        <p role="alert" className="font-semibold text-pos-error">
          {message}
        </p>
      ) : null}
      <button type="button" onClick={onCancel} className={quiet}>
        Cancel
      </button>
    </section>
  );
}

type Ask = (need: ApprovalNeed, then: (approver: Person) => void) => void;

/** The shift offline: open it with the float, cash paid in and out, and close it with the count (blind unless the role cashes up). */
export function ShiftPanel({ person, copy, shift, sales, refundedCash, onChange }: { person: Person; copy: OfflineCopy; shift: LocalShift | null; sales: LocalSale[]; refundedCash: number; onChange: () => void }) {
  const currency = copy.account.currency;
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const at = () => new Date().toISOString();
  const target = shift ? (shift.client_id ? { shift_client_id: shift.client_id } : { shift_id: shift.id }) : {};
  const done = async (entry: OutboxEntry, next: LocalShift | null) => {
    await saveEntry(entry);
    await writeShift(next);
    setAmount("");
    setReason("");
    setMessage(null);
    onChange();
  };

  if (!shift) {
    const open = async () => {
      const float = readAmount(amount) ?? 0;
      if (float < 0) return setMessage("The float is nothing or more.");
      const client_id = newId();
      const now = at();
      await done(newEntry("shift_open", `Shift opened by ${person.name}`, { client_id, staff_id: person.id, at: now, opening_float: float }), { id: null, client_id, opened_at: now, opened_by: person.name, opening_float: float, cash: [] });
    };
    return (
      <section aria-labelledby="shift" className="grid max-w-md gap-3 rounded-[20px] bg-white p-5">
        <h2 id="shift" className="font-display text-xl font-bold text-pos-ink">
          Open the till
        </h2>
        <label className="grid gap-1 text-sm font-semibold text-pos-ink-2">
          Cash in the drawer to start
          <input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0" className={field} />
        </label>
        {message ? <p role="alert" className="text-sm font-semibold text-pos-error">{message}</p> : null}
        <button type="button" onClick={() => void open()} className={primary}>
          Open the shift
        </button>
      </section>
    );
  }

  const blind = countsBlind(person);
  const expected = expectedCash(shift, sales, refundedCash);
  const move = async (kind: "in" | "out") => {
    const value = readAmount(amount);
    if (!value || value <= 0) return setMessage("Type the amount.");
    if (!reason.trim()) return setMessage("Say why the cash moved.");
    await done(newEntry("shift_cash", `Cash ${kind} (${reason.trim()})`, { client_id: newId(), staff_id: person.id, at: at(), ...target, cash_kind: kind, amount: value, reason: reason.trim() }), { ...shift, cash: [...shift.cash, { kind, amount: value }] });
  };
  const close = async () => {
    const counted = readAmount(amount);
    if (counted === null || counted < 0) return setMessage("Count the cash in the drawer and type it.");
    await done(newEntry("shift_close", `Shift closed by ${person.name}`, { client_id: newId(), staff_id: person.id, at: at(), ...target, counted, ...(reason.trim() ? { note: reason.trim() } : {}) }), null);
  };
  return (
    <section aria-labelledby="shift" className="grid max-w-md gap-3 rounded-[20px] bg-white p-5">
      <h2 id="shift" className="font-display text-xl font-bold text-pos-ink">
        The shift
      </h2>
      <p className="text-sm text-pos-ink-2">
        Opened by {shift.opened_by} at {new Date(shift.opened_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} with {money(shift.opening_float, currency)}.
        {blind ? "" : ` The drawer should hold ${money(expected, currency)}.`}
      </p>
      <label className="grid gap-1 text-sm font-semibold text-pos-ink-2">
        Amount
        <input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0" className={field} />
      </label>
      <label className="grid gap-1 text-sm font-semibold text-pos-ink-2">
        Why (or a note when closing)
        <input value={reason} onChange={event => setReason(event.target.value)} maxLength={200} className={field} />
      </label>
      {message ? <p role="alert" className="text-sm font-semibold text-pos-error">{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void move("in")} className={quiet}>
          Cash in
        </button>
        <button type="button" onClick={() => void move("out")} className={quiet}>
          Cash out
        </button>
        <button type="button" onClick={() => void close()} className={primary}>
          Count and close
        </button>
      </div>
    </section>
  );
}

/** Refunds offline: a sale made here (or one Udozo has, paid in ways the shop handles), with why and whether it goes back on the shelf. */
export function RefundPanel({ person, copy, sales, refunded, ask, onChange }: { person: Person; copy: OfflineCopy; sales: LocalSale[]; refunded: ReadonlySet<string>; ask: Ask; onChange: () => void }) {
  const currency = copy.account.currency;
  const [chosen, setChosen] = useState<Refundable | null>(null);
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const rows = refundables(sales, copy.recent_sales ?? [], refunded).slice(0, 20);
  const may = level(person, "refund");
  if (may === "no") return <p className="rounded-[20px] bg-white p-5 text-pos-ink-2">Your role does not give refunds.</p>;
  const submit = async (approver: Person | null) => {
    if (!chosen) return;
    await saveEntry(newEntry("refund", `Refund of ${chosen.number}`, { client_id: newId(), sale_client_id: chosen.client_sale_id, reason: reason.trim(), restock, staff_id: person.id, ...(approver ? { approved_by_staff_id: approver.id } : {}) }));
    await markRefunded(chosen.client_sale_id);
    setChosen(null);
    setReason("");
    setMessage(`Refunded. Give back ${money(chosen.total, currency)} the way it was paid.`);
    onChange();
  };
  const refund = () => {
    if (!reason.trim()) return setMessage("Say why it is refunded.");
    if (may === "approval") ask({ kind: "refund" }, approver => void submit(approver));
    else void submit(null);
  };
  return (
    <section aria-labelledby="refund" className="grid gap-3 rounded-[20px] bg-white p-5">
      <h2 id="refund" className="font-display text-xl font-bold text-pos-ink">
        Refund a sale
      </h2>
      {message ? <p role="status" className="text-sm font-semibold text-pos-ink">{message}</p> : null}
      {chosen ? (
        <div className="grid max-w-md gap-3">
          <p className="font-semibold">
            {chosen.number} · {money(chosen.total, currency)}
          </p>
          <ul className="text-sm text-pos-ink-2">
            {chosen.lines.map(line => (
              <li key={line.listing_id}>
                {line.title} × {line.quantity}
              </li>
            ))}
          </ul>
          <label className="grid gap-1 text-sm font-semibold text-pos-ink-2">
            Why
            <input value={reason} onChange={event => setReason(event.target.value)} maxLength={200} className={field} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={restock} onChange={event => setRestock(event.target.checked)} className="size-5" />
            Put it back on the shelf
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={refund} className={primary}>
              Refund {money(chosen.total, currency)}
            </button>
            <button type="button" onClick={() => setChosen(null)} className={quiet}>
              Back
            </button>
          </div>
        </div>
      ) : rows.length ? (
        <ul className="grid gap-2">
          {rows.map(row => (
            <li key={row.client_sale_id}>
              <button type="button" onClick={() => (setChosen(row), setMessage(null))} className="flex w-full flex-wrap justify-between gap-2 rounded-xl border border-pos-line px-3 py-2 text-left text-sm hover:bg-pos-50">
                <span className="font-semibold">{row.number}</span>
                <span>
                  {money(row.total, currency)} · {new Date(row.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-pos-muted">No sale on this till can be refunded offline. Sales paid through Udozo are refunded online.</p>
      )}
    </section>
  );
}

/** New stock, a shelf count or damage offline, a manager's PIN where the role needs it. */
export function StockPanel({ person, copy, ask, onChange }: { person: Person; copy: OfflineCopy; ask: Ask; onChange: () => void }) {
  const [words, setWords] = useState("");
  const [listing, setListing] = useState<string | null>(null);
  const [kind, setKind] = useState<"restock" | "count" | "damage">("restock");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const may = level(person, "stock_adjust");
  if (may === "no") return <p className="rounded-[20px] bg-white p-5 text-pos-ink-2">Your role does not change stock.</p>;
  const product = copy.products.find(item => item.id === listing) ?? null;
  const found = findProducts(copy.products, words).matches.slice(0, 12);
  const submit = async (approver: Person | null) => {
    if (!product) return;
    const count = Number(quantity);
    await saveEntry(newEntry("stock", `${kind === "restock" ? "New stock" : kind === "count" ? "Count" : "Damaged"}: ${product.title ?? "Untitled"} ${count}`, { client_id: newId(), staff_id: person.id, at: new Date().toISOString(), listing_id: product.id, adjustment: kind, quantity: count, ...(note.trim() ? { note: note.trim() } : {}), ...(approver ? { approved_by_staff_id: approver.id } : {}) }));
    setQuantity("");
    setNote("");
    setMessage(`Saved: it reaches Udozo when the till is back online.`);
    onChange();
  };
  const save = () => {
    const count = Number(quantity);
    if (!product) return setMessage("Choose a product.");
    if (!Number.isInteger(count) || count < 0 || (kind !== "count" && count === 0)) return setMessage(kind === "count" ? "Type how many are on the shelf." : "Type how many.");
    if (may === "approval") ask({ kind: "stock" }, approver => void submit(approver));
    else void submit(null);
  };
  return (
    <section aria-labelledby="stock" className="grid gap-3 rounded-[20px] bg-white p-5">
      <h2 id="stock" className="font-display text-xl font-bold text-pos-ink">
        Change stock
      </h2>
      <input value={words} onChange={event => setWords(event.target.value)} placeholder="Find a product" aria-label="Find a product" className={field} />
      <ul className="grid gap-1 sm:grid-cols-2">
        {found.map(item => (
          <li key={item.id}>
            <button type="button" aria-pressed={listing === item.id} onClick={() => (setListing(item.id), setMessage(null))} className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${listing === item.id ? "border-pos-600 bg-pos-50" : "border-pos-line"}`}>
              {item.title ?? "Untitled"}
              <span className="block text-xs text-pos-muted">{item.on_hand ?? item.available} on the shelf at the last sync</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2" role="group" aria-label="What changed">
        {(["restock", "count", "damage"] as const).map(value => (
          <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)} className={`h-10 rounded-full px-4 text-sm font-semibold ${kind === value ? "bg-pos-600 text-white" : "border border-pos-line bg-white"}`}>
            {value === "restock" ? "New stock" : value === "count" ? "Count" : "Damaged"}
          </button>
        ))}
      </div>
      <label className="grid max-w-xs gap-1 text-sm font-semibold text-pos-ink-2">
        {kind === "count" ? "On the shelf now" : "How many"}
        <input inputMode="numeric" value={quantity} onChange={event => setQuantity(event.target.value)} className={field} />
      </label>
      <label className="grid max-w-md gap-1 text-sm font-semibold text-pos-ink-2">
        Note
        <input value={note} onChange={event => setNote(event.target.value)} maxLength={200} className={field} />
      </label>
      {message ? <p role="status" className="text-sm font-semibold text-pos-ink">{message}</p> : null}
      <button type="button" onClick={save} className={`${primary} max-w-xs`}>
        Save
      </button>
    </section>
  );
}

/**
 * Saves everything waiting to a file (milestone 9), signed with this till's own key, for when the till cannot get
 * online and its sales must not be lost: the owner uploads the file on Offline sales from any signed-in device.
 */
export function ExportUnsent({ copy, sales, entries }: { copy: OfflineCopy; sales: LocalSale[]; entries: OutboxEntry[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const waiting = pendingUpload(sales, entries);
  if (!copy.device || !waiting.length) return null;
  const save = async () => {
    const payload = exportPayload(copy.device!.id, waiting.map(row => row.body));
    const file = JSON.stringify({ payload, signature: await signPayload(payload) });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([file], { type: "application/json" }));
    link.download = `udozo-pos-unsent-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    setMessage(copy.device!.key ? "Saved. Upload it on Offline sales from any signed-in device; nothing is applied twice." : "Saved, but Udozo has not got this till's key yet: connect it once before the file can be checked.");
  };
  return (
    <span className="grid gap-1">
      <button type="button" onClick={() => void save()} className={quiet}>
        Save unsent to a file
      </button>
      {message ? <span role="status" className="max-w-xs text-xs text-pos-ink-2">{message}</span> : null}
    </span>
  );
}
