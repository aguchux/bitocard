"use client";

import { errorMessage, Notice, Select } from "@bitocard/admin-ui";
import { useUpdateCountryMutation } from "@bitocard/api-client/admin";

type Provider = "termii" | "africas_talking";

/** Africa's Talking first, as Udozo uses it first; Termii second. */
const providers: Array<{ value: Provider; label: string }> = [
  { value: "africas_talking", label: "Africa’s Talking" },
  { value: "termii", label: "Termii" },
];
const labelOf = (provider: Provider | null) => providers.find(item => item.value === provider)?.label ?? "";

/**
 * A market's SMS providers for phone codes: the first sends every code; the second (optional, never the first) takes a
 * code the first could not send, and sends resends, so a code that did not arrive one way is tried the other.
 */
export function SmsProvider({ code, provider, fallback, editable }: { code: string; provider: Provider | null; fallback: Provider | null; editable: boolean }) {
  const [update, state] = useUpdateCountryMutation();
  const disabled = !editable || state.isLoading;
  const seconds = providers.filter(item => item.value !== provider);
  return (
    <div className="space-y-3 px-4 pb-5 sm:px-6">
      <div className="grid gap-3 sm:grid-cols-2 sm:max-w-2xl">
        <div className="space-y-1.5">
          <label htmlFor={`sms-provider-${code}`} className="block text-sm font-semibold text-ink">
            First provider
          </label>
          <Select
            id={`sms-provider-${code}`}
            value={provider ?? ""}
            disabled={disabled}
            onChange={event => void update({ code, sms_provider: event.target.value === "" ? null : (event.target.value as Provider) })}
          >
            <option value="">Disabled</option>
            {providers.map(item => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`sms-fallback-${code}`} className="block text-sm font-semibold text-ink">
            Second provider
          </label>
          <Select
            id={`sms-fallback-${code}`}
            value={fallback ?? ""}
            disabled={disabled || !provider}
            onChange={event => void update({ code, sms_fallback_provider: event.target.value === "" ? null : (event.target.value as Provider) })}
          >
            <option value="">None</option>
            {seconds.map(item => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted">
        {provider && fallback
          ? `Codes go through ${labelOf(provider)}. If it cannot send one, ${labelOf(fallback)} sends it, and a resend goes through ${labelOf(fallback)} first.`
          : provider
            ? `Codes go through ${labelOf(provider)} only. Add a second provider to take over when it fails and to send resends.`
            : "Phone verification is off in this market: numbers are kept unconfirmed."}{" "}
        Set each provider’s credentials in Integrations first. Existing verified numbers stay on profiles.
      </p>
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
    </div>
  );
}
