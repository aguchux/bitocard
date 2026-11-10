"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { handOverTransfer, receiveTransfer, sendTransfer } from "@/lib/centre-actions";
import { type Shelf, type Transfer, transferGroups, transferStatusWords } from "@/lib/centres";
import { money, when } from "@/lib/connect";
import { useConfirm } from "./confirm-dialog";
import { input, label, Panel, primary, Problem } from "./centre-ui";

/** One line about a move: the item, where it goes (or comes from), and for whom. */
function Heading({ row, centre }: { row: Transfer; centre: string }) {
  const outgoing = row.from.kind === "centre" && row.from.id === centre;
  return (
    <div className="min-w-0">
      <p className="truncate font-semibold text-navy-900">{row.order.title}</p>
      <p className="text-sm text-slate-600">
        {row.number} · {row.kind === "return" ? `a return for its seller, ${row.recipient.name}` : `bought at Udozo auction ${row.auction?.number ?? ""} by ${row.recipient.name}`}
      </p>
      <p className="text-sm text-slate-600">{outgoing ? `To ${row.to.name}, ${row.to.address}, ${row.to.state} (${row.to.phone})` : `From ${row.from.name}, ${row.from.state}`}</p>
    </div>
  );
}

/** An item this centre is to send on: pack it, give it to a courier, and say which, with the tracking number. */
function SendCard({ centre, row }: { centre: string; row: Transfer }) {
  const router = useRouter();
  const ids = useId();
  const [courier, setCourier] = useState("");
  const [tracking, setTracking] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const send = async () => {
    if (!courier.trim()) return setProblem("Say which courier takes it.");
    const ok = await confirm({ title: `Mark ${row.number} sent?`, body: `It leaves your shelves for ${row.to.name}. The ${money(row.shipping, row.currency)} shipping is paid to your earnings for the courier.`, action: "Mark it sent" });
    if (!ok) return;
    start(async () => {
      const result = await sendTransfer(centre, row.id, courier, tracking);
      if (!result.ok) return setProblem(result.message);
      setProblem(null);
      router.refresh();
    });
  };
  return (
    <li className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      {dialog}
      <Heading row={row} centre={centre} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <div>
          <label htmlFor={`${ids}-courier`} className={label}>
            Courier
          </label>
          <input id={`${ids}-courier`} value={courier} maxLength={80} onChange={event => setCourier(event.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor={`${ids}-tracking`} className={label}>
            Tracking number (optional)
          </label>
          <input id={`${ids}-tracking`} value={tracking} maxLength={80} onChange={event => setTracking(event.target.value)} className={input} />
        </div>
        <button type="button" disabled={busy} onClick={send} className={primary}>
          Mark sent
        </button>
      </div>
      <Problem message={problem} />
    </li>
  );
}

/** An item on its way here: check it in when it arrives, on a storage place. */
function ReceiveCard({ centre, row, shelves }: { centre: string; row: Transfer; shelves: Shelf[] }) {
  const router = useRouter();
  const ids = useId();
  const [shelf, setShelf] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const receive = () =>
    start(async () => {
      const result = await receiveTransfer(centre, row.id, shelf || null);
      if (!result.ok) return setProblem(result.message);
      setProblem(null);
      router.refresh();
    });
  return (
    <li className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <Heading row={row} centre={centre} />
      <p className="text-sm text-slate-600">
        {row.courier ? `With ${row.courier}${row.tracking_number ? ` (${row.tracking_number})` : ""}` : "On its way"}
        {row.sent_at ? `, sent ${when(row.sent_at)}` : ""}.
      </p>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <label htmlFor={`${ids}-shelf`} className={label}>
            Storage place
          </label>
          <select id={`${ids}-shelf`} value={shelf} onChange={event => setShelf(event.target.value)} className={input}>
            <option value="">Choose later</option>
            {shelves
              .filter(item => item.active)
              .map(item => (
                <option key={item.id} value={item.id}>
                  {item.code}
                  {item.label ? ` · ${item.label}` : ""}
                </option>
              ))}
          </select>
        </div>
        <button type="button" disabled={busy} onClick={receive} className={primary}>
          It arrived
        </button>
      </div>
      <Problem message={problem} />
    </li>
  );
}

/** A lot that arrived here for its buyer: hand it over against the collection code on their lot's page. */
function HandOverCard({ centre, row }: { centre: string; row: Transfer }) {
  const router = useRouter();
  const ids = useId();
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const hand = () =>
    start(async () => {
      const result = await handOverTransfer(centre, row.id, code);
      if (!result.ok) return setProblem(result.message);
      setProblem(null);
      setCode("");
      router.refresh();
    });
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <div>
        <label htmlFor={`${ids}-code`} className={label}>
          Buyer&apos;s collection code
        </label>
        <input id={`${ids}-code`} value={code} inputMode="numeric" autoComplete="off" maxLength={11} onChange={event => setCode(event.target.value)} className={input} />
      </div>
      <button type="button" disabled={busy} onClick={hand} className={primary}>
        Hand it over
      </button>
      <div className="sm:col-span-2">
        <Problem message={problem} />
      </div>
    </div>
  );
}

/**
 * The centre's transfers: items it sends on to another Connect Centre (a seller's return), items on their way to it,
 * and items that arrived for someone to collect here.
 */
export function TransfersList({ centre, rows, shelves }: { centre: string; rows: Transfer[]; shelves: Shelf[] }) {
  const groups = transferGroups(centre, rows);
  return (
    <div className="grid gap-4">
      <Panel title="To send">
        {groups.toSend.length ? (
          <ul className="grid gap-3">
            {groups.toSend.map(row => (
              <SendCard key={row.id} centre={centre} row={row} />
            ))}
          </ul>
        ) : (
          <p className="text-slate-600">Nothing to send on.</p>
        )}
      </Panel>
      <Panel title="On their way to you">
        {groups.coming.length ? (
          <ul className="grid gap-3">
            {groups.coming.map(row => (
              <ReceiveCard key={row.id} centre={centre} row={row} shelves={shelves} />
            ))}
          </ul>
        ) : (
          <p className="text-slate-600">Nothing on its way.</p>
        )}
      </Panel>
      <Panel title="Here, to collect">
        {groups.arrived.length ? (
          <ul className="grid gap-3">
            {groups.arrived.map(row => (
              <li key={row.id} className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-4">
                <Heading row={row} centre={centre} />
                <p className="text-sm text-slate-600">
                  Arrived {when(row.arrived_at)}
                  {row.shelf ? `, on ${row.shelf}` : ""}.{" "}
                  {row.kind === "return" ? "Hand it back on Returns against the seller's return code." : `Hand it to its buyer against their collection code. The ${money(row.fee, row.currency)} Connect fee is shared with your earnings then.`}
                </p>
                {row.kind === "lot" ? <HandOverCard centre={centre} row={row} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-600">Nothing waiting to be collected.</p>
        )}
      </Panel>
      {groups.done.length ? (
        <Panel title="Recent">
          <ul className="grid gap-1 text-sm">
            {groups.done.map(row => (
              <li key={row.id} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">
                  {row.order.title} <span className="text-slate-500">{row.number}</span>
                </span>
                <span className="shrink-0 text-slate-600">{transferStatusWords[row.status]}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
