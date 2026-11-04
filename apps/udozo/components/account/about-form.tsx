"use client";

import { useActionState, useId, useState } from "react";
import type { ShopState } from "@bitocard/api-client/classifieds";
import { FormMessage, Submit } from "@/components/account-forms";
import { type FormState, updateAbout } from "@/lib/account-actions";

const field = "min-h-12 w-full rounded-xl border border-navy-200 bg-white px-3.5 text-[15px] text-navy-900 focus:border-navy-500 focus:ring-2 focus:ring-brand-500/30 disabled:bg-navy-50 aria-[invalid=true]:border-brand-700";
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The latest date of birth allowed (13 years ago), as the date field wants it. */
export function latestBirthDate(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear() - 13, now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
}

/**
 * About you, on the profile: where the customer lives (their state, region or county, then the area: required here,
 * and apart from where their listings are, which each ad says), their date of birth and their sex, both optional ("Do
 * not specify" says they would rather not).
 */
export function AboutForm({ states, region, areaId, birthDate, sex }: { states: ShopState[]; region: string; areaId: string | null; birthDate: string | null; sex: "female" | "male" | "unspecified" | null }) {
  const id = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(updateAbout, {});
  const [stateSlug, setStateSlug] = useState(() => states.find(item => item.areas.some(area => area.id === areaId))?.slug ?? "");
  const chosen = states.find(item => item.slug === stateSlug) ?? null;
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-state`} className="block text-sm font-semibold text-navy-900">
            {capital(region)}
          </label>
          <select id={`${id}-state`} value={stateSlug} required onChange={event => setStateSlug(event.target.value)} className={field}>
            <option value="" disabled>
              {`Choose your ${region}`}
            </option>
            {states.map(item => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-area`} className="block text-sm font-semibold text-navy-900">
            City or area
          </label>
          <select
            key={stateSlug}
            id={`${id}-area`}
            name="area_id"
            required
            disabled={!chosen}
            defaultValue={chosen?.areas.some(area => area.id === areaId) ? (areaId ?? "") : ""}
            aria-invalid={state.field === "area_id" || undefined}
            className={field}
          >
            <option value="" disabled>
              {chosen ? "Choose your area" : `Choose a ${region} first`}
            </option>
            {chosen?.areas.map(area => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="-mt-2 text-xs text-navy-500">Where you live. Each ad says where its item is, which can be somewhere else.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-birth`} className="block text-sm font-semibold text-navy-900">
            Date of birth <span className="font-normal text-navy-500">(optional)</span>
          </label>
          <input id={`${id}-birth`} type="date" name="birth_date" defaultValue={birthDate ?? ""} max={latestBirthDate()} min="1900-01-01" aria-invalid={state.field === "birth_date" || undefined} className={field} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-sex`} className="block text-sm font-semibold text-navy-900">
            Sex <span className="font-normal text-navy-500">(optional)</span>
          </label>
          <select id={`${id}-sex`} name="sex" defaultValue={sex ?? ""} aria-invalid={state.field === "sex" || undefined} className={field}>
            <option value="">Not given</option>
            <option value="unspecified">Do not specify</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </div>
      </div>
      <Submit pending={pending} className="w-fit">
        Save
      </Submit>
    </form>
  );
}
