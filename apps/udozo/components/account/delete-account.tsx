"use client";

import { useActionState, useState } from "react";
import { FormMessage, Submit, TextField } from "@/components/account-forms";
import { deleteAccount, type FormState } from "@/lib/account-actions";

const empty: FormState = {};

/**
 * Deleting the account: typing DELETE is the confirmation (and the password when the account has one), so it cannot
 * happen by a slip. The button stays off until DELETE is typed.
 */
export function DeleteAccountForm({ passwordRequired }: { passwordRequired: boolean }) {
  const [state, action, pending] = useActionState(deleteAccount, empty);
  const [typed, setTyped] = useState("");
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      {passwordRequired ? <TextField label="Your password" name="password" type="password" autoComplete="current-password" required state={state} /> : null}
      <label className="grid gap-1 text-sm font-semibold text-navy-900">
        Type DELETE to confirm
        <input
          name="confirm"
          value={typed}
          onChange={event => setTyped(event.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          aria-invalid={state.field === "confirm" || undefined}
          className="min-h-11 rounded-xl border border-navy-200 px-3 font-normal"
        />
      </label>
      <Submit pending={pending} className={typed === "DELETE" ? "bg-red-700 hover:bg-red-800" : "pointer-events-none opacity-50"}>
        Delete my account
      </Submit>
    </form>
  );
}
