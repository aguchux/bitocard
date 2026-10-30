"use client";

import { useId, useState } from "react";
import { Building2, ShieldCheck, User } from "lucide-react";
import { Button, Field, Input, Notice, Select, Textarea } from "@bitocard/admin-ui";
import type { KycBusinessType, KycCase } from "@bitocard/api-client/kyc";
import { brand } from "@/lib/brand";
import { type CaseResult, type CaseStep, saveStep } from "@/lib/client";

/** Saves one step and hands the new case back; the API's message (and the field it names) stays on the form. */
function useSave(step: CaseStep, onSaved: (kase: KycCase) => void) {
  const [error, setError] = useState<{ message: string; param: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async (body: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    const result: CaseResult = await saveStep(step, body);
    setSaving(false);
    if (result.ok) onSaved(result.case);
    else setError({ message: result.message, param: result.param });
  };
  return { error, saving, save };
}

/** Consent first: what is collected, why, who sees it, and the privacy notice. */
export function ConsentStep({ kase, privacyUrl, onSaved }: { kase: KycCase; privacyUrl: string | null; onSaved: (kase: KycCase) => void }) {
  const [agreed, setAgreed] = useState(kase.consented);
  const { error, saving, save } = useSave("consent", onSaved);
  const customer = kase.subject === "customer";
  return (
    <div className="space-y-5">
      <div className="space-y-3 text-sm text-ink">
        <p>
          {customer
            ? brand.key === "udozo"
              ? `${kase.brand.name} needs to confirm who you are before you can sell with Safe pay or be paid out. It takes about five minutes.`
              : `${kase.brand.name} needs to confirm who you are before you can buy some products. It takes about five minutes.`
            : `${brand.name} needs to confirm who runs your business before your account can take live orders. It takes about five minutes.`}
        </p>
        <p className="font-semibold">You will need</p>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          {kase.kind === "kyb" ? <li>If your business is registered: its registration certificate, a proof of address from the last three months, and a document naming its directors or owners.</li> : null}
          <li>{`An accepted ID document from ${kase.country_name}.`}</li>
          <li>A phone or computer with a camera, for a selfie and a short liveness check.</li>
        </ul>
        <p className="font-semibold">Who sees your documents</p>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>{`${brand.name} reviews them. A person checks your ID and compares your face with its photo; nothing is decided automatically.`}</li>
          {customer && brand.review ? <li>{`If ${kase.brand.name} is a registered business that BitoCard has verified, its team may review your check instead.`}</li> : null}
          <li>They are stored privately and encrypted, never made public, and kept only as long as the law requires.</li>
        </ul>
      </div>
      <label className="flex items-start gap-3 rounded-xl border border-line bg-white p-4 text-sm">
        <input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-brand-500" />
        <span>
          {`I agree to ${brand.name} processing my ID document and photos of my face, including a comparison of my face with my ID (biometric data), to check my identity`}
          {privacyUrl ? (
            <>
              {", as the "}
              <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 underline">
                privacy notice
              </a>
              {" explains."}
            </>
          ) : (
            "."
          )}
        </span>
      </label>
      {error ? <Notice tone="red">{error.message}</Notice> : null}
      <Button className="min-h-12 w-full text-base" icon={<ShieldCheck className="size-5" aria-hidden />} disabled={!agreed} loading={saving} onClick={() => void save({ consent: true })}>
        Agree and continue
      </Button>
    </div>
  );
}

const businessTypes: Array<{ value: KycBusinessType; title: string; text: string; icon: typeof User }> = [
  {
    value: "unregistered",
    title: "Not registered",
    text: "You trade in your own name, without a registered company or business name. We check your ID only.",
    icon: User,
  },
  {
    value: "registered",
    title: "Registered business",
    text: `Your business is registered with the government (for example the CAC in Nigeria). We check its documents and your ID.${brand.review ? " Verified registered businesses can review their own customers’ ID checks." : ""}`,
    icon: Building2,
  },
];

/** KYB: registered or not; a registered business gives its name, number and address (its documents follow). */
export function BusinessStep({ kase, onSaved }: { kase: KycCase; onSaved: (kase: KycCase) => void }) {
  const id = useId();
  const [type, setType] = useState<KycBusinessType | null>(kase.business_type);
  const [name, setName] = useState(kase.business?.registered_name ?? "");
  const [number, setNumber] = useState(kase.business?.registration_number ?? "");
  const [address, setAddress] = useState(kase.business?.business_address ?? "");
  const { error, saving, save } = useSave("business", onSaved);
  const fieldError = (param: string) => (error?.param === param ? error.message : undefined);
  const registered = type === "registered";
  const complete = type === "unregistered" || (registered && name.trim() && number.trim() && address.trim());

  return (
    <form
      className="space-y-5"
      onSubmit={event => {
        event.preventDefault();
        if (!type || !complete) return;
        void save(registered ? { business_type: type, registered_name: name.trim(), registration_number: number.trim(), business_address: address.trim() } : { business_type: type });
      }}
    >
      <fieldset className="grid gap-3">
        <legend className="mb-2 text-sm font-semibold">Is your business registered?</legend>
        {businessTypes.map(option => (
          <label key={option.value} className={`flex cursor-pointer items-start gap-3 rounded-xl border bg-white p-4 ${type === option.value ? "border-brand-500 ring-2 ring-brand-100" : "border-line"}`}>
            <input type="radio" name="business_type" value={option.value} checked={type === option.value} onChange={() => setType(option.value)} className="mt-1 size-5 shrink-0 accent-brand-500" />
            <span>
              <span className="flex items-center gap-2 font-semibold">
                <option.icon className="size-4 text-brand-600" aria-hidden />
                {option.title}
              </span>
              <span className="mt-1 block text-sm text-muted">{option.text}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {registered ? (
        <div className="space-y-4">
          <Field label="Registered name" htmlFor={`${id}-name`} hint="Exactly as on the registration certificate." error={fieldError("registered_name")}>
            <Input id={`${id}-name`} value={name} onChange={event => setName(event.target.value)} autoComplete="organization" maxLength={200} required />
          </Field>
          <Field label="Registration number" htmlFor={`${id}-number`} hint="For example RC 1234567 or BN 1234567." error={fieldError("registration_number")}>
            <Input id={`${id}-number`} value={number} onChange={event => setNumber(event.target.value)} maxLength={60} required />
          </Field>
          <Field label="Business address" htmlFor={`${id}-address`} hint="Where the business operates. Your proof of address must show it." error={fieldError("business_address")}>
            <Textarea id={`${id}-address`} value={address} onChange={event => setAddress(event.target.value)} autoComplete="street-address" maxLength={300} rows={3} required />
          </Field>
        </div>
      ) : null}
      {error && !["registered_name", "registration_number", "business_address"].includes(error.param ?? "") ? <Notice tone="red">{error.message}</Notice> : null}
      <Button type="submit" className="min-h-12 w-full text-base" disabled={!complete} loading={saving}>
        Continue
      </Button>
    </form>
  );
}

/** Today's date as YYYY-MM-DD, for the date of birth's limit. */
const today = () => new Date().toISOString().slice(0, 10);

/** The ID chosen and the details printed on it. */
export function IdentityStep({ kase, onSaved }: { kase: KycCase; onSaved: (kase: KycCase) => void }) {
  const id = useId();
  const [type, setType] = useState(kase.identity?.id_type ?? kase.id_types[0]?.code ?? "");
  const [number, setNumber] = useState("");
  const [name, setName] = useState(kase.identity?.full_name ?? "");
  const [birth, setBirth] = useState(kase.identity?.date_of_birth ?? "");
  const { error, saving, save } = useSave("identity", onSaved);
  const fieldError = (param: string) => (error?.param === param ? error.message : undefined);
  const saved = Boolean(kase.identity);

  return (
    <form
      className="space-y-4"
      onSubmit={event => {
        event.preventDefault();
        void save({ id_type: type, id_number: number.trim(), full_name: name.trim(), date_of_birth: birth });
      }}
    >
      <Field label="ID type" htmlFor={`${id}-type`} hint={`Accepted in ${kase.country_name}. It must be valid (not expired).`} error={fieldError("id_type")}>
        <Select id={`${id}-type`} value={type} onChange={event => setType(event.target.value)} required>
          {kase.id_types.map(option => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="ID number" htmlFor={`${id}-number`} hint={saved ? `Saved as ${kase.identity?.id_number_hint}. Enter it again to change any detail.` : "As printed on the document."} error={fieldError("id_number")}>
        <Input id={`${id}-number`} value={number} onChange={event => setNumber(event.target.value)} autoComplete="off" spellCheck={false} maxLength={40} required />
      </Field>
      <Field label="Full name, as on the ID" htmlFor={`${id}-name`} hint="Every name, in the same order as the document." error={fieldError("full_name")}>
        <Input id={`${id}-name`} value={name} onChange={event => setName(event.target.value)} autoComplete="name" maxLength={200} required />
      </Field>
      <Field label="Date of birth" htmlFor={`${id}-birth`} error={fieldError("date_of_birth")}>
        <Input id={`${id}-birth`} type="date" value={birth} onChange={event => setBirth(event.target.value)} max={today()} min="1900-01-01" autoComplete="bday" required />
      </Field>
      {error && !["id_type", "id_number", "full_name", "date_of_birth"].includes(error.param ?? "") ? <Notice tone="red">{error.message}</Notice> : null}
      <Button type="submit" className="min-h-12 w-full text-base" loading={saving} disabled={!type || !number.trim() || !name.trim() || !birth}>
        Continue
      </Button>
    </form>
  );
}
