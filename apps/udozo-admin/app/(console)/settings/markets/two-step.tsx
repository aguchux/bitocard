"use client";

import { Button, errorMessage, Notice, Toggle } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type TwoStepMethod, useSetSwitchMutation, useSwitchesQuery, useUpdateCountryMutation } from "@bitocard/api-client/admin";

const methods: Array<{ method: TwoStepMethod; label: string; hint: string }> = [
  { method: "authenticator", label: "Authenticator app", hint: "Codes from an app such as Google Authenticator. Works offline." },
  { method: "email", label: "Email codes", hint: "A code emailed to the person's primary address." },
  { method: "sms", label: "Text messages", hint: "A code texted to their confirmed mobile number (needs this market's SMS provider)." },
];

/**
 * Two-step sign-in for resellers based in a market: whether it is required (the `reseller_two_step` switch for the
 * market, over the global one; a reseller's own switch wins on their page), and which methods they may choose.
 */
export function TwoStepSignIn({ code, country, allowed, smsProvider, editable }: { code: string; country: string; allowed: TwoStepMethod[] | undefined; smsProvider: string | null; editable: boolean }) {
  const switches = useSwitchesQuery();
  const [setSwitch, switchState] = useSetSwitchMutation();
  const [update, updateState] = useUpdateCountryMutation();
  const rows = switches.data?.data.filter(row => row.key === "reseller_two_step") ?? [];
  const market = rows.find(row => row.country_code === code)?.enabled;
  const global = rows.find(row => row.scope === "global")?.enabled ?? switches.data?.definitions.reseller_two_step?.default ?? false;
  const required = market ?? global;
  const chosen = allowed ?? methods.map(item => item.method);

  return (
    <div className="space-y-4 px-4 pb-5 sm:px-6">
      {switchState.error || updateState.error ? <Notice tone="red">{errorMessage(switchState.error ?? updateState.error)}</Notice> : null}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{`Required for resellers in ${country}`}</p>
          <p className="text-xs text-muted">
            {market === undefined ? `Follows the global switch (${global ? "on" : "off"}).` : "Set for this market."} Everyone on a reseller&apos;s team sets it up at their next sign-in. A reseller&apos;s own switch on its page wins.
          </p>
        </div>
        <Toggle
          label={`Two-step sign-in required in ${country}`}
          checked={required}
          disabled={!editable || !switches.data || switchState.isLoading}
          onChange={enabled => void setSwitch({ key: "reseller_two_step", country_code: code, enabled })}
        />
      </div>
      {market !== undefined && editable ? (
        <Button variant="ghost" size="sm" loading={switchState.isLoading} onClick={() => void setSwitch({ key: "reseller_two_step", country_code: code, enabled: null })}>
          Follow the global switch
        </Button>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink">Methods resellers may choose</legend>
        {methods.map(item => {
          const on = chosen.includes(item.method);
          // At least one method stays offered.
          const last = on && chosen.length === 1;
          return (
            <div key={item.method} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{item.label}</p>
                <p className="text-xs text-muted">{item.method === "sms" && !smsProvider ? "No SMS provider is set for this market, so text messages are not available here." : item.hint}</p>
              </div>
              <Toggle
                label={`${item.label} in ${country}`}
                checked={on}
                disabled={!editable || last || allowed === undefined || updateState.isLoading}
                onChange={value => void update({ code, reseller_two_step_methods: value ? [...chosen, item.method] : chosen.filter(method => method !== item.method) })}
              />
            </div>
          );
        })}
      </fieldset>
      <p className="text-xs text-muted">
        People already using a method keep it. To reset someone who lost their phone, open their reseller&apos;s page (
        <AppLink href="/resellers" className="font-semibold text-brand-600 hover:underline">
          Resellers
        </AppLink>
        , Team).
      </p>
    </div>
  );
}
