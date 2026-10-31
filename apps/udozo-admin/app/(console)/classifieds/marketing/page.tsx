"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CalendarClock, MailPlus, MousePointerClick, Send, UserCheck, Users } from "lucide-react";
import { Badge, Button, Card, CardHeader, DataTable, errorMessage, FilterSelect, formatDate, formatNumber, Input, PageHeader, StatCard, Tabs, useDebouncedValue, type Column } from "@bitocard/admin-ui";
import { AppLink, useAdmin } from "@bitocard/admin-ui/shell";
import { flagEmoji } from "@bitocard/ui/phone";
import { type MarketingFilters, type MarketingProspect, type MarketingStage, useMarketingProspectsQuery, useMarketingSummaryQuery } from "@bitocard/api-client/admin";
import { useMarketOptions } from "@/components/classifieds";
import { UdozoShell } from "@/components/shell";
import { dialled, outcomeLabels, stageLabels, stageOrder, statusLabels } from "@/components/marketing/labels";

const pageSize = 50;

/**
 * Marketplace > Marketing: bringing sellers onto Udozo (a Jiji list or anyone invited by email), one stage at a time:
 * reach out, invitation, onboarding, follow-up, feedback. Every admin role works it. `?country=` opens one market's.
 */
export default function MarketingPage() {
  return (
    <Suspense>
      <MarketingPipeline />
    </Suspense>
  );
}

function MarketingPipeline() {
  const router = useRouter();
  const admin = useAdmin();
  const search = useSearchParams();
  const markets = useMarketOptions();
  const [country, setCountry] = useState(search.get("country")?.toUpperCase() ?? "");
  const [stage, setStage] = useState<"all" | MarketingStage>("all");
  const [status, setStatus] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [outcome, setOutcome] = useState("");
  const [words, setWords] = useState("");
  const [offset, setOffset] = useState(0);
  const q = useDebouncedValue(words.trim());
  const filters: MarketingFilters = {
    country: country || undefined,
    stage: stage === "all" ? undefined : stage,
    status: (status || undefined) as MarketingFilters["status"],
    owner: owner || undefined,
    due: (due || undefined) as MarketingFilters["due"],
    outcome: (outcome || undefined) as MarketingFilters["outcome"],
    q: q || undefined,
    offset,
    limit: pageSize,
  };
  const summary = useMarketingSummaryQuery();
  const prospects = useMarketingProspectsQuery(filters);
  const total = prospects.data?.total ?? 0;
  const data = summary.data;
  const reset = () => setOffset(0);
  const [now] = useState(() => Date.now());

  const columns: Array<Column<MarketingProspect>> = [
    {
      key: "seller",
      header: "Seller",
      cell: item => (
        <span className="block min-w-0">
          <span className="block truncate font-semibold text-ink">
            <span title={item.country} aria-label={item.country}>
              {flagEmoji(item.country)}
            </span>{" "}
            {item.name}
          </span>
          <span className="block truncate text-xs text-muted">{[item.phones[0] ? dialled(item.phones[0]) : null, item.email, item.location].filter(Boolean).join(" · ")}</span>
        </span>
      ),
    },
    { key: "category", header: "Category", hideOnMobile: true, cell: item => <span className="text-sm">{item.categories.slice(0, 2).join(", ") || "—"}</span> },
    {
      key: "stage",
      header: "Stage",
      cell: item => (
        <span className="flex flex-wrap gap-1.5">
          <Badge tone="pink" dot={false}>
            {stageLabels[item.stage].title}
          </Badge>
          <Badge tone={statusLabels[item.stage_status].tone}>{statusLabels[item.stage_status].label}</Badge>
          {item.outcome ? <Badge tone={outcomeLabels[item.outcome].tone}>{outcomeLabels[item.outcome].label}</Badge> : null}
          {item.do_not_contact ? <Badge tone="red">Do not contact</Badge> : null}
        </span>
      ),
    },
    {
      key: "next",
      header: "Next action",
      cell: item =>
        item.next_action_at ? (
          <span className={`block text-sm ${new Date(item.next_action_at).getTime() < now ? "font-semibold text-red-600" : "text-ink"}`}>
            {formatDate(item.next_action_at)}
            <span className="block truncate text-xs font-normal text-muted">{item.next_action ?? "Next touch"}</span>
          </span>
        ) : (
          <span className="text-xs text-muted">None set</span>
        ),
    },
    { key: "owner", header: "Owner", hideOnMobile: true, cell: item => <span className="text-sm">{item.owner?.name ?? <span className="text-muted">Unassigned</span>}</span> },
    { key: "contact", header: "Last contact", hideOnMobile: true, cell: item => <span className="text-xs text-muted">{item.last_contact_at ? formatDate(item.last_contact_at) : "Never"}</span> },
  ];

  return (
    <UdozoShell section="marketplace" current="/classifieds/marketing" crumbs={[{ label: "Marketplace", href: "/classifieds" }, { label: "Marketing" }]}>
      <PageHeader
        title="Marketing"
        description="Bring sellers onto Udozo: reach out, invite, help them onboard, follow up and ask for feedback. Each invite link tracks the click and the sign-up it leads to."
        actions={
          <span className="flex flex-wrap gap-2">
            <AppLink href="/classifieds/marketing/new" className="inline-flex h-10 items-center gap-2 rounded-xl border border-brand-500 bg-white px-4 text-sm font-semibold text-brand-600 hover:bg-brand-50">
              <MailPlus className="size-4" aria-hidden /> Add or invite
            </AppLink>
            <AppLink href="/classifieds/marketing/import" className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600">
              Import a list
            </AppLink>
          </span>
        }
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Sellers" value={formatNumber(data?.total ?? 0)} icon={<Users />} loading={summary.isLoading} footer={<span className="text-xs text-muted">{formatNumber(data?.unassigned ?? 0)} unassigned</span>} />
        <StatCard label="Reached and invited" value={`${formatNumber(data?.funnel.reached ?? 0)} · ${formatNumber(data?.funnel.invited ?? 0)}`} icon={<Send />} tone="blue" loading={summary.isLoading} footer={<span className="text-xs text-muted">{formatNumber(data?.funnel.clicked ?? 0)} opened their link</span>} />
        <StatCard label="Signed up" value={formatNumber(data?.funnel.signed_up ?? 0)} icon={<UserCheck />} tone="green" loading={summary.isLoading} footer={<span className="text-xs text-muted">{formatNumber(data?.funnel.posted ?? 0)} posted a listing · {formatNumber(data?.funnel.feedback ?? 0)} gave feedback</span>} />
        <StatCard
          label="Due"
          value={formatNumber((data?.due.overdue ?? 0) + (data?.due.today ?? 0))}
          icon={<CalendarClock />}
          tone="amber"
          loading={summary.isLoading}
          footer={
            <button type="button" className="text-xs font-semibold text-brand-600 hover:underline" onClick={() => (setDue("today"), reset())}>
              {formatNumber(data?.due.overdue ?? 0)} overdue · {formatNumber(data?.due.today ?? 0)} today
            </button>
          }
        />
      </div>

      {data ? (
        <Card className="mt-4">
          <CardHeader title="The funnel" description="How many sellers are at each stage now, and where each stands." />
          <ol className="grid gap-3 p-5 sm:grid-cols-5 sm:px-6">
            {data.stages.map(item => (
              <li key={item.stage}>
                <button type="button" onClick={() => (setStage(item.stage), reset())} className={`w-full rounded-xl border p-3 text-left hover:border-brand-400 ${stage === item.stage ? "border-brand-400 bg-brand-50" : "border-line"}`}>
                  <span className="block text-xs font-semibold text-muted">{stageLabels[item.stage].title}</span>
                  <span className="block text-xl font-extrabold text-ink">{formatNumber(item.total)}</span>
                  <span className="block text-xs text-muted">
                    {formatNumber(item.statuses.waiting)} waiting · {formatNumber(item.statuses.done)} done
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <div className="mt-6">
        <Tabs
          label="Stage"
          value={stage}
          onChange={value => (setStage(value), reset())}
          items={[{ value: "all" as const, label: "All", count: data?.total }, ...stageOrder.map(value => ({ value, label: stageLabels[value].title, count: data?.stages.find(item => item.stage === value)?.total }))]}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-56 flex-1 sm:max-w-sm">
          <span className="sr-only">Search sellers</span>
          <Input type="search" placeholder="Name, store, phone, email or place" value={words} onChange={event => (setWords(event.target.value), reset())} />
        </label>
        <FilterSelect
          id="mk-country"
          label="Country"
          value={country}
          onChange={value => (setCountry(value), reset())}
          options={[
            { value: "", label: "All countries" },
            ...markets.map(item => ({ value: item.value, label: `${flagEmoji(item.value)} ${item.label} (${formatNumber(data?.countries?.find(row => row.country === item.value)?.total ?? 0)})` })),
          ]}
        />
        <FilterSelect id="mk-status" label="Status" value={status} onChange={value => (setStatus(value), reset())} options={[{ value: "", label: "Any" }, ...Object.entries(statusLabels).map(([value, item]) => ({ value, label: item.label }))]} />
        <FilterSelect
          id="mk-owner"
          label="Owner"
          value={owner}
          onChange={value => (setOwner(value), reset())}
          options={[{ value: "", label: "Anyone" }, ...(admin ? [{ value: "me", label: "Mine" }] : []), { value: "none", label: "Unassigned" }, ...(data?.owners ?? []).map(item => ({ value: item.id, label: item.name }))]}
        />
        <FilterSelect id="mk-due" label="Next action" value={due} onChange={value => (setDue(value), reset())} options={[{ value: "", label: "Any time" }, { value: "overdue", label: "Overdue" }, { value: "today", label: "Due today" }, { value: "week", label: "This week" }, { value: "none", label: "None set" }]} />
        <FilterSelect id="mk-outcome" label="Outcome" value={outcome} onChange={value => (setOutcome(value), reset())} options={[{ value: "", label: "Any" }, ...Object.entries(outcomeLabels).map(([value, item]) => ({ value, label: item.label })), { value: "none", label: "None yet" }]} />
      </div>
      <Card className="mt-4">
        <DataTable
          columns={columns}
          rows={prospects.data?.data}
          rowKey={item => item.id}
          loading={prospects.isLoading}
          error={prospects.error ? errorMessage(prospects.error) : null}
          onRetry={prospects.refetch}
          onRowClick={item => router.push(`/classifieds/marketing/${item.id}`)}
          empty="No sellers match. Import a list or invite someone by email."
        />
      </Card>
      {total > pageSize ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
          <span>
            {offset + 1} to {Math.min(offset + pageSize, total)} of {formatNumber(total)}
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>
              Previous
            </Button>
            <Button size="sm" variant="ghost" disabled={offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>
              Next
            </Button>
          </span>
        </div>
      ) : null}
      <p className="mt-6 flex items-center gap-2 text-xs text-muted">
        <MousePointerClick className="size-4" aria-hidden /> Sellers who sign up with their invite link, email or phone are linked to their Udozo account by themselves.
      </p>
    </UdozoShell>
  );
}
