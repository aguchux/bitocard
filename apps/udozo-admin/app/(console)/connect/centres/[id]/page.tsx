"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { ActionDialog, Badge, Button, Card, CardHeader, formatDate, formatDateTime, formatNumber, KeyValue, Notice, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type ConnectCentreDetail, connectCentreRoleLabels, useConnectCentreQuery, useSetConnectCentreStatusMutation } from "@bitocard/api-client/admin";
import { centreStatusLabels, centreStatusTones, money, pausedBy } from "@/components/connect";
import { UdozoShell } from "@/components/shell";

type Action = "pause" | "reinstate" | "close";

const dialogs: Record<Action, { title: (name: string) => string; description: string; confirm: string; tone: "primary" | "danger" }> = {
  pause: {
    title: name => `Pause ${name}?`,
    description: "It takes no new orders until Udozo reinstates it, and finishes what it already holds. Its owner and managers are told why; only Udozo can lift this pause.",
    confirm: "Pause centre",
    tone: "danger",
  },
  reinstate: { title: name => `Reinstate ${name}?`, description: "It takes orders again, and its owner and managers are told.", confirm: "Reinstate", tone: "primary" },
  close: {
    title: name => `Close ${name} for good?`,
    description: "A closed centre takes nothing new and cannot be reopened. Its owner and managers are told why; our team then settles what it holds and its deposit.",
    confirm: "Close centre",
    tone: "danger",
  },
};

const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

function CentreView({ centre, acts }: { centre: ConnectCentreDetail; acts: boolean }) {
  const [action, setAction] = useState<Action | null>(null);
  const [setStatus] = useSetConnectCentreStatusMutation();
  const place = `${centre.area.name}, ${centre.state.name}`;

  const actions = acts ? (
    <div className="flex flex-wrap gap-2">
      {centre.status === "paused" && centre.paused?.by === "udozo" ? <Button onClick={() => setAction("reinstate")}>Reinstate</Button> : null}
      {centre.status === "paused" && centre.paused?.by === "partner" ? (
        <Button variant="secondary" onClick={() => setAction("reinstate")}>
          Open it again
        </Button>
      ) : null}
      {centre.status !== "closed" && centre.paused?.by !== "udozo" ? (
        <Button variant="secondary" onClick={() => setAction("pause")}>
          Pause
        </Button>
      ) : null}
      {centre.status !== "closed" ? (
        <Button variant="danger" onClick={() => setAction("close")}>
          Close
        </Button>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      <PageHeader title={`${centre.number}: ${centre.name}`} description={place} actions={actions} />
      {centre.paused ? (
        <Notice tone="amber">
          {pausedBy(centre.paused)}
          {centre.paused.reason ? `: ${centre.paused.reason}` : ""}
          {centre.paused.until ? ` Opens again on ${formatDate(centre.paused.until)}.` : ""}
        </Notice>
      ) : null}
      {centre.closed ? (
        <Notice tone="red">
          Closed{centre.closed.at ? ` on ${formatDate(centre.closed.at)}` : ""}
          {centre.closed.reason ? `: ${centre.closed.reason}` : ""}
        </Notice>
      ) : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Card className="p-5 sm:p-6">
            <CardHeader title="The office" className="px-0 pt-0 pb-4" />
            <KeyValue
              items={[
                { label: "Status", value: <Badge tone={centreStatusTones[centre.status]}>{centreStatusLabels[centre.status]}</Badge> },
                { label: "Market", value: centre.country },
                { label: "Address", value: centre.address },
                { label: "Landmark", value: centre.landmark ?? "—" },
                { label: "State and area", value: place },
                { label: "Opening hours", value: centre.hours },
                { label: "Phone", value: <a href={tel(centre.phone)} className="font-semibold text-brand-600 hover:underline">{centre.phone}</a> },
                { label: "Holds", value: `${formatNumber(centre.capacity)} items` },
                ...(centre.latitude !== null && centre.longitude !== null
                  ? [
                      {
                        label: "Map",
                        value: (
                          <a href={`https://www.google.com/maps?q=${centre.latitude},${centre.longitude}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 hover:underline">
                            Open in Google Maps
                          </a>
                        ),
                      },
                    ]
                  : []),
                { label: "Approved", value: formatDateTime(centre.created_at) },
              ]}
            />
          </Card>

          {centre.photos.length ? (
            <Card className="p-5 sm:p-6">
              <CardHeader title="Photos" description="Each opens full size in a new tab." className="px-0 pt-0 pb-4" />
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {centre.photos.map((url, index) => (
                  <li key={url} className="min-w-0">
                    <a href={url} target="_blank" rel="noopener noreferrer" className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element -- the centre's photo from its own address */}
                      <img src={url} alt={`Photo ${index + 1} of ${centre.name}`} className="aspect-[4/3] w-full rounded-lg border border-line bg-canvas object-cover" loading="lazy" />
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card className="p-5 sm:p-6">
            <CardHeader title="Its people" description="Who runs it on connect.udozo.com. Its owner adds and removes managers and staff." className="px-0 pt-0 pb-4" />
            <ul className="divide-y divide-line">
              {centre.members.map(member => (
                <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{member.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {member.email}
                      {member.phone ? ` · ${member.phone}` : ""}
                    </span>
                  </span>
                  <span className="grid justify-items-end gap-0.5">
                    <Badge tone={member.role === "owner" ? "blue" : "grey"}>{connectCentreRoleLabels[member.role]}</Badge>
                    <span className="text-xs text-muted">Since {formatDate(member.since)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5 sm:p-6">
            <CardHeader title="Storage places" description="Where items are shelved, so staff always know where each one is." className="px-0 pt-0 pb-4" />
            {centre.shelves.length ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {centre.shelves.map(shelf => (
                  <li key={shelf.id} className={`rounded-lg border border-line px-3 py-2 text-sm ${shelf.active ? "" : "opacity-60"}`}>
                    <span className="block font-semibold text-ink">
                      {shelf.code}
                      {shelf.active ? "" : " (not in use)"}
                    </span>
                    <span className="block text-xs text-muted">
                      {shelf.label ?? "No description"}
                      {shelf.capacity ? ` · holds ${formatNumber(shelf.capacity)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No storage places set up yet.</p>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card className="p-5">
            <CardHeader title="Partner" className="px-0 pt-0 pb-4" />
            <KeyValue
              className="sm:grid-cols-1"
              items={[
                { label: "Name", value: centre.partner.name },
                { label: "Email", value: <a href={`mailto:${centre.partner.email}`} className="break-all font-semibold text-brand-600 hover:underline">{centre.partner.email}</a> },
                { label: "Mobile", value: centre.partner.phone ? <a href={tel(centre.partner.phone)} className="font-semibold text-brand-600 hover:underline">{centre.partner.phone}</a> : "—" },
              ]}
            />
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
              <AppLink href={`/customers/${centre.partner.id}`} className="font-semibold text-brand-600 hover:underline">
                View their account
              </AppLink>
              {centre.application_id ? (
                <AppLink href={`/connect/applications/${centre.application_id}`} className="font-semibold text-brand-600 hover:underline">
                  The application
                </AppLink>
              ) : null}
            </div>
          </Card>

          <Card className="p-5">
            <CardHeader title="Deposit" className="px-0 pt-0 pb-4" />
            <KeyValue className="sm:grid-cols-1" items={[{ label: "Held", value: money(centre.deposit.amount, centre.deposit.currency) }]} />
          </Card>
        </div>
      </div>

      {action ? (
        <ActionDialog
          open
          onClose={() => setAction(null)}
          title={dialogs[action].title(centre.name)}
          description={dialogs[action].description}
          confirmLabel={dialogs[action].confirm}
          tone={dialogs[action].tone}
          onConfirm={async reason => void (await setStatus({ id: centre.id, action, reason }).unwrap())}
        />
      ) : null}
    </>
  );
}

/** Connect > Centres > one centre: its office, its people and storage places; operations pause, reinstate or close it. */
export default function ConnectCentrePage() {
  const { id } = useParams<{ id: string }>();
  const admin = useAdmin();
  const query = useConnectCentreQuery(id);
  return (
    <UdozoShell section="connect" current="/connect/centres" crumbs={[{ label: "Connect", href: "/connect/applications" }, { label: "Centres", href: "/connect/centres" }, { label: query.data?.number ?? "Centre" }]}>
      <QueryView query={query} loading={<Skeleton className="h-96 w-full" />}>
        {centre => <CentreView centre={centre} acts={can(admin, "operations")} />}
      </QueryView>
    </UdozoShell>
  );
}
