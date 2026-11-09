"use client";

import { useId, useState } from "react";
import { useParams } from "next/navigation";
import { Check, X } from "lucide-react";
import { ActionDialog, Badge, Button, Card, CardHeader, Field, formatDate, formatDateTime, formatNumber, Input, KeyValue, Notice, PageHeader, QueryView, Select, Skeleton, Textarea } from "@bitocard/admin-ui";
import { AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type ConnectApplicationDetail,
  type ConnectApplicationStatus,
  connectPhotoKindLabels,
  useApproveConnectApplicationMutation,
  useConnectApplicationQuery,
  useConnectVisitorsQuery,
  useRecordConnectVisitMutation,
  useRejectConnectApplicationMutation,
  useRequestConnectChangesMutation,
  useScheduleConnectVisitMutation,
} from "@bitocard/api-client/admin";
import { ApplicationStatus, isoFromLocal, money } from "@/components/connect";
import { UdozoShell } from "@/components/shell";

/** What Udozo's team can still do with an application in each status (as the API allows). */
const changesFrom: ConnectApplicationStatus[] = ["submitted", "visit_scheduled", "visited"];
const visitFrom: ConnectApplicationStatus[] = ["submitted", "visit_scheduled", "visited"];
const rejectFrom: ConnectApplicationStatus[] = ["submitted", "changes_requested", "visit_scheduled", "visited"];

type Action = "changes" | "visit" | "result" | "approve" | "reject" | null;

const yes = (value: boolean, label: string) => (
  <span className="inline-flex items-center gap-1.5">
    {value ? <Check className="size-4 text-emerald-600" aria-hidden /> : <X className="size-4 text-red-600" aria-hidden />}
    {value ? label : `Not ${label.toLowerCase()}`}
  </span>
);

function ScheduleVisitDialog({ application, open, onClose }: { application: ConnectApplicationDetail; open: boolean; onClose: () => void }) {
  const id = useId();
  const visitors = useConnectVisitorsQuery(application.country, { skip: !open });
  const [schedule] = useScheduleConnectVisitMutation();
  const [visitor, setVisitor] = useState("");
  const [at, setAt] = useState("");
  const [note, setNote] = useState("");
  const able = (visitors.data?.data ?? []).filter(item => item.can_visit);
  const close = () => {
    setVisitor("");
    setAt("");
    setNote("");
    onClose();
  };
  return (
    <ActionDialog
      open={open}
      onClose={close}
      title={application.visit ? "Schedule another visit" : "Schedule a visit"}
      description="The applicant is told the time and who is coming, and can confirm it or ask for another time."
      confirmLabel="Schedule visit"
      requireReason={false}
      onConfirm={async () => {
        const when = isoFromLocal(at);
        if (!visitor) throw new Error("Choose who will visit.");
        if (!when) throw new Error("Choose the day and time of the visit.");
        await schedule({ id: application.id, visitor_id: visitor, at: when, note: note.trim() || null }).unwrap();
      }}
    >
      <Field label="Who visits" htmlFor={`${id}-visitor`} hint={able.length ? "Staff, or agents who finished Udozo's training." : "No one in this market can visit yet: add a visitor on Connect > Visitors."}>
        <Select id={`${id}-visitor`} value={visitor} onChange={event => setVisitor(event.target.value)}>
          <option value="">Choose a visitor</option>
          {able.map(item => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.kind === "agent" ? "agent" : "staff"})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="When" htmlFor={`${id}-at`} hint="In your own time zone.">
        <Input id={`${id}-at`} type="datetime-local" value={at} onChange={event => setAt(event.target.value)} />
      </Field>
      <Field label="Note to the applicant (optional)" htmlFor={`${id}-note`}>
        <Textarea id={`${id}-note`} value={note} onChange={event => setNote(event.target.value)} maxLength={500} />
      </Field>
    </ActionDialog>
  );
}

function RecordVisitDialog({ application, open, onClose }: { application: ConnectApplicationDetail; open: boolean; onClose: () => void }) {
  const id = useId();
  const [record] = useRecordConnectVisitMutation();
  const [passed, setPassed] = useState<"" | "yes" | "no">("");
  const [report, setReport] = useState("");
  const close = () => {
    setPassed("");
    setReport("");
    onClose();
  };
  return (
    <ActionDialog
      open={open}
      onClose={close}
      title="Record the visit"
      description="What the visitor found. The applicant is told the visit happened, not the outcome: that comes with the decision."
      confirmLabel="Record visit"
      requireReason={false}
      onConfirm={async () => {
        if (!passed) throw new Error("Say whether the office passed the visit.");
        if (report.trim().length < 3) throw new Error("Write what the visitor found.");
        await record({ id: application.id, passed: passed === "yes", report: report.trim() }).unwrap();
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">Did the office pass?</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name={`${id}-passed`} checked={passed === "yes"} onChange={() => setPassed("yes")} />
          Yes, it passed
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name={`${id}-passed`} checked={passed === "no"} onChange={() => setPassed("no")} />
          No, it did not pass
        </label>
      </fieldset>
      <Field label="Report" htmlFor={`${id}-report`}>
        <Textarea id={`${id}-report`} value={report} onChange={event => setReport(event.target.value)} maxLength={2000} />
      </Field>
    </ActionDialog>
  );
}

function ApplicationView({ application, acts }: { application: ConnectApplicationDetail; acts: boolean }) {
  const [action, setAction] = useState<Action>(null);
  const [requestChanges] = useRequestConnectChangesMutation();
  const [approve] = useApproveConnectApplicationMutation();
  const [reject] = useRejectConnectApplicationMutation();
  const status = application.status;
  const visit = application.visit;
  const deposit = application.deposit;
  const depositHeld = Boolean(deposit.paid_at && !deposit.returned_at);
  const canApprove = status === "visited" && visit?.passed === true && depositHeld;
  const place = [application.area?.name, application.state?.name].filter(Boolean).join(", ");
  const close = () => setAction(null);

  const actions = acts ? (
    <div className="flex flex-wrap gap-2">
      {canApprove ? <Button onClick={() => setAction("approve")}>Approve</Button> : null}
      {status === "visit_scheduled" ? <Button onClick={() => setAction("result")}>Record visit</Button> : null}
      {visitFrom.includes(status) ? (
        <Button variant="secondary" onClick={() => setAction("visit")}>
          {visit ? "Schedule another visit" : "Schedule visit"}
        </Button>
      ) : null}
      {changesFrom.includes(status) ? (
        <Button variant="secondary" onClick={() => setAction("changes")}>
          Ask for changes
        </Button>
      ) : null}
      {rejectFrom.includes(status) ? (
        <Button variant="danger" onClick={() => setAction("reject")}>
          Reject
        </Button>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      <PageHeader title={`${application.number}: ${application.business_name ?? "No business name yet"}`} description={place || "No office chosen yet"} actions={actions} />
      {status === "visited" && visit?.passed === false ? <Notice tone="amber">The visit did not pass. Schedule another visit, or reject the application.</Notice> : null}
      {status === "visited" && visit?.passed && !depositHeld ? <Notice tone="amber">The deposit has not been paid, so the application cannot be approved.</Notice> : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Card className="p-5 sm:p-6">
            <CardHeader title="The business and its office" className="px-0 pt-0 pb-4" />
            <KeyValue
              items={[
                { label: "Status", value: <ApplicationStatus status={status} /> },
                { label: "Market", value: application.country },
                { label: "Business", value: application.business_name ?? "—" },
                { label: "Registration number", value: application.registration_number ?? "Not registered" },
                { label: "Address", value: application.address ?? "—" },
                { label: "Landmark", value: application.landmark ?? "—" },
                { label: "State and area", value: place || "—" },
                { label: "Opening hours", value: application.hours ?? "—" },
                { label: "Phone", value: application.phone ? <a href={`tel:${application.phone.replace(/[^\d+]/g, "")}`} className="font-semibold text-brand-600 hover:underline">{application.phone}</a> : "—" },
                { label: "Capacity", value: application.capacity === null ? "—" : `${formatNumber(application.capacity)} items` },
                { label: "Person in charge", value: application.person_name ? `${application.person_name}${application.person_role ? `, ${application.person_role}` : ""}` : "—" },
                ...(application.latitude !== null && application.longitude !== null
                  ? [
                      {
                        label: "Map",
                        value: (
                          <a href={`https://www.google.com/maps?q=${application.latitude},${application.longitude}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 hover:underline">
                            Open in Google Maps
                          </a>
                        ),
                      },
                    ]
                  : []),
                { label: "Submitted", value: formatDateTime(application.submitted_at) },
              ]}
            />
          </Card>

          <Card className="p-5 sm:p-6">
            <CardHeader title="Photos" description="Each opens full size in a new tab." className="px-0 pt-0 pb-4" />
            {application.photos.length ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {application.photos.map(photo => (
                  <li key={photo.id} className="min-w-0">
                    <a href={photo.url} target="_blank" rel="noopener noreferrer" className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element -- the applicant's photo from its own address */}
                      <img src={photo.url} alt={connectPhotoKindLabels[photo.kind]} className="aspect-[4/3] w-full rounded-lg border border-line bg-canvas object-cover" loading="lazy" />
                      <span className="mt-1 block text-xs text-muted">{connectPhotoKindLabels[photo.kind]}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No photos yet.</p>
            )}
          </Card>

          {application.changes ? (
            <Card className="p-5 sm:p-6">
              <CardHeader title="Changes asked for" description={formatDateTime(application.changes.at)} className="px-0 pt-0 pb-2" />
              <p className="whitespace-pre-line break-words text-sm text-ink">{application.changes.note}</p>
            </Card>
          ) : null}

          <Card className="p-5 sm:p-6">
            <CardHeader title="Visit" className="px-0 pt-0 pb-4" />
            {visit ? (
              <KeyValue
                items={[
                  { label: "When", value: formatDateTime(visit.at) },
                  { label: "Visitor", value: visit.visitor ? `${visit.visitor.name} (${visit.visitor.kind === "agent" ? "agent" : "staff"})${visit.visitor.phone ? `, ${visit.visitor.phone}` : ""}` : "—" },
                  { label: "Note to the applicant", value: visit.note ?? "—" },
                  {
                    label: "The applicant",
                    value: visit.confirmed_at ? `Confirmed the time on ${formatDateTime(visit.confirmed_at)}` : visit.reschedule_note ? `Asked for another time: “${visit.reschedule_note}”` : "Has not confirmed the time yet",
                  },
                  ...(visit.visited_at
                    ? [
                        { label: "Visited", value: formatDateTime(visit.visited_at) },
                        { label: "Outcome", value: visit.passed ? <Badge tone="green">Passed</Badge> : <Badge tone="red">Did not pass</Badge> },
                        { label: "Report", value: <span className="whitespace-pre-line">{visit.report ?? "—"}</span> },
                      ]
                    : []),
                ]}
              />
            ) : (
              <p className="text-sm text-muted">No visit scheduled yet.</p>
            )}
          </Card>

          {application.decision || application.withdrawn_at ? (
            <Card className="p-5 sm:p-6">
              <CardHeader title="Decision" className="px-0 pt-0 pb-4" />
              <KeyValue
                items={[
                  ...(application.decision ? [{ label: status === "approved" ? "Approved" : "Rejected", value: formatDateTime(application.decision.at) }] : []),
                  ...(application.decision?.reason ? [{ label: "Reason", value: application.decision.reason }] : []),
                  ...(application.withdrawn_at ? [{ label: "Withdrawn by the applicant", value: formatDateTime(application.withdrawn_at) }] : []),
                  ...(application.centre
                    ? [
                        {
                          label: "Centre",
                          value: (
                            <AppLink href="/connect/centres" className="font-semibold text-brand-600 hover:underline">
                              {application.centre.number}
                            </AppLink>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </Card>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          <Card className="p-5">
            <CardHeader title="Applicant" className="px-0 pt-0 pb-4" />
            <KeyValue
              className="sm:grid-cols-1"
              items={[
                { label: "Name", value: application.applicant.name },
                { label: "Email", value: <a href={`mailto:${application.applicant.email}`} className="break-all font-semibold text-brand-600 hover:underline">{application.applicant.email}</a> },
                { label: "Mobile", value: application.applicant.phone ?? "—" },
                { label: "Mobile confirmed", value: yes(application.applicant.phone_confirmed, "Confirmed") },
                { label: "Identity check", value: yes(application.applicant.identity_checked, "Passed") },
                { label: "Udozo member since", value: formatDate(application.applicant.since) },
              ]}
            />
            <AppLink href={`/customers/${application.applicant.id}`} className="mt-4 inline-block text-sm font-semibold text-brand-600 hover:underline">
              View their account
            </AppLink>
          </Card>

          <Card className="p-5">
            <CardHeader title="Deposit" className="px-0 pt-0 pb-4" />
            <KeyValue
              className="sm:grid-cols-1"
              items={[
                { label: "Amount", value: money(deposit.amount, deposit.currency) },
                { label: "Paid", value: deposit.paid_at ? formatDateTime(deposit.paid_at) : "Not paid" },
                ...(deposit.returned_at ? [{ label: "Returned", value: formatDateTime(deposit.returned_at) }] : []),
              ]}
            />
          </Card>

          <Card className="p-5">
            <CardHeader title="Requirements" className="px-0 pt-0 pb-3" />
            <ul className="space-y-2">
              {application.requirements.map(item => (
                <li key={item.key} className="flex items-start gap-2 text-sm">
                  {item.met ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden /> : <X className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />}
                  <span className="min-w-0 text-ink">
                    {item.label}
                    <span className="sr-only">{item.met ? ": met" : ": not met"}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <ActionDialog
        open={action === "changes"}
        onClose={close}
        title="Ask for changes"
        description="Say what the applicant should change. They can edit the application and send it again."
        confirmLabel="Ask for changes"
        onConfirm={async note => void (await requestChanges({ id: application.id, note }).unwrap())}
      />
      <ScheduleVisitDialog application={application} open={action === "visit"} onClose={close} />
      <RecordVisitDialog application={application} open={action === "result"} onClose={close} />
      <ActionDialog
        open={action === "approve"}
        onClose={close}
        title="Approve this application?"
        description={`A Connect Centre will be made for ${application.business_name ?? "this business"}, run by the applicant and holding the deposit they paid.`}
        confirmLabel="Approve"
        requireReason={false}
        onConfirm={async () => void (await approve({ id: application.id }).unwrap())}
      />
      <ActionDialog
        open={action === "reject"}
        onClose={close}
        title="Reject this application?"
        description={depositHeld ? "The applicant is told why, and the deposit they paid goes back to their UdozoPay wallet." : "The applicant is told why."}
        confirmLabel="Reject"
        tone="danger"
        onConfirm={async reason => void (await reject({ id: application.id, reason }).unwrap())}
      />
    </>
  );
}

export default function ConnectApplicationPage() {
  const { id } = useParams<{ id: string }>();
  const admin = useAdmin();
  const query = useConnectApplicationQuery(id);
  return (
    <UdozoShell section="connect" current="/connect/applications" crumbs={[{ label: "Connect", href: "/connect/applications" }, { label: "Applications", href: "/connect/applications" }, { label: query.data?.number ?? "Application" }]}>
      <QueryView query={query} loading={<Skeleton className="h-96 w-full" />}>
        {application => <ApplicationView application={application} acts={can(admin, "operations")} />}
      </QueryView>
    </UdozoShell>
  );
}
