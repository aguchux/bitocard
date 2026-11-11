"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import {
  money,
  paymentMethods,
  type PosCustomer,
  type PosPaymentMethod,
  readAmount,
} from "@/lib/pos";
import { removeCustomer, repayCustomer, saveCustomer } from "@/lib/pos-actions";

const label = "text-sm font-semibold text-pos-ink-2";
const input =
  "mt-1 h-12 w-full min-w-0 rounded-xl border border-pos-line bg-white px-4 text-base";
const primary =
  "inline-flex h-12 items-center justify-center rounded-xl bg-pos-600 px-5 font-bold text-white hover:bg-pos-700 disabled:opacity-50";

/** A customer's details: the shop's own record. Adding one opens its page; changing one stays on it. */
export function CustomerForm({
  customer,
  currency,
}: {
  customer: PosCustomer | null;
  currency: string;
}) {
  const router = useRouter();
  const ids = useId();
  const [form, setForm] = useState({
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    address: customer?.address ?? "",
    notes: customer?.notes ?? "",
    limit:
      customer?.credit_limit != null ? String(customer.credit_limit / 100) : "",
  });
  const [message, setMessage] = useState<{
    text: string;
    param: string | null;
    ok?: boolean;
  } | null>(null);
  const [pending, start] = useTransition();

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const limit = form.limit.trim() === "" ? null : readAmount(form.limit);
    if (form.limit.trim() !== "" && limit === null)
      return setMessage({
        text: "Give the credit limit as an amount, or leave it empty for none.",
        param: "credit_limit",
      });
    start(async () => {
      const result = await saveCustomer(customer?.id ?? null, {
        name: form.name,
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        notes: form.notes || null,
        credit_limit: limit,
      });
      if (!result.ok)
        return setMessage({ text: result.message, param: result.param });
      if (!customer) return router.push(`/app/customers/${result.data.id}`);
      setMessage({ text: "Saved.", param: null, ok: true });
      router.refresh();
    });
  };

  const field = (
    key: keyof typeof form,
    text: string,
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
    param: string = key,
  ) => (
    <div>
      <label htmlFor={`${ids}-${key}`} className={label}>
        {text}
      </label>
      <input
        id={`${ids}-${key}`}
        value={form[key]}
        onChange={(event) => setForm({ ...form, [key]: event.target.value })}
        aria-invalid={message?.param === param}
        className={input}
        {...extra}
      />
    </div>
  );

  return (
    <form onSubmit={save} className="grid gap-3 rounded-[20px] bg-white p-5">
      {field("name", "Name", { required: true, maxLength: 120 })}
      <div className="grid gap-3 sm:grid-cols-2">
        {field("phone", "Mobile number (optional)", {
          type: "tel",
          inputMode: "tel",
          maxLength: 30,
        })}
        {field("email", "Email (optional)", { type: "email", maxLength: 254 })}
      </div>
      {field("address", "Address (optional)", { maxLength: 300 })}
      {field(
        "limit",
        `Credit limit for paying later, in ${currency} (optional)`,
        { inputMode: "decimal", placeholder: "No limit" },
        "credit_limit",
      )}
      <div>
        <label htmlFor={`${ids}-notes`} className={label}>
          Notes (optional)
        </label>
        <textarea
          id={`${ids}-notes`}
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
          maxLength={1000}
          rows={3}
          className="mt-1 w-full rounded-xl border border-pos-line bg-white px-4 py-3 text-base"
        />
      </div>
      <p className="text-xs text-pos-muted">
        Their receipts can go to this mobile on WhatsApp, or to this email.
        Only your shop and Udozo&apos;s team see this record.
      </p>
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "text-pos-700" : "text-pos-error"}
        >
          {message.text}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={`${primary} w-fit`}>
        {customer ? "Save" : "Add customer"}
      </button>
    </form>
  );
}

/** Recording a repayment of what a customer owes, as it was paid. */
export function Repayment({
  customer,
  currency,
}: {
  customer: PosCustomer;
  currency: string;
}) {
  const router = useRouter();
  const ids = useId();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PosPaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const repay = (event: React.FormEvent) => {
    event.preventDefault();
    const minor = amount.trim() === "" ? customer.owed : readAmount(amount);
    if (minor === null || minor < 1)
      return setMessage("Give how much they paid.");
    start(async () => {
      const result = await repayCustomer(customer.id, minor, method, reference);
      if (!result.ok) return setMessage(result.message);
      setMessage(null);
      setAmount("");
      setReference("");
      router.refresh();
    });
  };

  return (
    <form onSubmit={repay} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`${ids}-amount`} className={label}>
            Amount paid
          </label>
          <input
            id={`${ids}-amount`}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={(customer.owed / 100).toFixed(2)}
            className={input}
          />
        </div>
        <div>
          <label htmlFor={`${ids}-method`} className={label}>
            Paid by
          </label>
          <select
            id={`${ids}-method`}
            value={method}
            onChange={(event) =>
              setMethod(event.target.value as PosPaymentMethod)
            }
            className={input}
          >
            {paymentMethods.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-reference`} className={label}>
            Reference (optional)
          </label>
          <input
            id={`${ids}-reference`}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            maxLength={80}
            className={input}
          />
        </div>
      </div>
      {message ? (
        <p role="alert" className="text-pos-error">
          {message}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={`${primary} w-fit`}>
        Record{" "}
        {amount.trim()
          ? "repayment"
          : `full repayment of ${money(customer.owed, currency)}`}
      </button>
    </form>
  );
}

/** Removing a customer with no sales and nothing owed (the API keeps one with history). */
export function RemoveCustomer({ customer }: { customer: PosCustomer }) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const remove = async () => {
    if (
      !(await confirm({
        title: `Remove ${customer.name}?`,
        body: <p>Their record leaves your customers.</p>,
        action: "Remove customer",
        tone: "danger",
      }))
    )
      return;
    start(async () => {
      const result = await removeCustomer(customer.id);
      if (!result.ok) return setMessage(result.message);
      router.push("/app/customers");
    });
  };
  return (
    <div>
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="text-sm font-semibold text-pos-error disabled:opacity-50"
      >
        Remove this customer
      </button>
      {message ? (
        <p role="alert" className="mt-1 text-sm text-pos-error">
          {message}
        </p>
      ) : null}
      {dialog}
    </div>
  );
}
