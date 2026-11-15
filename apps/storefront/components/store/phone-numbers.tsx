"use client";

import { useActionState, useState } from "react";
import { Phone, Star } from "lucide-react";
import type { StoreCustomerPhones } from "@bitocard/api-client/storefront";
import { PhoneInput } from "@bitocard/ui/phone-input";
import { addAnotherPhone, makeDefaultPhone, removePhone, verifyAnotherPhone } from "@/lib/account-actions";
import { FormMessage, Submit, TextField } from "./account-forms";

/**
 * The customer's mobile numbers: up to five, each confirmed by a texted code, one the default (shown first; used
 * wherever one number is needed). Airtime is bought and sold only with these confirmed numbers. A number saved at
 * sign-up but never confirmed is offered to confirm without retyping it.
 */
export function PhoneNumbers({ phones, country, available }: { phones: StoreCustomerPhones; country: string | null; available: boolean }) {
  const [adding, setAdding] = useState(false);
  const [sendState, sendAction, sendPending] = useActionState(addAnotherPhone, {});
  const [verifyState, verifyAction, verifyPending] = useActionState(verifyAnotherPhone, {});
  const [rowState, rowAction, rowPending] = useActionState(async (state: { notice?: string; error?: string }, form: FormData) => {
    return form.get("intent") === "remove" ? removePhone(state, form) : makeDefaultPhone(state, form);
  }, {});
  const full = phones.data.length >= phones.limit;
  const confirmed = Boolean(verifyState.notice);
  const awaitingCode = Boolean(sendState.notice) && !confirmed;
  const canAdd = Boolean(country) && available;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-navy-900">Mobile numbers</p>
        <p className="text-xs text-slate-500">{`${phones.data.length} of ${phones.limit}`}</p>
      </div>
      <FormMessage state={rowState} />
      {phones.data.length ? (
        <ul className="space-y-2">
          {phones.data.map(item => (
            <li key={item.phone} className="flex flex-wrap items-center gap-2.5 rounded-xl bg-slate-50 px-3.5 py-2.5 text-[15px] text-slate-700 ring-1 ring-slate-200/70">
              <Phone className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span className="min-w-0 font-medium text-navy-900">{item.phone}</span>
              <span className="text-xs font-semibold text-emerald-700">Confirmed</span>
              {item.default ? (
                <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-navy-900 px-2.5 py-0.5 text-xs font-semibold text-white">
                  <Star className="size-3" aria-hidden="true" /> Default
                </span>
              ) : (
                <form action={rowAction} className="ml-auto flex gap-3">
                  <input type="hidden" name="phone" value={item.phone} />
                  <button type="submit" name="intent" value="default" disabled={rowPending} className="min-h-9 text-sm font-semibold text-brand-600 hover:underline disabled:opacity-50">
                    Make default
                  </button>
                  <button type="submit" name="intent" value="remove" disabled={rowPending} className="min-h-9 text-sm font-semibold text-slate-500 hover:underline disabled:opacity-50">
                    Remove
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">No confirmed number yet.</p>
      )}
      <p className="text-xs text-slate-500">Airtime you buy or sell on BitoCard moves only to and from these confirmed numbers.</p>
      {!country ? <p className="text-xs text-slate-500">Choose your country below before adding a number.</p> : null}
      {country && !available ? <p className="text-xs text-slate-500">Phone verification is not available in your country yet.</p> : null}

      {canAdd && phones.unconfirmed && !awaitingCode && !adding && !full ? (
        <form action={sendAction} className="space-y-2 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200/70">
          <FormMessage state={sendState} />
          <p className="text-sm text-navy-900">
            <span className="font-semibold">{phones.unconfirmed}</span> is on your account but not confirmed.
          </p>
          <input type="hidden" name="phone" value={phones.unconfirmed} />
          <Submit pending={sendPending}>Confirm this number</Submit>
        </form>
      ) : null}

      {canAdd && !full && !adding && !awaitingCode ? (
        <button type="button" onClick={() => setAdding(true)} className="text-sm font-semibold text-brand-600 hover:underline">
          {phones.data.length ? "Add another number" : "Add a number"}
        </button>
      ) : null}
      {canAdd && full && !awaitingCode ? <p className="text-xs text-slate-500">{`You have ${phones.limit} numbers, the most allowed. Remove one to add another.`}</p> : null}

      {canAdd && adding && !awaitingCode && !confirmed ? (
        <form action={sendAction} className="space-y-3">
          <FormMessage state={sendState} />
          <PhoneInput
            country={country!}
            name="phone"
            required
            className="text-navy-900"
            inputClassName="min-h-12 border border-slate-200 bg-white px-3.5 text-[15px] text-navy-900 focus:border-navy-900 focus:outline-none focus:ring-2 focus:ring-navy-900/15 aria-[invalid=true]:border-red-400"
            errorClassName="text-red-700"
          />
          <p className="text-xs text-slate-500">A mobile number from your country, on a line you own. Type it the way you dial it locally.</p>
          <div className="flex flex-wrap gap-3">
            <Submit pending={sendPending}>Send verification code</Submit>
            <button type="button" onClick={() => setAdding(false)} className="text-sm font-semibold text-slate-500 hover:underline">
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {awaitingCode ? (
        <form action={verifyAction} className="space-y-3">
          <FormMessage state={sendState} />
          <FormMessage state={verifyState} />
          <TextField label="6-digit SMS code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required state={verifyState} />
          <Submit pending={verifyPending}>Confirm number</Submit>
        </form>
      ) : null}
      {confirmed ? <FormMessage state={verifyState} /> : null}
    </div>
  );
}
