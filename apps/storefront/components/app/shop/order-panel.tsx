"use client";

/* eslint-disable @next/next/no-img-element -- dispute photos are private: read through this site with the customer's session. */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Camera, Check, LoaderCircle, ShieldCheck, Truck } from "lucide-react";
import { disputeReasonLabels, shopMoney, type ShopCourier, type ShopDispute, type ShopDisputeMessage, type ShopDisputeReason, type ShopOrder, type ShopReadiness, type ShopShipmentStatus, shipmentLabels } from "@bitocard/api-client/classifieds";
import { compressImage } from "@bitocard/ui/image";
import { localPhotoUrl, type OrderAction } from "@/lib/shop";
import { ShopTermsAccept, shopTermsCode } from "@bitocard/ui/shop-terms";
import { acceptShopTerms, disputeMessage, enterReleaseCode, openDispute, orderStep, releaseCode, shipmentUpdate, shopTerms } from "@/lib/shop-actions";

const nonce = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`.replace(/\./g, ""));
const primary = "flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-navy-900 px-5 font-bold text-white hover:bg-navy-700 disabled:opacity-60";
const secondary = "flex h-12 w-full items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 font-bold text-navy-900 hover:border-slate-400 disabled:opacity-60";
const green = "flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-5 font-bold text-white hover:bg-emerald-800 disabled:opacity-60";

/**
 * What the reader of a Safe pay order does now, by side and state (the design canvas's SellerAccept, BuyerOrder,
 * EnterCode and Dispute boards): the seller accepts (set-up first), hands over and enters the buyer's code or marks it
 * sent; the buyer pays from their wallet, shows their release code, confirms a delivery or reports a problem; either
 * side cancels before the hand-over. The API decides; this only offers what it would allow.
 */
export function OrderPanel({
  order,
  actions,
  readiness,
  balance,
  addFundsHref,
  chatHref,
  couriers = [],
}: {
  order: ShopOrder;
  actions: OrderAction[];
  readiness: ShopReadiness | null;
  balance: number | null;
  addFundsHref: string;
  chatHref: string | null;
  /** The couriers offered in the seller's country, for shipping. */
  couriers?: ShopCourier[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [code, setCode] = useState<{ value: string; tries: number } | null>(null);
  const [entered, setEntered] = useState("");
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState<ShopDisputeReason>("not_as_described");
  const [details, setDetails] = useState("");
  const has = (action: OrderAction) => actions.includes(action);
  const total = order.total ?? order.price;
  const short = balance !== null && balance < total ? total - balance : 0;
  // Accepting needs the BitoCard Shop terms accepted: the step waiting for them, retried once they are.
  const [termsFor, setTermsFor] = useState<Parameters<typeof orderStep>[1] | null>(null);
  const run = (task: () => Promise<{ ok: boolean; message?: string; code?: string | null }>, retry?: Parameters<typeof orderStep>[1]) => {
    setError(null);
    start(async () => {
      const result = await task();
      if (result.ok) return router.refresh();
      if (retry && result.code === shopTermsCode) return setTermsFor(retry);
      setError(result.message ?? "Something went wrong. Try again.");
    });
  };
  const step = (name: Parameters<typeof orderStep>[1], input: Parameters<typeof orderStep>[2] = {}) => run(() => orderStep(order.id, name, input).then(result => (result.ok ? result : { ok: false, message: result.message, code: result.code })), name);

  return (
    <div className="grid gap-4">
      {has("accept") ? (
        <section aria-labelledby="answer" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 id="answer" className="font-bold">
            {order.kind === "resale" ? `New order through ${order.store?.name ?? "a reseller’s store"}` : "Answer the request"}
          </h2>
          {order.kind === "resale" ? <p className="text-sm text-slate-600">The buyer has paid: their money is locked until you accept, then held by BitoCard until they have the item. Accept only if you can hand it over or ship it in time.</p> : null}
          {readiness && !readiness.ready ? (
            <div className="grid gap-2">
              <p className="text-sm text-slate-600">{readiness.limited ? `You cannot take Safe pay orders right now (${readiness.strikes} of ${readiness.strike_limit} strikes in 90 days). You can still chat and sell directly.` : "First Safe pay sale: two quick steps."}</p>
              {!readiness.limited ? (
                <ol className="grid gap-2">
                  <SetupStep done={readiness.identity_checked} label={readiness.identity_checked ? "Identity check passed" : "Pass the identity check"} href="/account/verification" />
                  <SetupStep done={readiness.payout_account} label={readiness.payout_account ? "Payout account added" : "Add a payout account in your verified name"} href="/account/crypto/cash-out" />
                </ol>
              ) : null}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const why = window.prompt(order.kind === "resale" ? "Decline the order? The buyer gets their money back. You can say why (optional)." : "Decline the request? You can say why (optional).");
                if (why !== null) step("decline", { reason: why });
              }}
              className={secondary}
            >
              Decline
            </button>
            <button type="button" disabled={pending || (readiness ? !readiness.ready : false)} onClick={() => step("accept")} className={green}>
              Accept
            </button>
          </div>
        </section>
      ) : null}

      {has("pay") ? (
        <section aria-labelledby="pay" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 id="pay" className="font-bold">
            Pay from your wallet
          </h2>
          <p className="text-sm text-slate-600">
            {balance === null ? "Your wallet balance could not be read just now." : `Balance ${shopMoney(balance, order.currency)}${short ? `: add ${shopMoney(short, order.currency)} first.` : "."}`}
          </p>
          {short ? (
            <a href={addFundsHref} className={secondary}>
              Add funds
            </a>
          ) : null}
          <button type="button" disabled={pending || Boolean(short)} onClick={() => step("pay", { nonce: nonce() })} className={green}>
            <ShieldCheck className="size-5" aria-hidden="true" />
            Pay {shopMoney(total, order.currency)}
          </button>
        </section>
      ) : null}

      {has("release_code") ? (
        <section aria-labelledby="code" className="grid gap-3 rounded-2xl bg-navy-900 p-5 text-white">
          <h2 id="code" className="font-bold">
            Your release code
          </h2>
          <p className="text-sm text-white/80">Check the item first. Then tell {order.with.name} this code: it releases the payment to them at once.</p>
          <div aria-label={code ? `Release code ${code.value.split("").join(" ")}` : "Release code hidden"} className="flex justify-center gap-2">
            {(code?.value ?? "••••••").split("").map((digit, index) => (
              <span key={index} className="grid h-14 w-11 place-items-center rounded-xl bg-white/10 text-2xl font-extrabold">
                {digit}
              </span>
            ))}
          </div>
          {code ? null : (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const result = await releaseCode(order.id);
                  if (result.ok) setCode({ value: result.data.code, tries: result.data.tries_left });
                  return result.ok ? { ok: true } : { ok: false, message: result.message };
                })
              }
              className="h-11 rounded-xl bg-white font-bold text-navy-900"
            >
              Show code
            </button>
          )}
          <span className="text-center text-xs text-white/70">Never send it in chat or before you have checked the item.</span>
        </section>
      ) : null}

      {has("enter_code") ? (
        <section aria-labelledby="enter" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 id="enter" className="font-bold">
            Hand over and get paid
          </h2>
          <p className="text-sm text-slate-600">BitoCard is holding the buyer’s payment. Let {order.with.name} check the item. When they are happy they tell you a 6-digit code.</p>
          <label className="grid gap-1.5 text-sm font-semibold">
            The buyer’s release code
            <input
              value={entered}
              onChange={event => setEntered(event.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="h-14 rounded-xl border border-slate-300 text-center text-2xl font-extrabold tracking-[0.5em]"
            />
          </label>
          <span className="text-xs text-slate-500">{order.release_tries_left ?? 5} tries left. The code is only ever shown on the buyer’s phone.</span>
          <button type="button" disabled={pending || entered.length !== 6} onClick={() => run(() => enterReleaseCode(order.id, entered).then(result => (result.ok ? result : { ok: false, message: result.message })))} className={green}>
            <Check className="size-5" aria-hidden="true" />
            Confirm and get {shopMoney(order.payout ?? order.price, order.currency)}
          </button>
          {chatHref ? (
            <a href={chatHref} className="text-center text-sm font-semibold text-brand-700 hover:underline">
              The buyer won’t give the code? Message them
            </a>
          ) : null}
        </section>
      ) : null}

      {has("sent") ? <ShipForm order={order} couriers={couriers} pending={pending} onShip={input => step("sent", input)} /> : null}

      {has("shipment") ? (
        <section aria-labelledby="tracking" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 id="tracking" className="font-bold">
            Where is the parcel?
          </h2>
          <p className="text-sm text-slate-600">Update the buyer as it moves. Once it is delivered they have a few days to confirm it arrived in good condition, or it is released to you.</p>
          <div className="grid grid-cols-2 gap-2">
            {(["in_transit", "out_for_delivery", "failed_attempt", "returned"] as ShopShipmentStatus[]).map(status => (
              <button key={status} type="button" disabled={pending} onClick={() => run(() => shipmentUpdate(order.id, status).then(result => (result.ok ? result : { ok: false, message: result.message })))} className={secondary}>
                {shipmentLabels[status]}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Mark it delivered? Only once the courier has handed it to the buyer.")) run(() => shipmentUpdate(order.id, "delivered").then(result => (result.ok ? result : { ok: false, message: result.message })));
            }}
            className={green}
          >
            <Check className="size-5" aria-hidden="true" />
            Delivered
          </button>
        </section>
      ) : null}

      {has("received") ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`It arrived as described? ${order.with.name} is paid at once.`)) step("received");
          }}
          className={green}
        >
          <Check className="size-5" aria-hidden="true" />
          It arrived: release the payment
        </button>
      ) : null}

      {has("dispute") && !disputing ? (
        <button type="button" onClick={() => setDisputing(true)} className="justify-self-start text-sm font-semibold text-brand-700 hover:underline">
          Report a problem
        </button>
      ) : null}
      {disputing ? (
        <section aria-labelledby="problem" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 id="problem" className="font-bold">
            Report a problem
          </h2>
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Opening a dispute stops the payment to the seller. BitoCard reads both sides and decides, usually within 3 working days.</p>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold">What happened?</legend>
            {(Object.keys(disputeReasonLabels) as ShopDisputeReason[]).map(item => (
              <label key={item} className={`flex min-h-11 items-center gap-2.5 rounded-xl border px-3 text-sm ${reason === item ? "border-navy-900 ring-1 ring-navy-900" : "border-slate-200"}`}>
                <input type="radio" name="reason" value={item} checked={reason === item} onChange={() => setReason(item)} className="accent-navy-900" />
                {disputeReasonLabels[item]}
              </label>
            ))}
          </fieldset>
          <label className="grid gap-1.5 text-sm font-semibold">
            Tell us more
            <textarea value={details} onChange={event => setDetails(event.target.value)} rows={4} maxLength={2000} className="rounded-xl border border-slate-300 px-3 py-2 font-normal" />
          </label>
          <p className="text-xs text-slate-600">You can add photos once it is open. BitoCard can decide a full refund (fee included), a part refund, or paying the seller.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setDisputing(false)} className={secondary}>
              Not now
            </button>
            <button type="button" disabled={pending} onClick={() => run(() => openDispute(order.id, reason, details, nonce()).then(result => (result.ok ? result : { ok: false, message: result.message })))} className={primary}>
              Open dispute
            </button>
          </div>
        </section>
      ) : null}

      {has("cancel") ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            const question =
              order.status === "paid"
                ? order.role === "buyer"
                  ? "Cancel the order? You are refunded in full, fee included."
                  : "Cancel the order? The buyer is refunded in full, and it counts against you."
                : order.status === "locked"
                  ? "Cancel the order? Your money is unlocked straight away."
                  : "Cancel this request?";
            if (window.confirm(question)) step("cancel");
          }}
          className="justify-self-start text-sm font-semibold text-slate-600 hover:text-navy-900 hover:underline"
        >
          {order.status === "requested" && order.role === "buyer" ? "Cancel the request" : "Cancel the order"}
        </button>
      ) : null}

      {pending ? <LoaderCircle className="size-5 animate-spin text-slate-500" aria-label="Working" /> : null}
      {termsFor ? (
        <ShopTermsAccept
          load={shopTerms}
          accept={acceptShopTerms}
          onAccepted={() => {
            const retry = termsFor;
            setTermsFor(null);
            step(retry);
          }}
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-semibold text-brand-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Shipping a paid delivery: at least two dispatch photos (the item, the parcel sealed), the courier (the country's, or
 * another by name) and its tracking number, then Mark as shipped. Photos go up through this site to the order.
 */
function ShipForm({ order, couriers, pending, onShip }: { order: ShopOrder; couriers: ShopCourier[]; pending: boolean; onShip: (input: { courier: string; tracking_number: string; tracking_url?: string; tracking_note?: string }) => void }) {
  const router = useRouter();
  const [courier, setCourier] = useState(couriers[0]?.name ?? "");
  const [other, setOther] = useState("");
  const [number, setNumber] = useState("");
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photos = order.shipment?.dispatch_photos ?? [];
  const listed = couriers.find(item => item.name === courier);
  const name = courier === "other" || !couriers.length ? other.trim() : courier;
  const ready = photos.length >= 2 && name.length >= 2 && number.trim().length >= 3;
  const upload = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    setError(null);
    for (const file of files.slice(0, 8 - photos.length)) {
      try {
        const form = new FormData();
        form.set("file", await compressImage(file, undefined, type => type.startsWith("image/")), "dispatch.jpg");
        const res = await fetch(`/api/shop/orders/${order.id}/dispatch-photos`, { method: "POST", body: form });
        const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) setError(json?.error?.message ?? "This photo could not be added.");
      } catch {
        setError("This photo could not be added. Try again.");
      }
    }
    setUploading(false);
    router.refresh();
  };
  return (
    <section aria-labelledby="ship" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 id="ship" className="flex items-center gap-2 font-bold">
        <Truck className="size-5" aria-hidden="true" /> Ship it with tracking
      </h2>
      {order.delivery_address || order.buyer_details?.address ? (
        <p className="rounded-xl bg-slate-50 p-3 text-sm whitespace-pre-line">
          <strong className="block text-xs text-slate-500">Deliver to</strong>
          {order.buyer_details?.address ?? order.delivery_address}
        </p>
      ) : null}
      <div className="grid gap-2">
        <p className="text-sm font-semibold">1. Photos before you send it</p>
        <p className="text-xs text-slate-600">At least two: the item itself, and the parcel sealed for shipping. They settle any question of damage.</p>
        <ul className="flex flex-wrap gap-2">
          {photos.map(photo =>
            localPhotoUrl(photo.url) ? (
              <li key={photo.id} className="size-16 overflow-hidden rounded-xl bg-slate-100">
                <img src={localPhotoUrl(photo.url)!} alt="Dispatch photo" className="size-full object-cover" loading="lazy" />
              </li>
            ) : null,
          )}
          {photos.length < 8 ? (
            <li>
              <label className="grid size-16 cursor-pointer place-items-center rounded-xl border-2 border-dashed border-slate-300 text-slate-500 hover:border-slate-400">
                {uploading ? <LoaderCircle className="size-5 animate-spin" aria-label="Adding" /> : <Camera className="size-5" aria-label="Add photos" />}
                <input type="file" accept="image/*" multiple className="sr-only" disabled={uploading} onChange={event => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    void upload(files);
                  }}
                />
              </label>
            </li>
          ) : null}
        </ul>
        <span className="text-xs text-slate-500">{photos.length} of at least 2</span>
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-semibold">2. The courier and tracking number</p>
        {couriers.length ? (
          <label className="grid gap-1.5 text-sm">
            Courier
            <select value={courier} onChange={event => setCourier(event.target.value)} className="h-11 rounded-xl border border-slate-300 bg-white px-3">
              {couriers.map(item => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
              <option value="other">Another courier</option>
            </select>
          </label>
        ) : null}
        {courier === "other" || !couriers.length ? (
          <label className="grid gap-1.5 text-sm">
            Courier’s name
            <input value={other} onChange={event => setOther(event.target.value)} maxLength={60} className="h-11 rounded-xl border border-slate-300 px-3" />
          </label>
        ) : null}
        <label className="grid gap-1.5 text-sm">
          Tracking number
          <input value={number} onChange={event => setNumber(event.target.value)} maxLength={60} autoComplete="off" className="h-11 rounded-xl border border-slate-300 px-3" />
        </label>
        {!listed?.tracking_url ? (
          <label className="grid gap-1.5 text-sm">
            Tracking link <span className="text-slate-500">(optional, https)</span>
            <input value={link} onChange={event => setLink(event.target.value)} inputMode="url" maxLength={500} className="h-11 rounded-xl border border-slate-300 px-3" />
          </label>
        ) : null}
        <label className="grid gap-1.5 text-sm">
          Note for the buyer <span className="text-slate-500">(optional)</span>
          <input value={note} onChange={event => setNote(event.target.value)} maxLength={300} className="h-11 rounded-xl border border-slate-300 px-3" />
        </label>
      </div>
      <button type="button" disabled={pending || uploading || !ready} onClick={() => onShip({ courier: name, tracking_number: number, tracking_url: link || undefined, tracking_note: note || undefined })} className={primary}>
        Mark as shipped
      </button>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-brand-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function SetupStep({ done, label, href }: { done: boolean; label: string; href: string }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm">
      <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${done ? "bg-emerald-700 text-white" : "border-2 border-slate-300"}`}>{done ? <Check className="size-4" aria-hidden="true" /> : null}</span>
      <span className="min-w-0 flex-1">{label}</span>
      {done ? null : (
        <a href={href} className="font-semibold text-brand-700 hover:underline">
          Start
        </a>
      )}
    </li>
  );
}

/** The dispute's thread: both sides and BitoCard, with photos; either side adds to it while it is open. */
export function DisputeThread({ dispute }: { dispute: ShopDispute }) {
  const [messages, setMessages] = useState<ShopDisputeMessage[]>(dispute.messages);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = (message: ShopDisputeMessage) => setMessages(current => [...current, message]);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    const result = await disputeMessage(dispute.order_id, text);
    if (result.ok) {
      add(result.data);
      setText("");
    } else setError(result.message);
    setBusy(false);
  };
  const photo = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", await compressImage(file, undefined, type => type.startsWith("image/")), "photo.jpg");
      if (text.trim()) form.set("body", text.trim());
      const res = await fetch(`/api/shop/orders/${dispute.order_id}/dispute`, { method: "POST", body: form });
      const json = (await res.json().catch(() => null)) as (ShopDisputeMessage & { error?: { message?: string } }) | null;
      if (!res.ok || !json?.id) setError(json?.error?.message ?? "This photo could not be added.");
      else {
        add(json);
        setText("");
      }
    } catch {
      setError("This photo could not be added. Try again.");
    }
    setBusy(false);
  };
  return (
    <section aria-labelledby="dispute" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 id="dispute" className="font-bold">
        Dispute: {disputeReasonLabels[dispute.reason]}
      </h2>
      <p className="text-sm text-slate-600">
        {dispute.status === "open"
          ? "BitoCard is reading both sides. Add anything that helps: what happened, and photos."
          : `Decided${dispute.decision === "refund" ? ": refunded in full" : dispute.decision === "partial" ? ": part refunded" : dispute.decision === "release" ? ": paid to the seller" : ""}.${dispute.note ? ` ${dispute.note}` : ""}`}
      </p>
      <ol className="grid gap-2">
        {messages.map(message => (
          <li key={message.id} className={`grid max-w-md gap-1 rounded-2xl px-3 py-2 text-sm ${message.from === "me" ? "justify-self-end bg-navy-900 text-white" : message.from === "bitocard" ? "justify-self-center bg-amber-50 text-amber-950" : "justify-self-start bg-slate-100"}`}>
            <span className="text-[11px] font-semibold opacity-70">{message.from === "me" ? "You" : message.from === "bitocard" ? "BitoCard" : (message.name ?? "The other side")}</span>
            {message.photo && localPhotoUrl(message.photo.url) ? (
              <a href={localPhotoUrl(message.photo.url)!} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl">
                <img src={localPhotoUrl(message.photo.url)!} alt={message.body || "A photo"} className="max-h-56 w-full object-cover" loading="lazy" />
              </a>
            ) : null}
            {message.body ? <span className="whitespace-pre-wrap">{message.body}</span> : null}
          </li>
        ))}
      </ol>
      {dispute.status === "open" ? (
        <div className="flex items-end gap-2">
          <label aria-label="Add a photo" className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-slate-300 hover:border-slate-400">
            <Camera className="size-5" aria-hidden="true" />
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={busy}
              onChange={event => {
                void photo(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          <textarea value={text} onChange={event => setText(event.target.value)} rows={1} maxLength={2000} placeholder="Add to the dispute" aria-label="Add to the dispute" className="min-h-11 flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2.5 text-[15px]" />
          <button type="button" disabled={busy || !text.trim()} onClick={() => void send()} className="h-11 shrink-0 rounded-xl bg-navy-900 px-4 text-sm font-bold text-white disabled:opacity-60">
            Send
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-semibold text-brand-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
