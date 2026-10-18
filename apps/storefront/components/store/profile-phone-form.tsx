"use client";

import { useActionState, useState } from "react";
import { Phone } from "lucide-react";
import { addProfilePhone, verifyProfilePhone } from "@/lib/account-actions";
import { PhoneInput } from "@bitocard/ui/phone-input";
import { FormMessage, Submit, TextField } from "./account-forms";

/** The customer's mobile number, from their own (fixed) country only: the field is locked to it and the API checks it again. */
export function ProfilePhoneForm({ phone, verified, country, available }: { phone: string | null; verified: boolean; country: string | null; available: boolean }) {
  const countrySet = Boolean(country);
  const [adding, setAdding] = useState(false);
  const [sendState, sendAction, sendPending] = useActionState(addProfilePhone, {});
  const [verifyState, verifyAction, verifyPending] = useActionState(verifyProfilePhone, {});
  const complete = Boolean(verifyState.notice);
  const showCode = Boolean(sendState.notice) && !complete;
  return <div className="space-y-3">
    <p className="text-sm font-semibold text-navy-900">Phone number</p>
    {phone && verified ? <p className="flex min-h-12 items-center gap-2.5 rounded-xl bg-slate-50 px-3.5 text-[15px] text-slate-700 ring-1 ring-slate-200/70"><Phone className="size-4 shrink-0 text-slate-400" aria-hidden="true" />{phone}<span className="ml-auto text-xs font-semibold text-emerald-700">Verified</span></p> : <p className="text-sm text-slate-500">No verified phone number yet.</p>}
    {!countrySet ? <p className="text-xs text-slate-500">Choose your country below before adding a phone number.</p> : null}
    {countrySet && !available ? <p className="text-xs text-slate-500">Phone verification is not available in your country yet.</p> : null}
    {countrySet && available && (!adding || complete) && !showCode ? <button type="button" onClick={() => setAdding(true)} className="text-sm font-semibold text-brand-600 hover:underline">{phone ? 'Change phone number' : 'Add phone number'}</button> : null}
    {countrySet && available && adding && !showCode && !complete ? <form action={sendAction} className="space-y-3">
      <FormMessage state={sendState} />
      <PhoneInput
        country={country!}
        name="phone"
        required
        className="text-navy-900"
        inputClassName="min-h-12 border border-slate-200 bg-white px-3.5 text-[15px] text-navy-900 focus:border-navy-900 focus:outline-none focus:ring-2 focus:ring-navy-900/15 aria-[invalid=true]:border-red-400"
        errorClassName="text-red-700"
      />
      <p className="text-xs text-slate-500">A mobile number from your country. Type it the way you dial it locally.</p>
      <Submit pending={sendPending}>Send verification code</Submit>
    </form> : null}
    {countrySet && available && showCode ? <form action={verifyAction} className="space-y-3">
      <FormMessage state={verifyState} />
      <TextField label="6-digit SMS code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required state={verifyState} />
      <Submit pending={verifyPending}>Verify phone</Submit>
    </form> : null}
  </div>;
}
