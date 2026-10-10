"use client";

import { Card, CardHeader, errorMessage, humanise, Notice, Toggle } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { useSetSwitchMutation, useSwitchesQuery } from "@bitocard/api-client/admin";

/**
 * A reseller's own feature switches (those that can be set per reseller, such as customer wallets): each shows what
 * applies now (`features`, from the reseller, their country, global or the default) and whether it is set for them; a
 * reseller setting wins over the country and global ones, and Reset removes it.
 */
export function ResellerSwitchesCard({ resellerId, features }: { resellerId: string; features: Record<string, boolean> }) {
  const admin = useAdmin();
  const switches = useSwitchesQuery();
  const [setSwitch, state] = useSetSwitchMutation();
  const editable = can(admin, "operations");
  const definitions = Object.entries(switches.data?.definitions ?? {}).filter(([, definition]) => definition.scopes.includes("reseller"));
  const own = (key: string) => switches.data?.data.find(row => row.key === key && row.reseller_id === resellerId)?.enabled;

  return (
    <Card>
      <CardHeader title="Feature switches" description="For this reseller only: overrides their country and the global setting." />
      {state.error ? (
        <div className="px-5 pt-3 sm:px-6">
          <Notice tone="red">{errorMessage(state.error)}</Notice>
        </div>
      ) : null}
      <ul className="divide-y divide-line px-5 py-2 sm:px-6">
        {definitions.map(([key, definition]) => {
          const set = own(key);
          return (
            <li key={key} className="flex min-h-14 items-center justify-between gap-3 py-2">
              <span className="min-w-0 text-sm">
                <span className="block font-medium">{humanise(key)}</span>
                <span className="block text-xs text-muted">{set === undefined ? "Follows their country or the global setting" : "Set for this reseller"}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                {set !== undefined && editable ? (
                  <button type="button" className="text-xs font-semibold text-muted hover:text-ink" onClick={() => setSwitch({ key, reseller_id: resellerId, enabled: null })}>
                    Reset
                  </button>
                ) : null}
                <Toggle
                  label={`${humanise(key)} for this reseller`}
                  checked={set ?? features[key] ?? definition.default}
                  disabled={!editable}
                  onChange={enabled => setSwitch({ key, reseller_id: resellerId, enabled })}
                />
              </span>
            </li>
          );
        })}
        {!definitions.length && !switches.isLoading ? <li className="py-4 text-sm text-muted">No switches can be set per reseller.</li> : null}
      </ul>
    </Card>
  );
}
