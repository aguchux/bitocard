"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, RefreshCw, Send } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  ErrorState,
  errorMessage,
  Field,
  formatDate,
  formatDateTime,
  formatMoney,
  Input,
  KeyValue,
  LoadMore,
  Notice,
  PageHeader,
  RefreshFailed,
  Skeleton,
  StatusBadge,
  Textarea,
  Toggle,
} from "@bitocard/admin-ui";
import {
  type NumberMessage,
  smsLimit,
  type VirtualNumber,
  useNumberMessagesInfiniteQuery,
  useNumberRenewalPriceQuery,
  useRenewNumberMutation,
  useResellerNumberQuery,
  useSendNumberMessageMutation,
  useUpdateNumberMutation,
} from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

/** How often the messages are checked while the page is open. */
const messagesPollMs = 15_000;

const renewalErrors: Record<string, string> = { insufficient_funds: "Last renewal failed: your wallet was short." };

/** A setting with its switch on the right. */
function Setting({ title, help, checked, label, disabled, onChange }: { title: string; help: string; checked: boolean; label: string; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-sm text-muted">{help}</p>
      </div>
      <Toggle checked={checked} label={label} disabled={disabled} onChange={onChange} />
    </div>
  );
}

function RenewalCard({ number, canRenew, canChange }: { number: VirtualNumber; canRenew: boolean; canChange: boolean }) {
  const deleted = number.status === "deleted";
  const priceQuery = useNumberRenewalPriceQuery(number.id, { skip: deleted });
  const price = priceQuery.data;
  const [update, updateState] = useUpdateNumberMutation();
  const [renew, renewState] = useRenewNumberMutation();
  const [confirming, setConfirming] = useState(false);
  const priceText = price ? formatMoney(price.amount, price.currency) : null;

  return (
    <Card>
      <CardHeader title="Renewal" description="A month at a time, always paid from your wallet, whoever renews it." />
      <div className="space-y-5 p-5 sm:p-6">
        <KeyValue
          items={[
            { label: deleted ? "Was paid up to" : "Paid up to", value: formatDateTime(number.expires_at) },
            {
              label: "A month's renewal",
              value: deleted ? "—" : priceText ?? (priceQuery.error ? <span className="text-red-700">{errorMessage(priceQuery.error, "Could not get the price.")}</span> : <Skeleton className="h-5 w-20" />),
            },
          ]}
        />
        {!deleted ? (
          <p className="text-sm text-muted">
            Your customer can renew from their order page. Keep enough in your wallet: a renewal your wallet cannot cover does not happen, and your customer is asked to contact you.
          </p>
        ) : null}
        {number.renewal_error && !deleted ? <Notice tone="amber">{renewalErrors[number.renewal_error] ?? "Last renewal failed."}</Notice> : null}
        {!deleted ? (
          <Setting
            title="Auto-renew"
            help="Your customer can switch this on their order page. Each renewal is taken from your wallet; it only renews when your wallet has the funds."
            label="Auto-renew"
            checked={number.auto_renew}
            disabled={!canChange}
            onChange={auto_renew => void update({ id: number.id, auto_renew })}
          />
        ) : null}
        {updateState.error ? <Notice tone="red">{errorMessage(updateState.error)}</Notice> : null}
        {canRenew && !deleted ? (
          <div className="flex flex-wrap gap-2">
            <Button icon={<RefreshCw className="size-4" aria-hidden />} disabled={!price} onClick={() => setConfirming(true)}>
              Renew for a month
            </Button>
          </div>
        ) : null}
      </div>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Renew for a month?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              loading={renewState.isLoading}
              onClick={async () => {
                const result = await renew(number.id);
                if (!("error" in result)) setConfirming(false);
              }}
            >
              Renew
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>{`${priceText ?? "The renewal price"} is taken from your wallet now, and ${number.number} is paid for a further month.`}</p>
          {renewState.error ? <Notice tone="red">{errorMessage(renewState.error)}</Notice> : null}
        </div>
      </Dialog>
    </Card>
  );
}

function CustomerCard({ number, canChange }: { number: VirtualNumber; canChange: boolean }) {
  const [update, updateState] = useUpdateNumberMutation();
  return (
    <Card>
      <CardHeader title="Customer page" description="What your customer can do on the order's page." />
      <div className="space-y-4 p-5 sm:p-6">
        {number.sends_sms ? (
          <Setting
            title="Customer sending"
            help="Let your customer send SMS from the order's page; each message is charged to your wallet."
            label="Customer sending"
            checked={number.customer_sending}
            disabled={!canChange || number.status === "deleted"}
            onChange={customer_sending => void update({ id: number.id, customer_sending })}
          />
        ) : (
          <p className="text-sm text-muted">This number cannot send SMS. Your customer sees the messages it receives.</p>
        )}
        {updateState.error ? <Notice tone="red">{errorMessage(updateState.error)}</Notice> : null}
        <Link href={`/orders/${number.order_id}`} className="inline-flex text-sm font-semibold text-brand-600 hover:underline">
          View the order and its customer link
        </Link>
      </div>
    </Card>
  );
}

function Message({ message }: { message: NumberMessage }) {
  const incoming = message.direction === "in";
  return (
    <li className="space-y-2 px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={incoming ? "inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold text-blue-700" : "inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold text-brand-700"}>
          {incoming ? <ArrowDownLeft className="size-4 shrink-0" aria-hidden /> : <ArrowUpRight className="size-4 shrink-0" aria-hidden />}
          <span className="break-all">{incoming ? `From ${message.from}` : `To ${message.to}`}</span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {message.charged !== null && message.currency ? <span className="text-xs text-muted">{formatMoney(message.charged, message.currency)}</span> : null}
          <StatusBadge status={message.status} />
        </span>
      </div>
      <p className={incoming ? "whitespace-pre-wrap break-words rounded-xl bg-canvas px-4 py-3 text-sm" : "whitespace-pre-wrap break-words rounded-xl bg-brand-50 px-4 py-3 text-sm"}>
        {message.text ?? <span className="text-muted">No text.</span>}
      </p>
      <p className="text-xs text-muted">
        {formatDateTime(message.created_at)}
        {message.failure_reason ? <span className="text-red-700">{` · ${message.failure_reason}`}</span> : null}
      </p>
    </li>
  );
}

function SendForm({ number }: { number: VirtualNumber }) {
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [send, sendState] = useSendNumberMessageMutation();
  const limit = smsLimit(text);
  const tooLong = text.length > limit;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await send({ id: number.id, to: to.trim(), text });
    if (!("error" in result)) setText("");
  };
  return (
    <form onSubmit={submit} className="space-y-4 border-t border-line p-5 sm:p-6">
      <p className="text-sm font-semibold">Send an SMS</p>
      <Field label="To" htmlFor="sms-to" hint="In international format, for example +447700900123.">
        <Input id="sms-to" type="tel" inputMode="tel" autoComplete="off" value={to} onChange={event => setTo(event.target.value)} placeholder="+447700900123" required maxLength={20} />
      </Field>
      <Field
        label="Message"
        htmlFor="sms-text"
        hint={<span className={tooLong ? "text-red-700" : undefined}>{`${text.length}/${limit} characters${limit === 70 ? " (special characters allow 70)" : ""}. Each message is charged to your wallet.`}</span>}
      >
        <Textarea id="sms-text" value={text} onChange={event => setText(event.target.value)} required rows={3} aria-invalid={tooLong || undefined} />
      </Field>
      {sendState.error ? <Notice tone="red">{errorMessage(sendState.error)}</Notice> : null}
      <Button type="submit" icon={<Send className="size-4" aria-hidden />} loading={sendState.isLoading} disabled={!to.trim() || !text.trim() || tooLong}>
        Send
      </Button>
    </form>
  );
}

function MessagesCard({ number, canSend }: { number: VirtualNumber; canSend: boolean }) {
  // Checked every 15 seconds while the page is open (paused while the tab is in the background).
  const query = useNumberMessagesInfiniteQuery(number.id, { pollingInterval: messagesPollMs, skipPollingIfUnfocused: true });
  const messages = query.data?.pages.flatMap(page => page.data);
  return (
    <Card>
      <CardHeader title="Messages" description="Newest first. Received messages are shown to your customer on the order's page too." />
      {!messages ? (
        query.error ? (
          <ErrorState message={errorMessage(query.error, "Could not load the messages.")} onRetry={query.refetch} />
        ) : (
          <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading messages">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )
      ) : (
        <>
          {query.error && !query.isFetching ? (
            <div className="px-5 pt-4 sm:px-6">
              <RefreshFailed message={errorMessage(query.error, "Could not refresh the messages.")} onRetry={query.refetch} />
            </div>
          ) : null}
          {messages.length ? (
            <ul className="divide-y divide-line">
              {messages.map(message => (
                <Message key={message.id} message={message} />
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-sm text-muted sm:px-6">No messages yet.</p>
          )}
          <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} />
        </>
      )}
      {canSend && number.sends_sms && number.status === "active" ? <SendForm number={number} /> : null}
    </Card>
  );
}

export default function NumberPage() {
  const { id } = useParams<{ id: string }>();
  const { membership } = useReseller();
  const { data: number, error, isFetching, refetch } = useResellerNumberQuery(id);
  const title = number?.number ?? "Number";

  return (
    <ShqShell section="orders" current="/numbers" crumbs={[{ label: "Orders", href: "/orders" }, { label: "Numbers", href: "/numbers" }, { label: title }]}>
      {!number ? (
        error ? (
          <Card>
            <ErrorState message={errorMessage(error, "Could not load this number.")} onRetry={refetch} />
          </Card>
        ) : (
          <div className="space-y-4" aria-busy="true" aria-label="Loading number">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-64 w-full" />
          </div>
        )
      ) : (
        <>
          {error && !isFetching ? <RefreshFailed message={errorMessage(error, "Could not load this number.")} onRetry={refetch} /> : null}
          <PageHeader
            title={
              <span className="flex flex-wrap items-center gap-3">
                <span className="break-all font-mono">{number.number}</span>
                <StatusBadge status={number.status} />
                {number.mode === "test" ? <StatusBadge status="draft" label="Sandbox" /> : null}
              </span>
            }
            description={`Virtual number · since ${formatDate(number.created_at)}`}
          />

          {number.status === "expired" ? (
            <Notice tone="amber" title="Paused">
              {`Paused since ${formatDateTime(number.expires_at)}. Renew by ${formatDateTime(number.delete_at)} or it is deleted for good.`}
            </Notice>
          ) : null}
          {number.status === "deleted" ? <Notice tone="grey">This number was not renewed and has been released for good. It cannot be renewed.</Notice> : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <RenewalCard number={number} canRenew={can(membership, "admin", "developer", "finance")} canChange={can(membership, "admin", "developer")} />
            <CustomerCard number={number} canChange={can(membership, "admin", "developer")} />
          </div>

          <MessagesCard number={number} canSend={can(membership, "admin", "developer", "support")} />
        </>
      )}
    </ShqShell>
  );
}
