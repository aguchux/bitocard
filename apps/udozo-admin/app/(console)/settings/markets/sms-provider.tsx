"use client";

import { errorMessage, Notice, Select } from "@bitocard/admin-ui";
import { useUpdateCountryMutation } from "@bitocard/api-client/admin";

export function SmsProvider({ code, provider, editable }: { code: string; provider: 'termii' | 'africas_talking' | null; editable: boolean }) {
  const [update, state] = useUpdateCountryMutation();
  return (
    <div className="space-y-3 px-4 pb-5 sm:px-6">
      <div className="space-y-1.5">
      <label htmlFor={`sms-provider-${code}`} className="block text-sm font-semibold text-ink">SMS provider for phone codes</label>
      <div className="w-full max-w-md">
        <Select id={`sms-provider-${code}`} value={provider ?? ''} disabled={!editable || state.isLoading} onChange={event => void update({ code, sms_provider: event.target.value === '' ? null : event.target.value as 'termii' | 'africas_talking' })}>
          <option value="">Disabled</option>
          <option value="termii">Termii</option>
          <option value="africas_talking">Africa’s Talking</option>
        </Select>
      </div>
      </div>
      <p className="text-xs text-muted">Set the provider’s credentials in Integrations before enabling this country. Existing verified numbers stay on profiles.</p>
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
    </div>
  );
}
