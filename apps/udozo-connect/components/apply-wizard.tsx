"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { compressImage } from "@bitocard/ui/image";
import { acceptAgreement, type ActionResult, type ApplicationFields, loadApplication, removePhoto, saveApplication, submitApplication } from "@/lib/actions";
import {
  type Application,
  type ApplySettings,
  type AreaState,
  missingIn,
  money,
  type PhotoKind,
  photoWords,
  requirementLink,
  type Step,
  stepForParam,
  steps,
  stepWords,
} from "@/lib/connect";

type Props = {
  settings: ApplySettings;
  states: AreaState[];
  application: Application | null;
  initialStep: Step;
  /** udozo.com's origin, where identity, mobile, wallet and the agreement are. */
  udozo: string;
};

type Problem = { message: string; param: string | null } | null;

const inputClass = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 focus:border-navy-900 focus:ring-2 focus:ring-navy-200 focus:outline-none aria-invalid:border-red-600";
const primary = "inline-flex min-h-11 items-center justify-center rounded-xl bg-navy-900 px-5 font-semibold text-white hover:bg-navy-800 disabled:opacity-50";
const secondary = "inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-5 font-semibold text-navy-900 hover:bg-slate-50 disabled:opacity-50";

function Field({ label, hint, name, problem, children }: { label: string; hint?: string; name: string; problem: Problem; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block font-semibold text-slate-800">{label}</span>
      {hint ? <span className="block text-sm text-slate-500">{hint}</span> : null}
      {children}
      {problem?.param === name ? (
        <span className="mt-1 block text-sm font-semibold text-red-700" role="alert">
          {problem.message}
        </span>
      ) : null}
    </label>
  );
}

/**
 * Applying to run a Connect Centre, one step at a time: the business, the office, how it is run, its photos, then
 * Check and send. Each step is saved as the applicant goes (made on the first save, then changed), and a refusal
 * opens the step that holds the field it names.
 */
export function ApplyWizard({ settings, states, application, initialStep, udozo }: Props) {
  const router = useRouter();
  const [app, setApp] = useState<Application | null>(application);
  const [step, setStep] = useState<Step>(initialStep);
  const [problem, setProblem] = useState<Problem>(null);
  const [busy, startBusy] = useTransition();
  const [stateId, setStateId] = useState<string>(application?.state?.id ?? "");
  const [uploading, setUploading] = useState<PhotoKind | null>(null);
  const [agreed, setAgreed] = useState(settings.agreement.accepted);

  const go = (next: Step) => {
    setProblem(null);
    setStep(next);
    if (typeof window !== "undefined") window.scrollTo?.({ top: 0 });
  };

  /** Applies an action's answer: the application as it now is, or the refusal on the step it names. */
  const take = (result: ActionResult, then?: Step) => {
    if (result.ok) {
      setApp(result.application);
      setProblem(null);
      if (then) go(then);
      return true;
    }
    const target = result.param ? stepForParam(result.param, app) : step;
    setStep(target);
    setProblem({ message: result.message, param: result.param });
    return false;
  };

  const save = (form: FormData, fields: readonly string[], then: Step) => {
    const input: ApplicationFields = {};
    for (const field of fields) if (form.has(field)) (input as Record<string, string>)[field] = String(form.get(field) ?? "");
    startBusy(async () => {
      take(await saveApplication(app?.id ?? null, input), then);
    });
  };

  const index = steps.indexOf(step);
  const nextStep = steps[index + 1] ?? "send";
  const stateAreas = states.find(state => state.id === stateId)?.areas ?? [];

  const upload = async (kind: PhotoKind, file: File) => {
    if (!app) return;
    setUploading(kind);
    setProblem(null);
    try {
      const prepared = await compressImage(file).catch(() => file);
      const body = new FormData();
      body.set("kind", kind);
      body.set("file", prepared instanceof File ? prepared : new File([prepared], file.name.replace(/\.\w+$/, "") + ".jpg", { type: prepared.type || file.type }));
      const res = await fetch(`/api/applications/${app.id}/photos`, { method: "POST", body, credentials: "same-origin" });
      const json = (await res.json().catch(() => null)) as { application?: Application; error?: { message?: string } } | null;
      if (res.ok && json?.application) setApp(json.application);
      else setProblem({ message: json?.error?.message ?? "The photo could not be added. Try again.", param: "photos" });
    } catch {
      setProblem({ message: "The photo could not be sent. Check your connection and try again.", param: "photos" });
    } finally {
      setUploading(null);
    }
  };

  const unmet = app?.requirements?.filter(item => !item.met) ?? [];
  const deposit = settings.deposit;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">{app?.status === "changes_requested" ? "Make the changes" : "Apply to run a Connect Centre"}</h1>
      {app ? <p className="mt-1 text-slate-600">Application {app.number}. Saved as you go.</p> : <p className="mt-1 text-slate-600">Saved as you go: you can come back to it.</p>}
      {app?.status === "changes_requested" && app.changes ? (
        <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <strong className="block">Udozo asked for changes</strong>
          {app.changes.note}
        </p>
      ) : null}

      <nav aria-label="Steps" className="mt-6">
        <ol className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {steps.map((item, position) => (
            <li key={item} className="shrink-0">
              <button
                type="button"
                id={item}
                disabled={!app && item !== "business"}
                aria-current={item === step ? "step" : undefined}
                onClick={() => go(item)}
                className={`min-h-10 rounded-full px-3 text-sm font-semibold disabled:opacity-40 ${item === step ? "bg-navy-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
              >
                {position + 1}. {stepWords[item]}
                {app && item !== "send" && item !== "photos" && missingIn(item, app) ? <span className="sr-only"> (to finish)</span> : null}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {problem && !["business_name", "registration_number", "area_id", "address", "landmark", "hours", "phone", "capacity", "person_name", "person_role"].includes(problem.param ?? "") ? (
        <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 font-semibold text-red-800" role="alert">
          {problem.message}
        </p>
      ) : null}

      <section className="mt-6 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="step-title">
        <h2 id="step-title" className="text-xl font-extrabold text-navy-900">
          {stepWords[step]}
        </h2>

        {step === "business" ? (
          <form key="business" className="mt-4 grid gap-4" action={form => save(form, ["business_name", "registration_number"], nextStep)}>
            <Field label="Business name" name="business_name" problem={problem}>
              <input name="business_name" required minLength={2} maxLength={120} defaultValue={app?.business_name ?? ""} aria-invalid={problem?.param === "business_name" || undefined} className={inputClass} />
            </Field>
            <Field label="Registration number (optional)" hint="If the business is registered (for example with the CAC)." name="registration_number" problem={problem}>
              <input name="registration_number" maxLength={40} defaultValue={app?.registration_number ?? ""} aria-invalid={problem?.param === "registration_number" || undefined} className={inputClass} />
            </Field>
            <div className="flex justify-end">
              <button type="submit" disabled={busy} className={primary}>
                {busy ? "Saving…" : "Save and continue"}
              </button>
            </div>
          </form>
        ) : null}

        {step === "office" ? (
          <form key="office" className="mt-4 grid gap-4" action={form => save(form, ["area_id", "address", "landmark"], nextStep)}>
            {states.length === 0 ? <p className="text-slate-600">No state takes applications just now. Try again later.</p> : null}
            <Field label="State" name="state_select" problem={problem}>
              <select value={stateId} onChange={event => setStateId(event.target.value)} required className={inputClass}>
                <option value="">Choose a state</option>
                {states.map(state => (
                  <option key={state.id} value={state.id}>
                    {state.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Area" name="area_id" problem={problem}>
              <select name="area_id" key={stateId} required disabled={!stateId} defaultValue={app?.state?.id === stateId ? (app?.area?.id ?? "") : ""} aria-invalid={problem?.param === "area_id" || undefined} className={inputClass}>
                <option value="">{stateId ? "Choose an area" : "Choose a state first"}</option>
                {stateAreas.map(area => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Address" hint="The office's street address, as visitors would find it." name="address" problem={problem}>
              <textarea name="address" required minLength={10} maxLength={300} rows={3} defaultValue={app?.address ?? ""} aria-invalid={problem?.param === "address" || undefined} className={inputClass} />
            </Field>
            <Field label="Landmark (optional)" hint="Something nearby people know." name="landmark" problem={problem}>
              <input name="landmark" maxLength={120} defaultValue={app?.landmark ?? ""} aria-invalid={problem?.param === "landmark" || undefined} className={inputClass} />
            </Field>
            <div className="flex flex-wrap justify-between gap-2">
              <button type="button" onClick={() => go("business")} className={secondary}>
                Back
              </button>
              <button type="submit" disabled={busy} className={primary}>
                {busy ? "Saving…" : "Save and continue"}
              </button>
            </div>
          </form>
        ) : null}

        {step === "running" ? (
          <form key="running" className="mt-4 grid gap-4" action={form => save(form, ["hours", "phone", "capacity", "person_name", "person_role"], nextStep)}>
            <Field label="Opening hours" hint="For example: Monday to Saturday, 8am to 6pm." name="hours" problem={problem}>
              <input name="hours" required minLength={3} maxLength={200} defaultValue={app?.hours ?? ""} aria-invalid={problem?.param === "hours" || undefined} className={inputClass} />
            </Field>
            <Field label="Office phone number" name="phone" problem={problem}>
              <input name="phone" type="tel" inputMode="tel" required maxLength={30} defaultValue={app?.phone ?? ""} aria-invalid={problem?.param === "phone" || undefined} className={inputClass} />
            </Field>
            <Field label="How many items the office can hold" name="capacity" problem={problem}>
              <input name="capacity" type="number" inputMode="numeric" required min={1} max={100000} step={1} defaultValue={app?.capacity ?? ""} aria-invalid={problem?.param === "capacity" || undefined} className={inputClass} />
            </Field>
            <Field label="The person in charge" name="person_name" problem={problem}>
              <input name="person_name" required minLength={2} maxLength={80} defaultValue={app?.person_name ?? ""} aria-invalid={problem?.param === "person_name" || undefined} className={inputClass} />
            </Field>
            <Field label="Their role (optional)" hint="For example: Owner, Manager." name="person_role" problem={problem}>
              <input name="person_role" maxLength={60} defaultValue={app?.person_role ?? ""} aria-invalid={problem?.param === "person_role" || undefined} className={inputClass} />
            </Field>
            <div className="flex flex-wrap justify-between gap-2">
              <button type="button" onClick={() => go("office")} className={secondary}>
                Back
              </button>
              <button type="submit" disabled={busy} className={primary}>
                {busy ? "Saving…" : "Save and continue"}
              </button>
            </div>
          </form>
        ) : null}

        {step === "photos" && app ? (
          <div className="mt-4 grid gap-5">
            <p className="text-slate-600">
              Add photos of the shopfront, the counter and where items are kept. Up to {settings.photos.max} in all ({app.photos.length} added).
            </p>
            {settings.photos.kinds.map(kind => {
              const photos = app.photos.filter(photo => photo.kind === kind);
              const required = settings.photos.required.includes(kind);
              return (
                <div key={kind} className="rounded-2xl border border-slate-100 p-4">
                  <h3 className="font-bold text-navy-900">
                    {photoWords[kind]} {required ? null : <span className="font-normal text-slate-500">(optional)</span>}
                  </h3>
                  {photos.length ? (
                    <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {photos.map(photo => (
                        <li key={photo.id} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element -- the photo the applicant just sent */}
                          <img src={photo.url} alt={photoWords[kind]} className="aspect-[4/3] w-full rounded-xl object-cover" />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => startBusy(async () => void take(await removePhoto(app.id, photo.id)))}
                            className="mt-1 text-sm font-semibold text-red-700 hover:underline"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : required ? (
                    <p className="mt-1 text-sm text-amber-800">Needed</p>
                  ) : null}
                  <label className={`${secondary} mt-3 cursor-pointer`}>
                    {uploading === kind ? "Sending…" : "Add a photo"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      disabled={uploading !== null || app.photos.length >= settings.photos.max}
                      onChange={event => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void upload(kind, file);
                      }}
                    />
                  </label>
                </div>
              );
            })}
            <div className="flex flex-wrap justify-between gap-2">
              <button type="button" onClick={() => go("running")} className={secondary}>
                Back
              </button>
              <button type="button" onClick={() => startBusy(async () => void take(await loadApplication(app.id), "send"))} className={primary}>
                Continue
              </button>
            </div>
          </div>
        ) : null}

        {step === "send" && app ? (
          <div className="mt-4 grid gap-5">
            <ul className="grid gap-2" aria-label="What sending needs">
              {(app.requirements ?? []).map(item => {
                const link = requirementLink(item.key, udozo, settings.agreement.path);
                return (
                  <li key={item.key} className="flex gap-3 rounded-2xl border border-slate-100 p-3">
                    <span aria-hidden="true" className={`grid size-6 shrink-0 place-items-center rounded-full text-sm font-bold ${item.met ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                      {item.met ? "✓" : "!"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-slate-800">{item.label}</span>
                      <span className="sr-only">{item.met ? "Done" : "Still needed"}</span>
                      {!item.met && item.key !== "agreement" ? (
                        link.step ? (
                          <button type="button" onClick={() => go(item.key === "details" ? stepForParam("details", app) : link.step!)} className="text-sm font-semibold text-brand-600 hover:underline">
                            {link.label}
                          </button>
                        ) : (
                          <a href={link.href} target="_blank" rel="noopener" className="text-sm font-semibold text-brand-600 hover:underline">
                            {link.label}
                          </a>
                        )
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>

            <div className="rounded-2xl border border-slate-100 p-4">
              <h3 className="font-bold text-navy-900">The Connect Centre agreement</h3>
              <p className="mt-1 text-slate-600">
                <a href={`${udozo}${settings.agreement.path}`} target="_blank" rel="noopener" className="font-semibold text-brand-600 hover:underline">
                  Read the Connect Centre agreement
                </a>{" "}
                (version {settings.agreement.version}).
              </p>
              <label className="mt-3 flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-5"
                  checked={agreed}
                  disabled={agreed || busy}
                  onChange={() =>
                    startBusy(async () => {
                      if (take(await acceptAgreement(app.id, settings.agreement.version))) setAgreed(true);
                    })
                  }
                />
                <span>I accept the Connect Centre agreement</span>
              </label>
            </div>

            <div className="rounded-2xl bg-navy-50 p-4">
              <h3 className="font-bold text-navy-900">The deposit</h3>
              {deposit ? (
                <p className="mt-1 text-slate-700">
                  Sending your application takes <strong>{money(deposit.amount, deposit.currency)}</strong> from your UdozoPay wallet as your centre&apos;s deposit. It
                  comes back to your wallet if you withdraw or are not approved.
                </p>
              ) : (
                <p className="mt-1 text-slate-700">The deposit is not set in your country yet, so applications cannot be sent for now.</p>
              )}
            </div>

            <div className="flex flex-wrap justify-between gap-2">
              <button type="button" onClick={() => go("photos")} className={secondary}>
                Back
              </button>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => startBusy(async () => void take(await loadApplication(app.id)))} className={secondary}>
                  Check again
                </button>
                <button
                  type="button"
                  disabled={busy || unmet.length > 0 || !deposit}
                  onClick={() =>
                    startBusy(async () => {
                      const result = await submitApplication(app.id, deposit?.amount ?? null);
                      if (take(result)) router.push("/application");
                      else if (!result.ok && (result.code === "deposit_changed" || result.code === "agreement_changed")) router.refresh();
                    })
                  }
                  className={primary}
                >
                  {busy ? "Sending…" : "Send application"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {(step === "photos" || step === "send") && !app ? <p className="mt-4 text-slate-600">Save your business first.</p> : null}
      </section>
    </div>
  );
}
