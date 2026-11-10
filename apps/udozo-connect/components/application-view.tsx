"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type ActionResult, confirmVisit, rescheduleVisit, withdrawApplication } from "@/lib/actions";
import { type Application, money, statusWords, timeline, underWay, when } from "@/lib/connect";
import { useConfirm } from "./confirm-dialog";

const primary = "inline-flex min-h-11 items-center justify-center rounded-xl bg-navy-900 px-5 font-semibold text-white hover:bg-navy-800 disabled:opacity-50";
const secondary = "inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-5 font-semibold text-navy-900 hover:bg-slate-50 disabled:opacity-50";

/** The applicant's application: where it stands, what happened, and what they can do now. */
export function ApplicationView({ application }: { application: Application }) {
  const router = useRouter();
  const [app, setApp] = useState(application);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();

  const take = (result: ActionResult) => {
    if (result.ok) {
      setApp(result.application);
      setError(null);
      router.refresh();
    } else setError(result.message);
  };

  const deposit = app.deposit;
  const depositPaid = deposit.paid_at !== null;
  const visitWaiting = app.status === "visit_scheduled" && app.visit && !app.visit.visited_at;

  const withdraw = async () => {
    const answer = await confirm({
      title: "Withdraw your application?",
      body: depositPaid ? "Your application stops and your deposit goes back to your UdozoPay wallet. You can apply again later." : "Your application stops. You can apply again later.",
      action: "Withdraw application",
      dismiss: "Keep it",
      tone: "danger",
    });
    if (answer) start(async () => take(await withdrawApplication(app.id)));
  };

  const reschedule = async () => {
    const answer = await confirm({
      title: "Ask for another time",
      body: "Tell Udozo when suits you better, and they will arrange the visit again.",
      action: "Send",
      reason: { label: "When suits you", required: true, placeholder: "For example: any weekday after 2pm" },
    });
    if (answer) start(async () => take(await rescheduleVisit(app.id, answer.reason)));
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {dialog}
      <p className="text-sm font-semibold text-slate-500">Application {app.number}</p>
      <h1 className="mt-1 text-2xl font-extrabold text-navy-900 sm:text-3xl">{app.business_name ?? "Your Connect Centre application"}</h1>
      <p className="mt-2">
        <span className="inline-flex rounded-full bg-navy-100 px-3 py-1 text-sm font-semibold text-navy-900" data-status={app.status}>
          {statusWords[app.status]}
        </span>
      </p>
      {error ? (
        <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 font-semibold text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      {app.status === "draft" ? (
        <Panel title="Not sent yet">
          <p>Finish your application and send it to Udozo.</p>
          <a href="/apply" className={`${primary} mt-3`}>
            Carry on
          </a>
        </Panel>
      ) : null}

      {app.status === "changes_requested" && app.changes ? (
        <Panel title="Udozo asked for changes" tone="warn">
          <p>{app.changes.note}</p>
          <a href="/apply" className={`${primary} mt-3`}>
            Make the changes
          </a>
        </Panel>
      ) : null}

      {app.status === "submitted" ? (
        <Panel title="Udozo is reviewing it">
          <p>Udozo&apos;s team reads your application, then arranges a visit to your office. We will tell you at each step.</p>
        </Panel>
      ) : null}

      {visitWaiting && app.visit ? (
        <Panel title="A visit to your office">
          <p>
            <strong>{when(app.visit.at, app.country)}</strong>
            {app.visit.visitor ? (
              <>
                {" "}
                by {app.visit.visitor.name} from Udozo
                {app.visit.visitor.phone ? (
                  <>
                    {" "}
                    (
                    <a href={`tel:${app.visit.visitor.phone}`} className="font-semibold text-brand-600 hover:underline">
                      {app.visit.visitor.phone}
                    </a>
                    )
                  </>
                ) : null}
              </>
            ) : null}
            .
          </p>
          {app.visit.note ? <p className="mt-2">{app.visit.note}</p> : null}
          {app.visit.confirmed_at ? (
            <p className="mt-3 font-semibold text-emerald-800">You confirmed this time.</p>
          ) : app.visit.reschedule_note ? (
            <p className="mt-3 text-slate-700">You asked for another time: &ldquo;{app.visit.reschedule_note}&rdquo;. Udozo will be in touch.</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {!app.visit.confirmed_at ? (
              <button type="button" disabled={busy} onClick={() => start(async () => take(await confirmVisit(app.id)))} className={primary}>
                Confirm this time
              </button>
            ) : null}
            <button type="button" disabled={busy} onClick={reschedule} className={secondary}>
              Ask for another time
            </button>
          </div>
        </Panel>
      ) : null}

      {app.status === "visited" ? (
        <Panel title="Udozo visited your office">
          <p>Thank you for having us. Udozo&apos;s team will tell you the outcome soon.</p>
        </Panel>
      ) : null}

      {app.status === "approved" ? (
        <Panel title="You are a Udozo Connect Centre" tone="good">
          <p>{app.centre ? <>Your centre number is <strong>{app.centre.number}</strong>.</> : null} Set up its storage places and staff, and run it from here.</p>
          {app.centre ? (
            <a href={`/centre/${app.centre.id}`} className={`${primary} mt-3`}>
              Open your centre
            </a>
          ) : null}
        </Panel>
      ) : null}

      {app.status === "rejected" ? (
        <Panel title="Your application was not approved" tone="warn">
          {app.decision?.reason ? <p>{app.decision.reason}</p> : null}
          {depositPaid ? <p className="mt-2">Your deposit is back in your UdozoPay wallet.</p> : null}
        </Panel>
      ) : null}

      {app.status === "withdrawn" ? (
        <Panel title="You withdrew this application">
          <p>{depositPaid ? "Your deposit is back in your UdozoPay wallet. " : ""}You can apply again whenever you are ready.</p>
          <a href="/apply" className={`${secondary} mt-3`}>
            Apply again
          </a>
        </Panel>
      ) : null}

      <section className="mt-6 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-extrabold text-navy-900">What has happened</h2>
        <ol className="mt-3 grid gap-3 border-l-2 border-navy-100 pl-4">
          {timeline(app).map(item => (
            <li key={item.key} data-step={item.key}>
              <strong className="block text-navy-900">{item.title}</strong>
              {item.at ? <span className="block text-sm text-slate-500">{when(item.at, app.country)}</span> : null}
              {item.body ? <span className="block text-slate-700">{item.body}</span> : null}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-6 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-extrabold text-navy-900">The deposit</h2>
        <p className="mt-2 text-slate-700">
          {deposit.amount === null
            ? "Taken from your UdozoPay wallet when you send your application."
            : deposit.returned_at
              ? `${money(deposit.amount, deposit.currency)}, returned to your UdozoPay wallet on ${when(deposit.returned_at, app.country)}.`
              : depositPaid
                ? `${money(deposit.amount, deposit.currency)}, held as your centre's deposit since ${when(deposit.paid_at, app.country)}.`
                : `${money(deposit.amount, deposit.currency)}.`}
        </p>
      </section>

      {underWay(app.status) ? (
        <div className="mt-6">
          <button type="button" disabled={busy} onClick={withdraw} className="min-h-11 rounded-xl border border-red-200 px-5 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
            Withdraw application
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Panel({ title, tone, children }: { title: string; tone?: "warn" | "good"; children: React.ReactNode }) {
  const colours = tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-950" : tone === "good" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-slate-100 bg-white text-slate-700";
  return (
    <section className={`mt-6 rounded-3xl border p-5 shadow-sm sm:p-6 ${colours}`}>
      <h2 className="text-lg font-extrabold text-navy-900">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}
