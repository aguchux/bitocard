import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing } from "lucide-react";
import type { ShopCall, ShopContactRequest, ShopContactShare } from "@bitocard/api-client/classifieds";
import { PageTitle } from "@/components/account/nav";
import { RequestButtons, StopSharing } from "@/components/account/request-buttons";
import { requireSeller } from "@/lib/account";
import { customerApi } from "@/lib/customer";
import { callLine, requestOutcome } from "@/lib/requests";

export const metadata: Metadata = { title: "Requests" };

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const card = "grid gap-3 rounded-2xl border border-slate-200 bg-white p-4";
const empty = "rounded-2xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-600";

/**
 * What buyers asked of the seller: contact requests to accept (their phone and email are then shown to that buyer on
 * every listing) or decline, call backs (the buyer's name, mobile and email, shown only while it waits), calls in the
 * browser, and the buyers who can see the seller's details, with Stop sharing.
 */
export default async function Requests() {
  await requireSeller("/account/requests");
  const [requests, calls, shares] = await Promise.all([
    customerApi<{ pending: number; data: ShopContactRequest[] }>("GET", "/v1/classifieds/me/contact-requests?limit=100"),
    customerApi<{ data: ShopCall[] }>("GET", "/v1/classifieds/me/calls"),
    customerApi<{ data: ShopContactShare[] }>("GET", "/v1/classifieds/me/contact-shares"),
  ]);
  if (!requests.ok) {
    return (
      <div className="grid gap-5">
        <PageTitle title="Requests" post={false} />
        <p className={empty}>Your requests could not be loaded just now. Try again shortly.</p>
      </div>
    );
  }
  const waiting = requests.data.data.filter(request => request.status === "pending");
  const answered = requests.data.data.filter(request => request.status !== "pending").slice(0, 30);
  const recentCalls = calls.ok ? calls.data.data.filter(call => call.status !== "ringing" && call.status !== "answered") : [];
  return (
    <div className="grid gap-7">
      <PageTitle title="Requests" note="Buyers asking for your contact or a call back, and calls on Udozo. Your details are never on your listings." post={false} />

      <section aria-labelledby="waiting" className="grid gap-3">
        <h2 id="waiting" className="text-lg font-bold">
          Waiting for you{waiting.length ? ` (${waiting.length})` : ""}
        </h2>
        {waiting.length ? (
          <ul className="grid gap-3">
            {waiting.map(request => (
              <li key={request.id} className={card}>
                <div className="grid gap-1">
                  <strong>{request.kind === "callback" ? `${request.with.name} asked you to call them back` : `${request.with.name} asked for your contact details`}</strong>
                  <span className="text-sm text-slate-600">
                    About{" "}
                    <Link href={request.listing.path} className="font-semibold text-navy-900 underline-offset-2 hover:underline">
                      {request.listing.title ?? "your listing"}
                    </Link>{" "}
                    · {when(request.created_at)}
                  </span>
                  {request.note ? <p className="rounded-xl bg-slate-50 p-3 text-sm text-navy-800">“{request.note}”</p> : null}
                </div>
                {request.kind === "callback" ? (
                  <div className="grid gap-1.5 text-sm">
                    {request.with.phone ? (
                      <a href={`tel:${request.with.phone}`} className="flex min-h-10 items-center gap-2 font-bold text-navy-900 hover:underline">
                        <Phone className="size-4" aria-hidden="true" /> {request.with.phone}
                      </a>
                    ) : null}
                    {request.with.email ? (
                      <a href={`mailto:${request.with.email}`} className="flex min-h-10 items-center gap-2 font-semibold break-all text-navy-900 hover:underline">
                        <Mail className="size-4" aria-hidden="true" /> {request.with.email}
                      </a>
                    ) : null}
                    <p className="text-xs text-slate-500">Shown to you until you mark it done. Use them only to call about this listing.</p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-600">If you share, they see your confirmed phone number and your email on all your listings, until you stop sharing.</p>
                )}
                <RequestButtons id={request.id} actions={request.kind === "callback" ? ["done", "dismiss"] : ["accept", "decline"]} />
              </li>
            ))}
          </ul>
        ) : (
          <p className={empty}>Nothing waiting. Buyers can ask for your contact or a call back from your listings.</p>
        )}
      </section>

      <section aria-labelledby="calls" className="grid gap-3">
        <h2 id="calls" className="text-lg font-bold">
          Calls
        </h2>
        <p className="text-sm text-slate-600">While you have Udozo open, buyers can call you here. Calls are private: no numbers are shared, and they are not recorded.</p>
        {recentCalls.length ? (
          <ul className="grid divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {recentCalls.map(call => {
              const Icon = call.role === "caller" ? PhoneOutgoing : call.status === "missed" ? PhoneMissed : PhoneIncoming;
              return (
                <li key={call.id} className="flex items-center gap-3 p-3.5">
                  <Icon className={`size-5 shrink-0 ${call.status === "missed" && call.role === "callee" ? "text-brand-700" : "text-navy-600"}`} aria-hidden="true" />
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate text-sm font-semibold">
                      {call.with.name} · {callLine(call)}
                    </span>
                    <Link href={call.listing.path} className="truncate text-xs text-slate-600 hover:underline">
                      {call.listing.title ?? "A listing"} · {when(call.created_at)}
                    </Link>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={empty}>No calls yet.</p>
        )}
      </section>

      <section aria-labelledby="shared" className="grid gap-3">
        <h2 id="shared" className="text-lg font-bold">
          Who can see your contact
        </h2>
        {shares.ok && shares.data.data.length ? (
          <ul className="grid divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {shares.data.data.map(share => (
              <li key={share.buyer.id} className="flex items-center justify-between gap-3 p-3.5">
                <span className="grid">
                  <strong className="text-sm">{share.buyer.name}</strong>
                  <span className="text-xs text-slate-500">Since {when(share.since)}</span>
                </span>
                <StopSharing buyerId={share.buyer.id} name={share.buyer.name} />
              </li>
            ))}
          </ul>
        ) : (
          <p className={empty}>Nobody yet: your phone and email stay private until you share them.</p>
        )}
      </section>

      {answered.length ? (
        <section aria-labelledby="answered" className="grid gap-3">
          <h2 id="answered" className="text-lg font-bold">
            Answered
          </h2>
          <ul className="grid divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {answered.map(request => (
              <li key={request.id} className="grid gap-0.5 p-3.5 text-sm">
                <span>
                  <strong>{request.with.name}</strong> · {request.kind === "callback" ? "Call back" : "Contact request"} · {requestOutcome(request)}
                </span>
                <Link href={request.listing.path} className="truncate text-xs text-slate-600 hover:underline">
                  {request.listing.title ?? "A listing"} · {when(request.created_at)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
