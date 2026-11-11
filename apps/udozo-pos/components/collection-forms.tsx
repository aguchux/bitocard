"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import {
  dayText,
  money,
  type PosCollection,
  type PosCollectionsOverview,
  readAmount,
} from "@/lib/pos";
import {
  attachCollection,
  closeCollectionAccount,
  keepCollection,
  openCollectionAccount,
  setSettlementAccount,
  simulateCollection,
} from "@/lib/pos-actions";

const label = "text-sm font-semibold text-pos-ink-2";
const input =
  "mt-1 h-12 w-full min-w-0 rounded-xl border border-pos-line bg-white px-4 text-base";
const primary =
  "inline-flex h-12 items-center justify-center rounded-xl bg-pos-600 px-5 font-bold text-white hover:bg-pos-700 disabled:opacity-50";
const quiet =
  "inline-flex h-11 items-center justify-center rounded-xl border border-pos-line bg-white px-4 font-semibold text-pos-ink hover:bg-pos-50 disabled:opacity-50";

function Message({ text, ok }: { text: string | null; ok?: boolean }) {
  if (!text) return null;
  return (
    <p
      role={ok ? "status" : "alert"}
      className={`text-sm ${ok ? "text-pos-700" : "text-pos-error"}`}
    >
      {text}
    </p>
  );
}

/** Where the day's collections are paid: one of the owner's own payout bank accounts on udozo.com. */
export function SettlementAccountForm({
  accounts,
  current,
  addUrl,
}: {
  accounts: PosCollectionsOverview["bank_accounts"];
  current: string | null;
  addUrl: string;
}) {
  const router = useRouter();
  const id = useId();
  const [choice, setChoice] = useState(current ?? "");
  const [message, setMessage] = useState<{ text: string; ok?: boolean } | null>(null);
  const [pending, start] = useTransition();

  if (!accounts.length) {
    return (
      <p className="text-pos-ink-2">
        Add the bank account your collections should go to under Payouts on
        udozo.com, in your own name, then choose it here.{" "}
        <a href={addUrl} className="font-semibold">
          Add a bank account on udozo.com
        </a>
      </p>
    );
  }
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    start(async () => {
      const result = await setSettlementAccount(choice || null);
      if (!result.ok) return setMessage({ text: result.message });
      setMessage({ text: "Saved.", ok: true });
      router.refresh();
    });
  };
  return (
    <form onSubmit={save} className="grid gap-2 sm:max-w-md">
      <label htmlFor={id} className={label}>
        Paid to
      </label>
      <select
        id={id}
        value={choice}
        onChange={(event) => setChoice(event.target.value)}
        className={input}
      >
        <option value="">None: keep them in my Udozo payouts</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.bank_name} ••••{account.last4} · {account.account_name}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending} className={`${primary} w-fit`}>
        {pending ? "Saving…" : "Save"}
      </button>
      <Message text={message?.text ?? null} ok={message?.ok} />
    </form>
  );
}

/** A till's collection account: its number to give buyers, or asking Udozo's banks for one. */
export function TillAccount({
  till,
  blocked,
  bvnRequired,
  sandbox,
  currency,
}: {
  till: PosCollectionsOverview["tills"][number];
  blocked: boolean;
  bvnRequired: boolean;
  sandbox: boolean;
  currency: string;
}) {
  const router = useRouter();
  const ids = useId();
  const [bvn, setBvn] = useState("");
  const [testAmount, setTestAmount] = useState("");
  const [message, setMessage] = useState<{ text: string; ok?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const account = till.collection_account;

  const open = () =>
    start(async () => {
      setMessage(null);
      const result = await openCollectionAccount(till.id, bvn);
      if (!result.ok) return setMessage({ text: result.message });
      setBvn("");
      router.refresh();
    });
  const close = async () => {
    if (!account) return;
    if (
      !(await confirm({
        title: `Close ${till.name}'s account?`,
        body: "No sale will wait on it any more. A transfer still sent to it is credited and paid to you all the same.",
        action: "Close the account",
        tone: "danger",
      }))
    )
      return;
    start(async () => {
      const result = await closeCollectionAccount(account.id);
      if (!result.ok) return setMessage({ text: result.message });
      router.refresh();
    });
  };
  const simulate = () => {
    const amount = readAmount(testAmount);
    if (!account || amount === null || amount <= 0)
      return setMessage({ text: "Give an amount to send." });
    start(async () => {
      const result = await simulateCollection(account.id, amount, "TEST PAYER");
      if (!result.ok) return setMessage({ text: result.message });
      setTestAmount("");
      setMessage({
        text:
          result.data.status === "matched"
            ? `It paid ${result.data.sale?.number ?? "the sale"} at the till.`
            : "It came in, matching no sale: see it under Transfers.",
        ok: true,
      });
      router.refresh();
    });
  };

  return (
    <li className="grid gap-3 rounded-2xl border border-pos-line p-4">
      {dialog}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-bold text-pos-ink">
          {till.name}
          <span className="text-sm font-normal text-pos-muted">
            {" "}
            · {till.shop.name}
          </span>
        </h3>
        {account?.status === "active" ? (
          <button
            type="button"
            onClick={close}
            disabled={pending}
            className="text-sm font-semibold text-pos-error"
          >
            Close account
          </button>
        ) : null}
      </div>
      {account?.status === "active" ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
          <dt className="text-pos-muted">Bank</dt>
          <dd className="font-semibold text-pos-ink">{account.bank_name}</dd>
          <dt className="text-pos-muted">Account number</dt>
          <dd className="font-display text-xl font-bold tracking-wide text-pos-ink">
            {account.account_number}
          </dd>
          <dt className="text-pos-muted">Name</dt>
          <dd className="text-pos-ink">{account.account_name}</dd>
        </dl>
      ) : account?.status === "opening" ? (
        <p className="text-pos-ink-2">
          The bank is still opening it. Try again in a minute.
        </p>
      ) : null}
      {account?.status !== "active" ? (
        <div className="grid gap-2 sm:max-w-md">
          {bvnRequired ? (
            <div>
              <label htmlFor={`${ids}-bvn`} className={label}>
                Your BVN
              </label>
              <input
                id={`${ids}-bvn`}
                inputMode="numeric"
                autoComplete="off"
                value={bvn}
                onChange={(event) => setBvn(event.target.value)}
                maxLength={11}
                className={input}
              />
              <p className="mt-1 text-xs text-pos-muted">
                The banks need it to open the account. Udozo passes it on and
                never keeps it.
              </p>
            </div>
          ) : null}
          <button
            type="button"
            onClick={open}
            disabled={pending || blocked}
            className={`${primary} w-fit`}
          >
            {pending
              ? "Asking the bank…"
              : account?.status === "opening"
                ? "Try again"
                : "Get an account number"}
          </button>
        </div>
      ) : sandbox ? (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={`${ids}-test`} className={label}>
              Send a test transfer ({currency})
            </label>
            <input
              id={`${ids}-test`}
              inputMode="decimal"
              value={testAmount}
              onChange={(event) => setTestAmount(event.target.value)}
              className={`${input} w-40`}
            />
          </div>
          <button type="button" onClick={simulate} disabled={pending} className={quiet}>
            Send
          </button>
        </div>
      ) : null}
      <Message text={message?.text ?? null} ok={message?.ok} />
    </li>
  );
}

/** An unmatched transfer: attach it to the sale it was for (which makes the sale), or keep it for no sale. */
export function UnmatchedActions({ collection }: { collection: PosCollection }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const amount = money(collection.amount, collection.currency);

  const attach = async (request: NonNullable<PosCollection["attachable"]>[number]) => {
    if (
      !(await confirm({
        title: `Use this transfer for ${request.number}?`,
        body: `${amount} pays the sale asked at ${request.till ?? "the till"} on ${dayText(request.created_at.slice(0, 10))}. The sale is made now and its items come off stock.`,
        action: "Make the sale",
      }))
    )
      return;
    start(async () => {
      const result = await attachCollection(collection.id, request.id);
      if (!result.ok) return setMessage(result.message);
      router.refresh();
    });
  };
  const keep = async () => {
    const answer = await confirm({
      title: "Keep it for no sale?",
      body: `${amount} is paid to your bank with the day's collections. If it was sent by mistake, paying the sender back is yours to do.`,
      action: "Keep it",
      reason: { label: "What it was for (optional)", placeholder: "A deposit for an order" },
    });
    if (!answer) return;
    start(async () => {
      const result = await keepCollection(collection.id, answer.reason);
      if (!result.ok) return setMessage(result.message);
      router.refresh();
    });
  };
  return (
    <div className="grid gap-2">
      {dialog}
      <div className="flex flex-wrap gap-2">
        {(collection.attachable ?? []).map((request) => (
          <button
            key={request.id}
            type="button"
            onClick={() => attach(request)}
            disabled={pending}
            className={quiet}
          >
            Use for {request.number}
            {request.till ? ` (${request.till})` : ""}
          </button>
        ))}
        <button type="button" onClick={keep} disabled={pending} className={quiet}>
          Keep it
        </button>
      </div>
      <Message text={message} />
    </div>
  );
}
