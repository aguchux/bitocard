"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { money, type PosCustomerBrief } from "@/lib/pos";
import { findCustomers, saveCustomer } from "@/lib/pos-actions";

const input =
  "h-11 w-full min-w-0 rounded-xl border border-pos-line bg-white px-3 text-base";

/**
 * The sale's customer at the till (optional; needed to sell on credit): found by name, mobile or number as the cashier
 * types, or added there with a name and mobile. The shop's own record: no Udozo account needed.
 */
export function TillCustomer({
  customer,
  onChange,
  disabled,
  currency,
}: {
  customer: PosCustomerBrief | null;
  onChange: (customer: PosCustomerBrief | null) => void;
  disabled: boolean;
  currency: string;
}) {
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState("");
  const [found, setFound] = useState<PosCustomerBrief[]>([]);
  const [adding, setAdding] = useState(false);
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || adding) return;
    let alive = true;
    const timer = setTimeout(async () => {
      const result = await findCustomers(words);
      if (alive) setFound(result.ok ? result.data : []);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, adding, words]);

  const choose = (picked: PosCustomerBrief | null) => {
    onChange(picked);
    setOpen(false);
    setAdding(false);
    setWords("");
    setPhone("");
    setMessage(null);
  };

  const add = () =>
    start(async () => {
      const result = await saveCustomer(null, {
        name: words,
        phone: phone || null,
      });
      if (!result.ok) return setMessage(result.message);
      choose(result.data);
    });

  if (customer && !open) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl bg-pos-50 px-3 py-2">
        <span className="min-w-0">
          <span className="block truncate font-semibold text-pos-ink">
            {customer.name}
            {customer.udozo ? (
              <span className="ml-1 text-xs text-pos-700">· Udozo</span>
            ) : null}
          </span>
          {customer.owed ? (
            <span className="text-xs text-pos-warn">
              Owes {money(customer.owed, currency)}
            </span>
          ) : null}
        </span>
        {!disabled ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-sm font-semibold text-pos-ink-2"
          >
            Remove
            <span className="sr-only"> {customer.name} from this sale</span>
          </button>
        ) : null}
      </div>
    );
  }
  if (disabled) return null;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-fit text-sm font-semibold text-pos-700"
      >
        + Customer (optional)
      </button>
    );
  }
  return (
    <div className="grid gap-2 rounded-xl border border-pos-line p-3">
      <label
        htmlFor={`${ids}-find`}
        className="text-sm font-semibold text-pos-ink-2"
      >
        {adding ? "New customer's name" : "Find a customer"}
      </label>
      <input
        id={`${ids}-find`}
        autoFocus
        value={words}
        onChange={(event) => setWords(event.target.value)}
        placeholder={adding ? "Their name" : "Name, mobile or number"}
        autoComplete="off"
        className={input}
      />
      {adding ? (
        <>
          <label
            htmlFor={`${ids}-phone`}
            className="text-sm font-semibold text-pos-ink-2"
          >
            Mobile number (optional)
          </label>
          <input
            id={`${ids}-phone`}
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className={input}
          />
          {message ? (
            <p role="alert" className="text-sm text-pos-error">
              {message}
            </p>
          ) : null}
          <button
            type="button"
            onClick={add}
            disabled={pending || !words.trim()}
            className="h-11 rounded-xl bg-pos-600 font-bold text-white disabled:opacity-50"
          >
            Add and choose
          </button>
        </>
      ) : (
        <ul className="grid gap-1">
          {found.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => choose(item)}
                className="flex w-full justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-pos-50"
              >
                <span className="truncate">{item.name}</span>
                <span className="shrink-0 text-xs text-pos-muted">
                  {item.phone ?? item.number}
                </span>
              </button>
            </li>
          ))}
          {!found.length ? (
            <li className="px-2 text-sm text-pos-muted">
              {words.trim()
                ? "No customer matches."
                : "Your recent customers show here."}
            </li>
          ) : null}
        </ul>
      )}
      <div className="flex gap-3 text-sm font-semibold">
        <button
          type="button"
          onClick={() => setAdding(!adding)}
          className="text-pos-700"
        >
          {adding ? "Find one instead" : "Add a new customer"}
        </button>
        <button
          type="button"
          onClick={() => choose(customer)}
          className="text-pos-ink-2"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
