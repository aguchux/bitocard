"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { type CentreResult, findOrder, postUpdate, receiveOrder, refuseCollection, refuseOrder, releaseOrder, shelveOrder } from "@/lib/centre-actions";
import { type CounterOrder, counterNext, counterStatus, eventWords, refusalReasons, type Shelf } from "@/lib/centres";
import { money, when } from "@/lib/connect";
import { useConfirm } from "./confirm-dialog";
import { danger, input, label, Panel, primary, Problem, secondary } from "./centre-ui";

/** Find an item by the number on its label (typed, or read from its QR code by the phone's camera app). */
export function FindOrder({ centre }: { centre: string }) {
  const router = useRouter();
  const ids = useId();
  const [number, setNumber] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={event => {
        event.preventDefault();
        start(async () => {
          const found = await findOrder(centre, number);
          if (found.ok) router.push(`/centre/${centre}/orders/${found.data.id}`);
          else setProblem(found.message);
        });
      }}
    >
      <label className={`${label} min-w-0 flex-1`} htmlFor={`${ids}-number`}>
        Order number on the label
        <input id={`${ids}-number`} className={input} value={number} onChange={event => setNumber(event.target.value)} placeholder="SP-000123" autoComplete="off" aria-invalid={problem ? true : undefined} />
      </label>
      <button type="submit" className={primary} disabled={busy || !number.trim()}>
        Find
      </button>
      {problem ? (
        <p className="w-full text-sm font-semibold text-red-700" role="alert">
          {problem}
        </p>
      ) : null}
    </form>
  );
}

/**
 * One item at the counter, step by step: receive it (checking it against the listing and the seller's photos) or
 * refuse it; shelve it; then, when the buyer comes, let them inspect it first and ask whether they accept it: if they
 * do, enter their 6-digit code and hand it over; if not, record why and keep it. Updates go to the buyer and seller.
 */
export function CounterOrderView({ centre, country, order: initial, shelves }: { centre: string; country: string; order: CounterOrder; shelves: Shelf[] }) {
  const router = useRouter();
  const ids = useId();
  const [order, setOrder] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const [note, setNote] = useState("");
  const [shelf, setShelf] = useState(order.shelf?.id ?? shelves[0]?.id ?? "");
  const [accepted, setAccepted] = useState(false);
  const [code, setCode] = useState("");
  const [update, setUpdate] = useState("");
  const next = counterNext(order);

  const take = (result: CentreResult<CounterOrder>, after?: () => void) => {
    if (result.ok) {
      setOrder(result.data);
      setProblem(null);
      after?.();
      router.refresh();
    } else setProblem(result.message);
  };

  const [refusing, setRefusing] = useState(false);
  const [why, setWhy] = useState<(typeof refusalReasons)[number]["value"]>("wrong_item");
  const refuse = async () => {
    const answer = await confirm({
      title: "Refuse this item?",
      body: `${refusalReasons.find(item => item.value === why)!.label}. Udozo decides what happens next; keep the item safe until then.`,
      action: "Refuse item",
      tone: "danger",
    });
    if (answer) start(async () => take(await refuseOrder(centre, order.id, why, note), () => setRefusing(false)));
  };

  const buyerRefuses = async () => {
    const answer = await confirm({
      title: "The buyer refuses it?",
      body: "Keep the item at the centre and take photos of what is wrong. Udozo decides what happens next.",
      action: "Record the refusal",
      tone: "danger",
      reason: { label: "Why the buyer refused it", required: true, placeholder: "Not the colour in the photos" },
    });
    if (answer) start(async () => take(await refuseCollection(centre, order.id, answer.reason)));
  };

  return (
    <div className="grid gap-5">
      {dialog}
      <div className="flex gap-3">
        {order.listing.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- the listing's own photo
          <img src={order.listing.cover_url} alt="" width={96} height={96} className="size-24 shrink-0 rounded-2xl object-cover" />
        ) : null}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-500">{order.number}</p>
          <h2 className="text-xl font-extrabold text-navy-900">{order.listing.title}</h2>
          <p className="mt-1 text-sm font-semibold text-navy-900">{counterStatus(order)}</p>
          <p className="text-sm text-slate-600">
            From {order.seller.name} · for {order.buyer.name}
            {order.quantity > 1 ? ` · ${order.quantity} items` : ""}
          </p>
        </div>
      </div>
      <Problem message={problem} />

      {next === "receive" ? (
        <Panel title="Check it in">
          <p>Open the parcel and check the item against the listing and the seller&apos;s photos below. Receive it only if it matches.</p>
          {order.courier ? (
            <p className="mt-2 text-sm">
              Coming with {order.courier}
              {order.tracking_number ? `, tracking ${order.tracking_number}` : ""}
            </p>
          ) : order.status === "sent" ? (
            <p className="mt-2 text-sm">The seller is dropping it off.</p>
          ) : null}
          <label className={`${label} mt-3`} htmlFor={`${ids}-note`}>
            Note (optional)
            <input id={`${ids}-note`} className={input} value={note} onChange={event => setNote(event.target.value)} maxLength={300} placeholder="Box in good shape" />
          </label>
          {refusing ? (
            <div className="mt-3 grid gap-3">
              <label className={label} htmlFor={`${ids}-why`}>
                Why you are refusing it
                <select id={`${ids}-why`} className={input} value={why} onChange={event => setWhy(event.target.value as typeof why)}>
                  {refusalReasons.map(item => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={danger} disabled={busy} onClick={refuse}>
                  Refuse item
                </button>
                <button type="button" className={secondary} onClick={() => setRefusing(false)}>
                  Back
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={primary} disabled={busy} onClick={() => start(async () => take(await receiveOrder(centre, order.id, note), () => setNote("")))}>
                Received
              </button>
              <button type="button" className={danger} disabled={busy} onClick={() => setRefusing(true)}>
                Refuse
              </button>
            </div>
          )}
        </Panel>
      ) : null}

      {next === "shelve" || (next === "hand_over" && order.shelf) ? (
        <Panel title={next === "shelve" ? "Shelve it" : `On ${order.shelf!.code}`}>
          {shelves.length ? (
            <>
              <p>{next === "shelve" ? "Put it in a storage place. The buyer is told it is ready once it is shelved." : "Moved it? Choose where it is now."}</p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className={`${label} min-w-0 flex-1`} htmlFor={`${ids}-shelf`}>
                  Storage place
                  <select id={`${ids}-shelf`} className={input} value={shelf} onChange={event => setShelf(event.target.value)}>
                    {shelves.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.code}
                        {item.label ? ` (${item.label})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className={next === "shelve" ? primary : secondary} disabled={busy || !shelf || shelf === order.shelf?.id} onClick={() => start(async () => take(await shelveOrder(centre, order.id, shelf)))}>
                  {next === "shelve" ? "Shelve" : "Move"}
                </button>
              </div>
            </>
          ) : (
            <p>
              Set up your storage places first.{" "}
              <a href={`/centre/${centre}/shelves`} className="font-semibold text-brand-600 hover:underline">
                Storage places
              </a>
            </p>
          )}
        </Panel>
      ) : null}

      {next === "hand_over" ? (
        <Panel title="Hand it over">
          {order.collect_by ? <p className="text-sm">Free to collect until {when(order.collect_by, country)}.</p> : null}
          {!accepted ? (
            <>
              <p className="mt-2">Give the item to the buyer to inspect. Wait for their answer: do they accept it?</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={primary} onClick={() => setAccepted(true)}>
                  They accept it
                </button>
                <button type="button" className={danger} disabled={busy} onClick={buyerRefuses}>
                  They refuse it
                </button>
              </div>
            </>
          ) : (
            <form
              className="mt-2 grid gap-3"
              onSubmit={event => {
                event.preventDefault();
                start(async () => take(await releaseOrder(centre, order.id, code), () => setCode("")));
              }}
            >
              <label className={label} htmlFor={`${ids}-code`}>
                The buyer&apos;s 6-digit release code
                <input id={`${ids}-code`} className={`${input} tracking-[0.3em]`} value={code} onChange={event => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} />
              </label>
              {order.release_tries_left !== null ? <p className="text-xs text-slate-600">{order.release_tries_left} tries left.</p> : null}
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={primary} disabled={busy || code.replace(/\s/g, "").length !== 6}>
                  Hand it over
                </button>
                <button type="button" className={secondary} onClick={() => setAccepted(false)}>
                  Back
                </button>
              </div>
            </form>
          )}
        </Panel>
      ) : null}

      {order.status === "released" ? (
        <Panel title="Collected" tone="good">
          <p>
            {order.released_at ? `Handed over ${when(order.released_at, country)}.` : null} Your centre earned {money(order.centre_earns, order.currency)}.
          </p>
        </Panel>
      ) : null}
      {order.status === "disputed" ? (
        <Panel title="With Udozo to decide" tone="warn">
          <p>Keep the item safe where it is. Udozo will tell you what happens next.</p>
        </Panel>
      ) : null}

      {order.dispatch_photos.length ? (
        <Panel title="The seller's photos">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {order.dispatch_photos.map((photo, index) => (
              <li key={photo.id}>
                <a href={`/api/centres/${centre}/orders/${order.id}/photos/${photo.id}`} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- read through this site's own server */}
                  <img src={`/api/centres/${centre}/orders/${order.id}/photos/${photo.id}`} alt={`Seller's photo ${index + 1}`} className="aspect-square w-full rounded-xl border border-slate-100 object-cover" loading="lazy" />
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {["paid", "sent", "at_centre", "disputed"].includes(order.status) ? (
        <Panel title="Post an update">
          <p className="text-sm">The buyer and the seller read it on their order.</p>
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={event => {
              event.preventDefault();
              start(async () => take(await postUpdate(centre, order.id, update), () => setUpdate("")));
            }}
          >
            <label className={`${label} min-w-0 flex-1`} htmlFor={`${ids}-update`}>
              Update
              <input id={`${ids}-update`} className={input} value={update} onChange={event => setUpdate(event.target.value)} maxLength={300} placeholder="Buyer came, will return tomorrow" />
            </label>
            <button type="submit" className={secondary} disabled={busy || update.trim().length < 3}>
              Post
            </button>
          </form>
        </Panel>
      ) : null}

      <Panel title="What happened">
        <ol className="grid gap-2">
          {order.events.map((event, index) => (
            <li key={`${event.at}-${index}`} className="text-sm">
              <strong className="text-navy-900">{eventWords[event.status] ?? event.status}</strong>
              <span className="text-slate-500"> · {when(event.at, country)}</span>
              {event.note ? <span className="block text-slate-600">{event.note}</span> : null}
            </li>
          ))}
          {order.events.length ? null : <li className="text-sm text-slate-600">Paid {order.paid_at ? when(order.paid_at, country) : ""}. Nothing yet from the seller.</li>}
        </ol>
      </Panel>
    </div>
  );
}
