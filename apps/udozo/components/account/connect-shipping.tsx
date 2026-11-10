"use client";

import { connectName, payName } from "@bitocard/api-client/classifieds";
import type { ListingFields } from "@/lib/shop-actions";
import { centresWithin, type ConnectChoice, connectStatesField, type ConnectStateOption } from "@/lib/connect-shipping";

const field = "h-11 rounded-xl border bg-white px-3 text-base font-normal";

/**
 * Post an ad's **Ship through Udozo Connect** (docs/UDOZO_CONNECT_PLAN.md, phase 4): the states the seller ships to, each
 * with their own shipping charge (all of it theirs; the buyer also pays a Connect fee), and the centres there: every
 * open one (new ones join by themselves) or those the seller picks. Changes are saved as the form saves the rest.
 */
export function ConnectShipping({
  choice,
  onChange,
  options,
  region,
  marks,
  priceOnRequest,
}: {
  choice: ConnectChoice;
  /** The new choice, and the fields to save for it. */
  onChange: (next: ConnectChoice, save: ListingFields | null) => void;
  options: ConnectStateOption[];
  /** What the market calls its states. */
  region: string;
  marks: (param: string) => string;
  priceOnRequest: boolean;
}) {
  const ticked = (id: string) => id in choice.charges;
  const tickedOptions = options.filter(option => ticked(option.id));
  const allTicked = options.length > 0 && options.every(option => ticked(option.id));
  const sameCharge = (() => {
    const values = Object.values(choice.charges);
    return values.length && values.every(value => value === values[0]) ? values[0]! : "";
  })();

  const withStates = (charges: Record<string, string>): [ConnectChoice, ListingFields] => {
    const next = { ...choice, charges };
    next.centres = centresWithin(next, options);
    return [next, { connect_states: connectStatesField(next), ...(choice.all ? {} : { connect_centres: next.centres }) }];
  };

  const toggleState = (id: string, on: boolean) => {
    const charges = { ...choice.charges };
    if (on) charges[id] = sameCharge;
    else delete charges[id];
    onChange(...withStates(charges));
  };

  return (
    <fieldset className="grid gap-4 rounded-2xl border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold">{connectName}</legend>
      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={choice.enabled}
          onChange={event => onChange({ ...choice, enabled: event.target.checked }, { connect: event.target.checked })}
          className={`mt-1 size-4 accent-navy-900 ${marks("connect")}`}
        />
        <span>
          <strong className="block">Ship through {connectName}</strong>
          <span className="text-slate-600">
            Buyers anywhere you ship to collect it at a {connectName} Centre near them, paying with {payName}. You take it to a centre (drop it off, or send it with
            any courier); they inspect it at the counter before they take it.
          </span>
        </span>
      </label>

      {choice.enabled ? (
        <>
          {priceOnRequest ? <p className="text-sm font-semibold text-amber-800">Give it a price: items shipped through {connectName} are paid with {payName}.</p> : null}
          {options.length ? (
            <div className="grid gap-2">
              <p className="text-sm font-semibold">Where you ship to</p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allTicked}
                  onChange={event => onChange(...withStates(event.target.checked ? Object.fromEntries(options.map(option => [option.id, choice.charges[option.id] ?? sameCharge])) : {}))}
                  className="size-4 accent-navy-900"
                />
                <span className="font-semibold">Every {region} with a centre</span>
              </label>
              <ul className={`grid gap-2 rounded-xl ${marks("connect_states")}`}>
                {options.map(option => (
                  <li key={option.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={ticked(option.id)} onChange={event => toggleState(option.id, event.target.checked)} className="size-4 accent-navy-900" />
                      <span>
                        {option.name}
                        <span className="text-slate-500"> · {option.centres.length === 1 ? "1 centre" : `${option.centres.length} centres`}</span>
                      </span>
                    </label>
                    {ticked(option.id) ? (
                      <input
                        aria-label={`Shipping charge to ${option.name}`}
                        value={choice.charges[option.id]}
                        onChange={event => onChange({ ...choice, charges: { ...choice.charges, [option.id]: event.target.value } }, null)}
                        onBlur={() => onChange(choice, { connect_states: connectStatesField(choice) })}
                        inputMode="decimal"
                        placeholder="Free"
                        className={`${field} ${marks(`connect_states[${Object.keys(choice.charges).indexOf(option.id)}]`)}`}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
              {tickedOptions.length > 1 ? (
                <label className="grid gap-1.5 text-sm font-semibold sm:max-w-xs">
                  Use one charge for every {region}
                  <input
                    value={sameCharge}
                    onChange={event => onChange({ ...choice, charges: Object.fromEntries(Object.keys(choice.charges).map(id => [id, event.target.value])) }, null)}
                    onBlur={() => onChange(choice, { connect_states: connectStatesField(choice) })}
                    inputMode="decimal"
                    placeholder="Free"
                    className={field}
                  />
                </label>
              ) : null}
              <p className="text-xs text-slate-600">
                Each charge is what it costs you to get the item to a centre there, and it is yours in full. The buyer also pays a {connectName} fee for the centre.
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-600">There are no open {connectName} Centres in your country yet. You can switch this on now and choose where once they open.</p>
          )}

          {tickedOptions.length ? (
            <div className="grid gap-2">
              <p className="text-sm font-semibold">Centres</p>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={choice.all}
                  onChange={event => {
                    const all = event.target.checked;
                    const centres = all ? [] : tickedOptions.flatMap(option => option.centres.map(centre => centre.id));
                    onChange({ ...choice, all, centres }, { connect_centres: all ? null : centres });
                  }}
                  className="mt-0.5 size-4 accent-navy-900"
                />
                <span>
                  <strong className="block">Every centre in the {region === "state" ? "states" : `${region}s`} I ticked</strong>
                  <span className="text-slate-600">New centres there join by themselves.</span>
                </span>
              </label>
              {!choice.all ? (
                <ul className={`grid gap-1.5 rounded-xl sm:grid-cols-2 ${marks("connect_centres")}`}>
                  {tickedOptions.flatMap(option =>
                    option.centres.map(centre => (
                      <li key={centre.id}>
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={choice.centres.includes(centre.id)}
                            onChange={event => {
                              const centres = event.target.checked ? [...choice.centres, centre.id] : choice.centres.filter(id => id !== centre.id);
                              onChange({ ...choice, centres }, { connect_centres: centres });
                            }}
                            className="mt-0.5 size-4 accent-navy-900"
                          />
                          <span>
                            {centre.name}
                            <span className="block text-xs text-slate-500">
                              {centre.area.name}, {option.name}
                            </span>
                          </span>
                        </label>
                      </li>
                    )),
                  )}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </fieldset>
  );
}
