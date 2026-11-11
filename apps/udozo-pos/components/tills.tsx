"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { limitText, type PosTill } from "@/lib/pos";
import { addTill, removeTill, updateTill } from "@/lib/pos-actions";
import { useConfirm } from "./confirm-dialog";

const input = "h-11 w-full rounded-xl border border-pos-line bg-white px-3 text-pos-ink focus:border-pos-600 focus:ring-2 focus:ring-pos-50 focus:outline-none";

function TillRow({ till, last }: { till: PosTill; last: boolean }) {
  const router = useRouter();
  const ids = useId();
  const [name, setName] = useState(till.name);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const save = (fields: Parameters<typeof updateTill>[1]) =>
    start(async () => {
      const result = await updateTill(till.id, fields);
      setProblem(result.ok ? null : result.message);
      if (result.ok) router.refresh();
    });
  const remove = async () => {
    if (!(await confirm({ title: `Remove ${till.name}?`, body: "Its sales stay in your history. You can add a till again at any time.", action: "Remove till", tone: "danger" }))) return;
    start(async () => {
      const result = await removeTill(till.id);
      setProblem(result.ok ? null : result.message);
      if (result.ok) router.refresh();
    });
  };
  return (
    <li className="grid gap-3 rounded-2xl border border-pos-line bg-white p-4">
      {dialog}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
        <div>
          <label htmlFor={`${ids}-name`} className="block text-sm font-semibold text-pos-ink-2">
            Till name
          </label>
          <input id={`${ids}-name`} value={name} maxLength={60} onChange={event => setName(event.target.value)} onBlur={() => name.trim() && name !== till.name && save({ name })} className={`mt-1 ${input}`} />
        </div>
        <div>
          <label htmlFor={`${ids}-width`} className="block text-sm font-semibold text-pos-ink-2">
            Receipt width
          </label>
          <select id={`${ids}-width`} value={till.printer_width} disabled={busy} onChange={event => save({ printer_width: Number(event.target.value) as 58 | 80 })} className={`mt-1 ${input}`}>
            <option value={80}>80 mm</option>
            <option value={58}>58 mm</option>
          </select>
        </div>
        <label className="flex h-11 items-center gap-2 text-sm font-semibold text-pos-ink-2">
          <input type="checkbox" checked={till.auto_print} disabled={busy} onChange={event => save({ auto_print: event.target.checked })} className="size-5 accent-pos-600" />
          Print each receipt
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={remove} disabled={busy || last} className="h-10 rounded-xl border border-pos-line px-3 text-sm font-semibold text-pos-error hover:bg-pos-page disabled:opacity-50">
          Remove till
        </button>
        {last ? <span className="text-sm text-pos-muted">A shop keeps at least one till.</span> : null}
        {problem ? (
          <p role="alert" className="text-sm font-semibold text-pos-error">
            {problem}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** A shop's tills: each one's name, receipt width and auto print, and adding one within the plan's limit (`used`: every shop's tills). */
export function Tills({ shopId, tills, limit, used }: { shopId: string; tills: PosTill[]; limit: number | null; used: number }) {
  const router = useRouter();
  const ids = useId();
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const full = limit !== null && used >= limit;
  const add = (event: React.FormEvent) => {
    event.preventDefault();
    start(async () => {
      const result = await addTill(shopId, name);
      setProblem(result.ok ? null : result.message);
      if (result.ok) {
        setName("");
        router.refresh();
      }
    });
  };
  return (
    <div className="grid gap-4">
      <ul className="grid gap-3">
        {tills.map(till => (
          <TillRow key={till.id} till={till} last={tills.length === 1} />
        ))}
      </ul>
      <form onSubmit={add} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <label htmlFor={`${ids}-new`} className="block text-sm font-semibold text-pos-ink-2">
            New till
          </label>
          <input id={`${ids}-new`} value={name} maxLength={60} onChange={event => setName(event.target.value)} placeholder={`Till ${tills.length + 1}`} disabled={full} className={`mt-1 ${input}`} />
        </div>
        <button type="submit" disabled={busy || full} className="h-11 rounded-xl bg-pos-600 px-5 font-bold text-white hover:bg-pos-700 disabled:opacity-60">
          Add till
        </button>
      </form>
      <p className="text-sm text-pos-muted">{full ? `Your plan allows ${limitText("tills", limit)}. Move to a bigger plan on Plan and billing for more.` : `Your plan allows ${limitText("tills", limit)}.`}</p>
      {problem ? (
        <p role="alert" className="font-semibold text-pos-error">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
