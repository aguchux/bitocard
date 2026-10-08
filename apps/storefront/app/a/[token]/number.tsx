import { AlertTriangle, CalendarClock, Inbox, Phone, Trash2 } from "lucide-react";
import type { ProductFeature } from "@bitocard/api-client/storefront";
import { RefreshWhile } from "@/components/store/order-status";
import { FeatureIcons } from "@/components/store/features";
import type { NumberMessage, OrderNumber } from "@/lib/access";
import { AutoRenew, CopyMessage, RefreshInbox, RenewNumber, SendMessage } from "./number-client";
import { sentStatus } from "./sms";

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(iso));
const dateTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

function Message({ message }: { message: NumberMessage }) {
  const incoming = message.direction === "in";
  return (
    <li className={`flex ${incoming ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[90%] min-w-0 rounded-2xl p-3 sm:max-w-[80%] ${incoming ? "rounded-tl-sm border border-slate-200 bg-white" : "rounded-tr-sm bg-[#070f4c] text-white"}`}>
        <p className={`text-xs font-semibold ${incoming ? "text-slate-500" : "text-white/75"}`}>
          {incoming ? `From ${message.from}` : `To ${message.to}`}
        </p>
        <p className="mt-1 break-words whitespace-pre-wrap">{message.text}</p>
        <div className={`mt-2 flex flex-wrap items-center justify-between gap-2 text-xs ${incoming ? "text-slate-500" : "text-white/75"}`}>
          <span>
            <time dateTime={message.created_at}>{dateTime(message.created_at)}</time>
            {incoming ? null : (
              <>
                {" · "}
                <span className={message.status === "failed" ? "font-semibold text-[#ff8fbd]" : undefined}>{sentStatus[message.status] ?? message.status}</span>
              </>
            )}
          </span>
          {incoming ? <CopyMessage text={message.text} /> : null}
        </div>
      </div>
    </li>
  );
}

/**
 * A virtual number, live: whether it is paid up, its messages (received and sent, newest first) and, where the
 * store allows it, a form to send one. The customer renews it (now, or automatically each month, paid by the store);
 * a number left unrenewed is paused at expiry and deleted 15 days later.
 */
export function NumberLive({ token, data, features }: { token: string; data: NonNullable<OrderNumber["number"]>; features: string[] }) {
  const deleted = data.status === "deleted";
  return (
    <section aria-labelledby="number" className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
      <RefreshWhile active={!deleted} everyMs={15000} />
      <h2 id="number" className="flex items-center gap-2 text-xl font-bold">
        <Phone className="size-5 text-[#ff2382]" aria-hidden="true" /> Your number
      </h2>
      <p className={`mt-3 font-mono text-2xl font-extrabold tracking-wide break-all sm:text-3xl ${deleted ? "text-slate-400 line-through" : ""}`}>{data.number}</p>

      {data.status === "active" ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-slate-600">
          <CalendarClock className="size-4 shrink-0" aria-hidden="true" /> Paid up to {date(data.expires_at)}.
        </p>
      ) : data.status === "expired" ? (
        <div className="mt-3 flex items-start gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>
            This number expired on {date(data.expires_at)} and is paused: it does not receive messages. Renew it by {date(data.delete_at)} to keep it; after that it is deleted for good.
          </p>
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-3 rounded-2xl bg-slate-100 p-4 text-sm text-slate-700">
          <Trash2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>This number was not renewed and has been deleted.</p>
        </div>
      )}

      {data.can_renew ? (
        <div className="mt-4 grid gap-4 rounded-2xl border border-slate-200 p-4">
          <RenewNumber token={token} />
          <AutoRenew token={token} enabled={data.auto_renew} />
        </div>
      ) : null}

      {features.length ? (
        <div className="mt-5">
          <p className="mb-2 text-sm font-semibold">What it can do</p>
          <FeatureIcons features={features as ProductFeature[]} />
        </div>
      ) : null}
      <p className="mt-5 text-sm text-slate-500">Some apps and services do not accept virtual numbers.</p>

      {deleted ? null : (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-5">
            <h3 className="flex items-center gap-2 font-bold">
              <Inbox className="size-5 text-[#ff2382]" aria-hidden="true" /> Messages
            </h3>
            <RefreshInbox />
          </div>
          {data.messages.length ? (
            <ul aria-label="Messages, newest first" className="mt-4 grid gap-3 rounded-2xl bg-[#f8f9fc] p-3 sm:p-4">
              {data.messages.map((message, index) => (
                <Message key={`${message.created_at}-${index}`} message={message} />
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-2xl bg-[#f8f9fc] p-4 text-sm text-slate-600">No messages yet. Messages sent to this number appear here.</p>
          )}
          {data.can_send ? <SendMessage token={token} /> : null}
        </>
      )}
    </section>
  );
}
