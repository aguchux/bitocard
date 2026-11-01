"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { sendContact } from "@/lib/contact-actions";
import { contactKinds } from "@/lib/help";

const inputClass = "min-h-12 w-full rounded-xl border border-navy-200 bg-white px-3.5 text-[15px] text-navy-900 focus:border-navy-500 focus:ring-2 focus:ring-brand-500/30 aria-[invalid=true]:border-brand-700";
const labelClass = "text-sm font-semibold text-navy-900";

type Field = "kind" | "name" | "email" | "phone" | "body";
type Values = Record<Field, string>;

/** What is wrong with the form before it is sent, in the API's own limits; null when it can go. */
export function contactProblem(values: Values): { field: Field; message: string } | null {
  if (!values.kind) return { field: "kind", message: "Choose what your message is about." };
  if (values.name.trim().length < 2) return { field: "name", message: "Enter your full name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) return { field: "email", message: "Enter the email address we should reply to." };
  if (values.phone.trim() && !/^\+?[\d\s()-]{6,24}$/.test(values.phone.trim())) return { field: "phone", message: "Enter a phone number, or leave it empty." };
  if (values.body.trim().length < 10) return { field: "body", message: "Tell us a little more: at least 10 characters." };
  return null;
}

/**
 * The Contact us form: what it is about, name, email (where the reply goes), an optional phone and the message, sent to
 * Udozo's support team. A signed-in customer's name and email start filled in. Once sent it shows the reference, which
 * the receipt email repeats.
 */
export function ContactForm({ initial, country }: { initial: { name: string; email: string; phone: string }; country: string | null }) {
  const [values, setValues] = useState<Values>({ kind: "", name: initial.name, email: initial.email, phone: initial.phone, body: "" });
  const [problem, setProblem] = useState<{ field: Field | null; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const nonce = useRef<string | null>(null);

  const set = (field: Field) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setValues(current => ({ ...current, [field]: event.target.value }));
    if (problem?.field === field) setProblem(null);
  };
  const invalid = (field: Field) => (problem?.field === field ? true : undefined);
  const describedBy = (field: Field) => (problem?.field === field ? "contact-problem" : undefined);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const local = contactProblem(values);
    if (local) return setProblem(local);
    setBusy(true);
    // One key per message: sending twice by mistake sends it once.
    nonce.current ??= crypto.randomUUID();
    const result = await sendContact({ ...values, country, nonce: nonce.current });
    setBusy(false);
    if (result.ok) {
      setSent(result.data.reference);
      return;
    }
    // A refusal (other than a repeat) may be fixed and sent again as a new message.
    nonce.current = null;
    setProblem({ field: result.field, message: result.message });
  };

  if (sent) {
    return (
      <div className="grid justify-items-start gap-3 py-6" role="status">
        <CheckCircle2 className="size-10 text-mint-700" aria-hidden="true" />
        <h2 className="text-xl font-bold text-navy-900">Thank you: we have your message</h2>
        <p className="text-[15px] text-navy-700">
          Your reference is <strong className="text-navy-900">{sent}</strong>. We have emailed it to {values.email.trim()}, and we will reply to that address, usually within one working day.
        </p>
        <button
          type="button"
          onClick={() => {
            setSent(null);
            nonce.current = null;
            setValues(current => ({ ...current, kind: "", body: "" }));
          }}
          className="min-h-11 rounded-xl border border-navy-200 px-4 font-semibold text-navy-900 hover:border-navy-300"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <div className="grid gap-1.5">
        <label htmlFor="contact-kind" className={labelClass}>
          What is it about?
        </label>
        <select id="contact-kind" value={values.kind} onChange={set("kind")} aria-invalid={invalid("kind")} aria-describedby={describedBy("kind")} className={inputClass} required>
          <option value="">Choose a topic</option>
          {contactKinds.map(kind => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="contact-name" className={labelClass}>
          Full name
        </label>
        <input id="contact-name" value={values.name} onChange={set("name")} autoComplete="name" maxLength={120} aria-invalid={invalid("name")} aria-describedby={describedBy("name")} className={inputClass} placeholder="Your full name" required />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor="contact-email" className={labelClass}>
            Email address
          </label>
          <input id="contact-email" type="email" value={values.email} onChange={set("email")} autoComplete="email" maxLength={254} aria-invalid={invalid("email")} aria-describedby={describedBy("email")} className={inputClass} placeholder="Where we reply" required />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="contact-phone" className={labelClass}>
            Phone number <span className="font-normal text-navy-500">(optional)</span>
          </label>
          <input id="contact-phone" type="tel" value={values.phone} onChange={set("phone")} autoComplete="tel" maxLength={24} aria-invalid={invalid("phone")} aria-describedby={describedBy("phone")} className={inputClass} placeholder="If a call would help" />
        </div>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="contact-body" className={labelClass}>
          Message
        </label>
        <textarea
          id="contact-body"
          rows={6}
          value={values.body}
          onChange={set("body")}
          maxLength={3000}
          aria-invalid={invalid("body")}
          aria-describedby={describedBy("body") ?? "contact-body-hint"}
          className={`${inputClass} py-3`}
          placeholder="Tell us what happened, with an order or listing number if there is one."
          required
        />
        <p id="contact-body-hint" className="text-xs text-navy-500">
          Never send a password, a code we texted you or a Safe pay release code. We will never ask for them.
        </p>
      </div>
      {problem ? (
        <p id="contact-problem" role="alert" className="rounded-xl bg-brand-50 px-3.5 py-2.5 text-sm font-semibold text-brand-700">
          {problem.message}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 text-[15px] font-bold text-white hover:bg-brand-600 disabled:opacity-70">
        {busy ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : null} {busy ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
