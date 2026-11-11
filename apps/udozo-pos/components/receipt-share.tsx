"use client";

/* eslint-disable @next/next/no-img-element -- the QR code is drawn in the browser as a data address. */
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useId, useState, useTransition } from "react";
import { type PosReceiptCode, type PosReceipts, type ReceiptKind, sendText } from "@/lib/pos";
import { receiptCodeStatus, sendReceiptEmail, sendReceiptWhatsapp, showReceiptCode } from "@/lib/receipt-actions";

const primary = "flex h-12 items-center justify-center rounded-xl bg-pos-600 px-6 font-bold text-white hover:bg-pos-700 disabled:opacity-60";
const quiet = "flex h-12 items-center justify-center rounded-xl border border-pos-line bg-white px-5 font-semibold text-pos-ink hover:bg-pos-50";
const input = "mt-1 h-12 w-full rounded-xl border border-pos-line bg-white px-3 text-pos-ink focus:border-pos-600 focus:ring-2 focus:ring-pos-50 focus:outline-none";
const label = "block text-sm font-semibold text-pos-ink-2";
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

type Way = "qr" | "whatsapp" | "email" | "print";
const ways: Array<{ key: Way; label: string; hint: string }> = [
  { key: "qr", label: "Scan a QR code", hint: "They get the PDF on WhatsApp" },
  { key: "whatsapp", label: "Send to WhatsApp", hint: "To their mobile number" },
  { key: "email", label: "Email", hint: "The PDF attached" },
  { key: "print", label: "Print", hint: "On the till's printer" },
];

/** A code shown as a QR at the till, waiting until the customer has had the PDF (asked every 3 seconds, 10 minutes). */
function ScanPanel({ saleId, number }: { saleId: string; number: string }) {
  const router = useRouter();
  const [code, setCode] = useState<PosReceiptCode | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [kind, setKind] = useState<ReceiptKind>("receipt");
  const [message, setMessage] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [pending, start] = useTransition();
  const ids = useId();

  useEffect(() => {
    if (!code?.whatsapp_url) return;
    let alive = true;
    void QRCode.toDataURL(code.whatsapp_url, { errorCorrectionLevel: "M", margin: 1, width: 320 }).then(url => {
      if (alive) setQr(url);
    });
    return () => {
      alive = false;
    };
  }, [code?.whatsapp_url]);

  const waiting = Boolean(code && !code.used_at && !expired);
  const codeId = code?.id;
  useEffect(() => {
    if (!waiting || !codeId) return;
    const timer = window.setInterval(async () => {
      if (document.hidden) return;
      if (code && new Date(code.expires_at).getTime() < Date.now()) {
        setExpired(true);
        return;
      }
      const result = await receiptCodeStatus(saleId, codeId);
      if (!result.ok) return;
      setCode(current => (current ? { ...current, used_at: result.data.used_at, delivered_to: result.data.delivered_to } : current));
      if (result.data.used_at) router.refresh();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [waiting, codeId, code, saleId, router]);
  return (
    <div className="grid gap-3">
      <p className="text-pos-ink-2">They point their phone camera at the code. WhatsApp opens a chat with Udozo with &ldquo;Receipt {number}&rdquo; already typed; they tap send and the PDF arrives in seconds.</p>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="sr-only">What they get</legend>
        {(["receipt", "invoice"] as const).map(option => (
          <label key={option} className="flex items-center gap-2 font-semibold text-pos-ink">
            <input type="radio" name={`${ids}-kind`} checked={kind === option} onChange={() => setKind(option)} className="size-5 accent-pos-600" />
            {option === "receipt" ? "Receipt" : "A4 invoice"}
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        className={primary}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await showReceiptCode(saleId, kind);
            if (!result.ok) return setMessage(result.message);
            setMessage(null);
            setQr(null);
            setExpired(false);
            setCode(result.data);
          })
        }
      >
        {code ? "Show a new code" : "Show the QR code"}
      </button>
      {code ? (
        <div className="grid justify-items-center gap-2 rounded-xl bg-pos-50 p-4 text-center" role="status">
          {qr ? <img src={qr} alt={`QR code: get receipt ${number} on WhatsApp`} width={220} height={220} className="rounded-lg bg-white p-2" /> : <span className="h-[220px]" />}
          {code.used_at ? (
            <p className="font-semibold text-pos-700">
              PDF delivered{code.delivered_to ? ` to ${code.delivered_to}` : ""} at {clock(code.used_at)}.
            </p>
          ) : expired ? (
            <p className="font-semibold text-pos-error">The code expired. Show a new one.</p>
          ) : (
            <p className="text-pos-ink-2">Waiting for them to scan · the code works until {clock(code.expires_at)}</p>
          )}
          {code.whatsapp_url ? (
            <a href={code.whatsapp_url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold">
              Open on this device instead
            </a>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p role="alert" className="font-semibold text-pos-error">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function WhatsappPanel({ saleId, receipts }: { saleId: string; receipts: PosReceipts }) {
  const router = useRouter();
  const ids = useId();
  const [phone, setPhone] = useState(receipts.customer?.phone ?? "");
  const [invoice, setInvoice] = useState(false);
  const [save, setSave] = useState(true);
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const canSave = Boolean(receipts.customer && !receipts.customer.phone);
  return (
    <form
      className="grid gap-3"
      onSubmit={event => {
        event.preventDefault();
        start(async () => {
          const result = await sendReceiptWhatsapp(saleId, { phone, kind: invoice ? "invoice" : "receipt", save: canSave && save });
          if (!result.ok) return setState({ ok: false, message: result.message });
          setState({ ok: true, message: result.data.status === "failed" ? `Not sent: ${result.data.error ?? "WhatsApp would not take it."}` : `Sending to ${result.data.to}. If they have not written to Udozo today, they get a message with a Get receipt button that brings the PDF.` });
          router.refresh();
        });
      }}
    >
      <div>
        <label htmlFor={`${ids}-phone`} className={label}>
          Their mobile number
        </label>
        <input id={`${ids}-phone`} value={phone} onChange={event => setPhone(event.target.value)} inputMode="tel" autoComplete="off" required maxLength={20} placeholder="0803 123 4567" className={input} />
      </div>
      <label className="flex items-center gap-2 text-pos-ink">
        <input type="checkbox" checked={invoice} onChange={event => setInvoice(event.target.checked)} className="size-5 accent-pos-600" />
        Send the A4 invoice instead of the receipt
      </label>
      {canSave ? (
        <label className="flex items-center gap-2 text-pos-ink">
          <input type="checkbox" checked={save} onChange={event => setSave(event.target.checked)} className="size-5 accent-pos-600" />
          Keep this number for {receipts.customer!.name}
        </label>
      ) : null}
      <button type="submit" disabled={pending} className={primary}>
        Send PDF on WhatsApp
      </button>
      <p className="text-sm text-pos-muted">Sent from Udozo&apos;s WhatsApp number. They can reply to it to ask for a copy again.</p>
      {state ? (
        <p role={state.ok ? "status" : "alert"} className={state.ok ? "font-semibold text-pos-700" : "font-semibold text-pos-error"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function EmailPanel({ saleId, receipts }: { saleId: string; receipts: PosReceipts }) {
  const router = useRouter();
  const ids = useId();
  const [email, setEmail] = useState(receipts.customer?.email ?? "");
  const [attach, setAttach] = useState<ReceiptKind | "both">("receipt");
  const [save, setSave] = useState(true);
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const canSave = Boolean(receipts.customer && !receipts.customer.email);
  return (
    <form
      className="grid gap-3"
      onSubmit={event => {
        event.preventDefault();
        start(async () => {
          const result = await sendReceiptEmail(saleId, { email, attach, save: canSave && save });
          if (!result.ok) return setState({ ok: false, message: result.message });
          setState(result.data.status === "failed" ? { ok: false, message: result.data.error ?? "The email could not be sent." } : { ok: true, message: `Emailed to ${result.data.to}.` });
          router.refresh();
        });
      }}
    >
      <div>
        <label htmlFor={`${ids}-email`} className={label}>
          Their email
        </label>
        <input id={`${ids}-email`} type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="off" required maxLength={254} className={input} />
      </div>
      <fieldset className="flex flex-wrap gap-4">
        <legend className={label}>Attach</legend>
        {(
          [
            ["receipt", "Receipt"],
            ["invoice", "A4 invoice"],
            ["both", "Both"],
          ] as const
        ).map(([value, text]) => (
          <label key={value} className="flex items-center gap-2 font-semibold text-pos-ink">
            <input type="radio" name={`${ids}-attach`} checked={attach === value} onChange={() => setAttach(value)} className="size-5 accent-pos-600" />
            {text}
          </label>
        ))}
      </fieldset>
      {canSave ? (
        <label className="flex items-center gap-2 text-pos-ink">
          <input type="checkbox" checked={save} onChange={event => setSave(event.target.checked)} className="size-5 accent-pos-600" />
          Keep this email for {receipts.customer!.name}
        </label>
      ) : null}
      <button type="submit" disabled={pending} className={primary}>
        Send email
      </button>
      {state ? (
        <p role={state.ok ? "status" : "alert"} className={state.ok ? "font-semibold text-pos-700" : "font-semibold text-pos-error"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function PrintPanel({ saleId, receipts }: { saleId: string; receipts: PosReceipts }) {
  const ids = useId();
  const [width, setWidth] = useState<58 | 80>(receipts.print.width);
  const [gift, setGift] = useState(false);
  const query = `width=${width}${gift ? "&gift=1" : ""}`;
  return (
    <div className="grid gap-3">
      <div>
        <label htmlFor={`${ids}-width`} className={label}>
          Paper
        </label>
        <select id={`${ids}-width`} value={width} onChange={event => setWidth(event.target.value === "58" ? 58 : 80)} className={input}>
          <option value={80}>80 mm</option>
          <option value={58}>58 mm</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-pos-ink">
        <input type="checkbox" checked={gift} onChange={event => setGift(event.target.checked)} className="size-5 accent-pos-600" />
        Gift receipt (no prices)
      </label>
      {receipts.print.qr ? <p className="text-sm text-pos-muted">It carries the QR code that gets the PDF on WhatsApp.</p> : null}
      <div className="flex flex-wrap gap-3">
        <a href={`/print/${saleId}?${query}&auto=1`} target="_blank" rel="noopener" className={primary}>
          Print receipt
        </a>
        <a href={`/app/sales/${saleId}/pdf?${query}&download=1`} className={quiet}>
          Download PDF
        </a>
        <a href={`/app/sales/${saleId}/pdf?kind=invoice`} target="_blank" rel="noopener" className={quiet}>
          A4 invoice
        </a>
      </div>
    </div>
  );
}

/**
 * How the customer wants their receipt (S10): scanning a QR code for the PDF on WhatsApp, sent to their WhatsApp or
 * email, or printed (80 mm or 58 mm, a gift receipt, the A4 invoice), and what was sent already.
 */
export function ReceiptShare({ saleId, receipts }: { saleId: string; receipts: PosReceipts }) {
  const offered = ways.filter(way => receipts.whatsapp.available || (way.key !== "qr" && way.key !== "whatsapp"));
  const [way, setWay] = useState<Way>(offered[0]!.key);
  return (
    <section aria-labelledby="share-title" className="grid gap-4 rounded-[20px] bg-white p-5">
      <h2 id="share-title" className="font-display text-xl font-bold text-pos-ink">
        How does the customer want it?
      </h2>
      <div role="radiogroup" aria-label="How they get it" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {offered.map(option => (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={way === option.key}
            onClick={() => setWay(option.key)}
            className={`grid gap-0.5 rounded-xl border p-3 text-left ${way === option.key ? "border-pos-600 bg-pos-50" : "border-pos-line bg-white hover:bg-pos-50"}`}
          >
            <span className="font-semibold text-pos-ink">{option.label}</span>
            <span className="text-xs text-pos-muted">{option.hint}</span>
          </button>
        ))}
      </div>
      {!receipts.whatsapp.available && receipts.whatsapp.reason ? <p className="text-sm text-pos-muted">{receipts.whatsapp.reason}</p> : null}
      {way === "qr" ? <ScanPanel saleId={saleId} number={receipts.number} /> : null}
      {way === "whatsapp" ? <WhatsappPanel saleId={saleId} receipts={receipts} /> : null}
      {way === "email" ? <EmailPanel saleId={saleId} receipts={receipts} /> : null}
      {way === "print" ? <PrintPanel saleId={saleId} receipts={receipts} /> : null}
      {receipts.sends.length ? (
        <div className="border-t border-pos-line pt-3">
          <h3 className="font-semibold text-pos-ink">Sent</h3>
          <ul className="mt-1 grid gap-1 text-sm text-pos-ink-2">
            {receipts.sends.map(send => (
              <li key={send.id}>
                {sendText(send)} <span className="text-pos-muted">· {clock(send.created_at)}{send.by ? `, ${send.by}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
