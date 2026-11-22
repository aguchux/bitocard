"use client";

import { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Input, Notice, Select } from "@bitocard/admin-ui";
import { duplicateRows, emptyPlan, formatPlans, networkLabel, parsePlans, planCountries, type PlanRow, rowProblem, rowsProblem, validities } from "./data-plans";

/**
 * Africa's Talking's data bundles, one row each: country, network, size, validity, the price customers know it by and
 * what Africa's Talking charges BitoCard. Saved as the setting's text, one plan a line, which the API reads.
 */
export function DataPlansField({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (text: string, problem: string | null) => void }) {
  const id = useId();
  const [initial] = useState(() => parsePlans(value));
  const [rows, setRows] = useState<PlanRow[]>(initial.rows);
  const [unreadable, setUnreadable] = useState<string[]>(initial.unreadable);
  const repeated = duplicateRows(rows);

  const commit = (nextRows: PlanRow[], nextUnreadable = unreadable) => {
    setRows(nextRows);
    setUnreadable(nextUnreadable);
    onChange(formatPlans(nextRows, nextUnreadable), rowsProblem(nextRows, nextUnreadable));
  };
  const change = (rowId: string, patch: Partial<PlanRow>) =>
    commit(
      rows.map(row => {
        if (row.id !== rowId) return row;
        const next = { ...row, ...patch };
        // A new country starts on its first network unless the old one is also sold there.
        if (patch.country) {
          const networks = planCountries.find(item => item.code === patch.country)?.networks ?? [];
          if (!(networks as readonly string[]).includes(next.network)) next.network = networks[0] ?? "";
        }
        return next;
      }),
    );

  return (
    <div className="space-y-3">
      {unreadable.length ? (
        <Notice tone="amber" title="Plans not understood">
          <ul className="mt-1 space-y-1">
            {unreadable.map(line => (
              <li key={line} className="flex items-center justify-between gap-3">
                <code className="break-all text-xs">{line}</code>
                <Button variant="ghost" size="sm" disabled={disabled} onClick={() => commit(rows, unreadable.filter(item => item !== line))}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {rows.length === 0 ? <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">No data plans yet. Add the bundles you sell from Africa’s Talking’s dashboard.</p> : null}

      <ol className="space-y-3">
        {rows.map((row, index) => {
          const country = planCountries.find(item => item.code === row.country);
          const networks: string[] = [...(country?.networks ?? [])];
          if (row.network && !networks.includes(row.network)) networks.push(row.network);
          const problem = repeated.has(row.id) ? "Another plan has the same country, network, size and validity." : rowProblem(row);
          const touched = Boolean(row.size || row.price || row.cost);
          const field = (name: string) => `${id}-${row.id}-${name}`;
          return (
            <li key={row.id} className="rounded-lg border border-line bg-white p-3" aria-label={`Data plan ${index + 1}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-subtle">{`Plan ${index + 1}`}</p>
                <Button variant="ghost" size="sm" disabled={disabled} icon={<Trash2 className="size-4" aria-hidden />} onClick={() => commit(rows.filter(item => item.id !== row.id))}>
                  Remove
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                <label className="space-y-1 text-xs text-muted" htmlFor={field("country")}>
                  <span>Country</span>
                  <Select id={field("country")} value={row.country} disabled={disabled} onChange={event => change(row.id, { country: event.target.value })}>
                    {planCountries.map(item => (
                      <option key={item.code} value={item.code}>{`${item.name} (${item.currency})`}</option>
                    ))}
                    {country ? null : <option value={row.country}>{row.country}</option>}
                  </Select>
                </label>
                <label className="space-y-1 text-xs text-muted" htmlFor={field("network")}>
                  <span>Network</span>
                  <Select id={field("network")} value={row.network} disabled={disabled} onChange={event => change(row.id, { network: event.target.value })}>
                    {networks.map(network => (
                      <option key={network} value={network}>
                        {networkLabel(network)}
                      </option>
                    ))}
                  </Select>
                </label>
                <div className="space-y-1 text-xs text-muted">
                  <label htmlFor={field("size")}>Size</label>
                  <div className="flex gap-1">
                    <Input id={field("size")} inputMode="decimal" placeholder="1" value={row.size} disabled={disabled} onChange={event => change(row.id, { size: event.target.value })} />
                    <Select aria-label="Unit" className="w-20 shrink-0" value={row.unit} disabled={disabled} onChange={event => change(row.id, { unit: event.target.value as "MB" | "GB" })}>
                      <option value="MB">MB</option>
                      <option value="GB">GB</option>
                    </Select>
                  </div>
                </div>
                <label className="space-y-1 text-xs text-muted" htmlFor={field("validity")}>
                  <span>Lasts</span>
                  <Select id={field("validity")} value={row.validity} disabled={disabled} onChange={event => change(row.id, { validity: event.target.value })}>
                    {validities.map(item => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="space-y-1 text-xs text-muted" htmlFor={field("price")}>
                  <span>{`Price (${country?.currency ?? "local"})`}</span>
                  <Input id={field("price")} inputMode="decimal" placeholder="1000" value={row.price} disabled={disabled} onChange={event => change(row.id, { price: event.target.value })} />
                </label>
                <label className="space-y-1 text-xs text-muted" htmlFor={field("cost")}>
                  <span>{`Our cost (${country?.currency ?? "local"})`}</span>
                  <Input id={field("cost")} inputMode="decimal" placeholder="900" value={row.cost} disabled={disabled} onChange={event => change(row.id, { cost: event.target.value })} />
                </label>
              </div>
              {problem && (touched || repeated.has(row.id)) ? (
                <p className="mt-2 text-xs text-red-600" role="alert">
                  {problem}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      <Button variant="secondary" size="sm" disabled={disabled} icon={<Plus className="size-4" aria-hidden />} onClick={() => commit([...rows, emptyPlan(rows.at(-1))])}>
        Add data plan
      </Button>
    </div>
  );
}
