"use client";

import { useState } from "react";
import { Button, errorMessage, Field, Input, Notice } from "@bitocard/admin-ui";
import { useUpdateCountryMutation } from "@bitocard/api-client/admin";

/** A WhatsApp group invite link, as the API accepts it. */
export const whatsappGroupPattern = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,40}$/;

/**
 * The market's WhatsApp group for its resellers: kept here, seen only by admins, and sent only to this market's
 * resellers in the "Join WhatsApp group" email from their page.
 */
export function WhatsappGroup({ code, country, url, editable }: { code: string; country: string; url: string | null; editable: boolean }) {
  const [update, state] = useUpdateCountryMutation();
  const [value, setValue] = useState(url ?? "");
  const trimmed = value.trim();
  const valid = trimmed === "" || whatsappGroupPattern.test(trimmed);
  const changed = trimmed !== (url ?? "");
  const save = (next: string | null) => void update({ code, whatsapp_group_url: next });

  return (
    <div className="space-y-3 px-4 pb-5 sm:px-6">
      <Field label="Group invite link" htmlFor={`whatsapp-group-${code}`} hint="From WhatsApp: the group’s info, then Invite via link. It looks like https://chat.whatsapp.com/…">
        <Input id={`whatsapp-group-${code}`} value={value} disabled={!editable || state.isLoading} placeholder="https://chat.whatsapp.com/…" onChange={event => setValue(event.target.value)} />
      </Field>
      {!valid ? <Notice tone="amber">That is not a WhatsApp group invite link.</Notice> : null}
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      <p className="text-xs text-muted">
        {url ? `Resellers in ${country} can be sent this link from their page (Emails > Join WhatsApp group).` : `Until a link is set, the WhatsApp group email cannot be sent to resellers in ${country}.`} It is never shown on any public page.
      </p>
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!valid || !changed || trimmed === ""} loading={state.isLoading} onClick={() => save(trimmed)}>
            Save link
          </Button>
          {url ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={state.isLoading}
              onClick={() => {
                setValue("");
                save(null);
              }}
            >
              Remove link
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
