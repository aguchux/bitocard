"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, CheckCircle2, Eye, Globe, Link2, ShoppingCart } from "lucide-react";
import { Badge, Button, Card, CardHeader, type Column, DataTable, EmptyState, errorMessage, formatDate, formatRelative, LineChart, Notice, QueryView, Skeleton, StatCard } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type Store, type StoreDomain, type StoreDomains, type StoreTraffic, useStoreDomainsQuery, useStoresQuery, useStoreTrafficQuery } from "@bitocard/api-client/reseller";
import { BuyDomain, ConnectDomain, DomainCard, mailNames, statusLabels, statusTone } from "@/components/domains";
import { can, useReseller } from "@/components/reseller";
import { storeHref, WithStore } from "@/components/store-templates";

/** Domains that count towards the store's limit (not dismissed or never bought). */
const counted = (domains: StoreDomain[]) => domains.filter(domain => !["removed", "failed"].includes(domain.status));
/** Domains the reseller has something to do about. */
const needsAttention = (domain: StoreDomain) => ["pending", "expired", "suspended", "failed"].includes(domain.status) || Boolean(domain.renewal_error);

const count = (value: number) => value.toLocaleString("en-GB");
const shortDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const bareHost = (url: string) => url.replace(/^https:\/\//, "");

/** Visits per address over the last 30 days, and the chart of them by day. */
function TrafficCard({ store, traffic, loading }: { store: Store; traffic: StoreTraffic | undefined; loading: boolean }) {
  return (
    <Card>
      <CardHeader title="Traffic" description="The last 30 days, on every address of your store. Counted without cookies: crawlers, link previews and prefetches are left out, and each visitor is counted once a day." />
      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {loading && !traffic ? (
          <Skeleton className="h-56 w-full lg:col-span-2" />
        ) : traffic ? (
          <>
            <LineChart
              label="Page views and visitors per day"
              labels={traffic.daily.map(day => shortDate(day.date))}
              series={[
                { name: "Page views", color: "#ff2382", values: traffic.daily.map(day => day.views), format: count },
                { name: "Visitors", color: "#070f4c", values: traffic.daily.map(day => day.visitors), format: count },
              ]}
            />
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-ink">By address</h4>
              {traffic.hosts.length ? (
                <ul className="mt-2 divide-y divide-line">
                  {traffic.hosts.map(host => (
                    <li key={host.host} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0 break-all font-medium text-ink">{host.host}</span>
                      <span className="shrink-0 text-right text-muted">
                        <span className="font-semibold text-ink">{count(host.views)}</span> views · {count(host.visitors)} visitors
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted">No visits yet. Share {bareHost(store.url)} or your own domain with your customers.</p>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted lg:col-span-2">Traffic could not be loaded. It will show here once it can.</p>
        )}
      </div>
    </Card>
  );
}

/** The reseller's store and its domains, or why they cannot be shown. */
export function WithDomains({ children }: { children: (store: Store, domains: StoreDomains) => ReactNode }) {
  const stores = useStoresQuery();
  return (
    <QueryView query={stores} loading={<Skeleton className="h-64 w-full" />} message={error => errorMessage(error, "Could not load your store.")}>
      {({ data }) => (
        <WithStore
          stores={data}
          empty={
            <Notice tone="blue">
              Create your store first: <AppLink href="/store" className="font-semibold text-brand-600 hover:underline">Store</AppLink>.
            </Notice>
          }
        >
          {store => (
            <StoreDomainsView key={store.id} store={store}>
              {children}
            </StoreDomainsView>
          )}
        </WithStore>
      )}
    </QueryView>
  );
}

function StoreDomainsView({ store, children }: { store: Store; children: (store: Store, domains: StoreDomains) => ReactNode }) {
  const domains = useStoreDomainsQuery(store.id);
  return (
    <QueryView query={domains} loading={<Skeleton className="h-64 w-full" />} message={error => errorMessage(error, "Could not load your domains.")}>
      {data => children(store, data)}
    </QueryView>
  );
}

/** Whether the member can add another domain now, and if not, why. */
function useAdding(domains: StoreDomains) {
  const { membership } = useReseller();
  const manage = can(membership, "admin");
  const full = counted(domains.data).length >= domains.max_domains;
  return { manage, full, allowed: manage && !full };
}

/** Store > Domains: how the store's domains are doing, and the list (each opens its own page). */
export function DomainsOverview({ store, domains }: { store: Store; domains: StoreDomains }) {
  const router = useRouter();
  const { membership } = useReseller();
  const { manage, full, allowed } = useAdding(domains);
  const list = counted(domains.data);
  const live = list.filter(domain => domain.status === "active");
  const attention = list.filter(needsAttention);
  const renewing = list.filter(domain => domain.source === "purchased" && domain.expires_at).sort((a, b) => a.expires_at!.localeCompare(b.expires_at!));
  const next = renewing[0];
  const main = live.find(domain => domain.primary);
  const traffic = useStoreTrafficQuery({ id: store.id, days: 30 });
  const visitsOn = (name: string) => traffic.data?.hosts.find(host => host.host === name);

  const columns: Array<Column<StoreDomain>> = [
    {
      key: "domain",
      header: "Domain",
      cell: domain => (
        <span className="block min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="break-all font-semibold text-ink">{domain.name}</span>
            {domain.primary ? <Badge tone="pink">Main address</Badge> : null}
          </span>
          <span className="block text-sm text-muted">{domain.source === "purchased" ? "Bought here" : "Connected"}</span>
        </span>
      ),
    },
    { key: "status", header: "Status", cell: domain => <Badge tone={statusTone(domain.status)}>{statusLabels[domain.status]}</Badge> },
    { key: "dns", header: "DNS", hideOnMobile: true, cell: domain => (domain.dns_mode === "vercel" ? "Managed here" : "Your DNS host") },
    {
      key: "email",
      header: "Email",
      hideOnMobile: true,
      cell: domain =>
        [domain.mail_provider ? mailNames[domain.mail_provider] : null, domain.email_sending?.status === "verified" ? "Order emails" : domain.email_sending ? "Order emails pending" : null].filter(Boolean).join(" · ") || "—",
    },
    {
      key: "renews",
      header: "Renews",
      hideOnMobile: true,
      cell: domain => (domain.source === "purchased" && domain.expires_at ? `${formatDate(domain.expires_at)}${domain.auto_renew ? "" : " (manual)"}` : "—"),
    },
    { key: "visitors", header: "Visitors (30 days)", hideOnMobile: true, align: "right", cell: domain => (traffic.data ? count(visitsOn(domain.name)?.visitors ?? 0) : "—") },
    { key: "checked", header: "Checked", hideOnMobile: true, cell: domain => formatRelative(domain.last_checked_at) },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Visitors · 30 days"
          value={traffic.data ? count(traffic.data.visitors) : "—"}
          icon={<Eye />}
          loading={traffic.isLoading}
          footer={<span className="text-sm text-muted">{traffic.data ? `${count(traffic.data.views)} page views` : "Traffic not loaded"} · {list.length} of {domains.max_domains} domains</span>}
        />
        <StatCard label="Live" value={live.length} icon={<CheckCircle2 />} tone="green" footer={<span className="block truncate text-sm text-muted">{main ? `Main address: ${main.name}` : `Your store is at ${store.url.replace(/^https:\/\//, "")}`}</span>} />
        <StatCard label="Need attention" value={attention.length} icon={<AlertTriangle />} tone="amber" footer={<span className="text-sm text-muted">{attention.length ? "Waiting for DNS, expired or renewal" : "Nothing to do"}</span>} />
        <StatCard
          label="Next renewal"
          value={next ? formatDate(next.expires_at!) : "—"}
          icon={<CalendarClock />}
          tone="violet"
          footer={<span className="block truncate text-sm text-muted">{next ? `${next.name}${next.price ? ` · ${`US$${(next.price.amount / 100).toFixed(2)}`} paid` : ""}` : "No bought domains"}</span>}
        />
      </div>

      {attention.length ? (
        <Notice tone="amber" title={attention.length === 1 ? `${attention[0].name} needs your attention` : `${attention.length} domains need your attention`}>
          {attention.map((domain, index) => (
            <span key={domain.id}>
              {index ? ", " : ""}
              <AppLink href={storeHref(`/store/domains/${domain.id}`, store)} className="font-semibold underline">{domain.name}</AppLink> ({domain.renewal_error === "insufficient_funds" ? "renewal waiting for funds" : statusLabels[domain.status].toLowerCase()})
            </span>
          ))}
          .
        </Notice>
      ) : null}

      <TrafficCard store={store} traffic={traffic.data} loading={traffic.isLoading} />

      <Card>
        <CardHeader
          title="Your domains"
          description={`Your store is always on ${store.url.replace(/^https:\/\//, "")}. Open a domain to see what to set, its DNS records, email and renewal.`}
          actions={
            manage ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={<Link2 className="size-4" aria-hidden />} disabled={!allowed} onClick={() => router.push(storeHref("/store/domains/connect", store))}>Connect a domain</Button>
                <Button size="sm" icon={<ShoppingCart className="size-4" aria-hidden />} disabled={!allowed || !domains.buying.available} onClick={() => router.push(storeHref("/store/domains/buy", store))}>Buy a domain</Button>
              </div>
            ) : null
          }
        />
        {list.length ? (
          <DataTable columns={columns} rows={list} rowKey={domain => domain.id} onRowClick={domain => router.push(storeHref(`/store/domains/${domain.id}`, store))} caption="Your domains" />
        ) : (
          <EmptyState title="No domains yet" icon={<Globe className="size-6" aria-hidden />}>
            Buy a domain or connect one you own to use your own address.
          </EmptyState>
        )}
        {manage && full ? <div className="px-5 pb-5 sm:px-6"><Notice tone="blue">Your store has {domains.max_domains} domains, the most it can have. Disconnect one to add another.</Notice></div> : null}
      </Card>
      {!manage ? <Notice tone="blue">The owner or an admin of {membership.reseller.name} manages the store’s domains.</Notice> : null}
    </div>
  );
}

function AddingClosed({ store, domains }: { store: Store; domains: StoreDomains }) {
  const { manage, full } = useAdding(domains);
  return (
    <Notice tone="blue">
      {!manage ? "The owner or an admin manages the store’s domains." : full ? `Your store has ${domains.max_domains} domains, the most it can have. Disconnect one to add another.` : null}{" "}
      <AppLink href={storeHref("/store/domains", store)} className="font-semibold underline">Back to domains</AppLink>
    </Notice>
  );
}

/** Store > Domains > Buy: search, the price and renewal, the registrant, then the domain's own page. */
export function BuyDomainScreen({ store, domains }: { store: Store; domains: StoreDomains }) {
  const router = useRouter();
  const { user, membership, mode } = useReseller();
  const { allowed } = useAdding(domains);
  if (!allowed) return <AddingClosed store={store} domains={domains} />;
  const [first, ...rest] = user.name.trim().split(/\s+/);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BuyDomain
        store={store.id}
        available={domains.buying.available}
        tlds={domains.buying.tlds}
        live={mode === "live"}
        contactDefaults={{ first_name: first ?? "", last_name: rest.join(" "), email: user.email, phone: user.phone ?? "", country: membership.reseller.country ?? "", company_name: membership.reseller.name }}
        onBought={domain => router.push(storeHref(`/store/domains/${domain.id}`, store))}
      />
      <p className="text-sm text-muted">
        Already own a domain? <AppLink href={storeHref("/store/domains/connect", store)} className="font-semibold text-brand-600 hover:underline">Connect it instead</AppLink>.
      </p>
    </div>
  );
}

const connectSteps = [
  { title: "Add your domain", body: "Any ending, from any registrar: .com, .ng, .com.ng, .co.uk and more." },
  { title: "Set two records", body: "We show the records to add at your DNS host, or you move its nameservers to BitoCard and manage DNS here." },
  { title: "Go live", body: "We check automatically, set up HTTPS and email you as soon as your store is live on it." },
];

/** Store > Domains > Connect: a domain bought elsewhere, then its own page with what to set. */
export function ConnectDomainScreen({ store, domains }: { store: Store; domains: StoreDomains }) {
  const router = useRouter();
  const { allowed } = useAdding(domains);
  if (!allowed) return <AddingClosed store={store} domains={domains} />;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <ConnectDomain store={store.id} onConnected={domain => router.push(storeHref(`/store/domains/${domain.id}`, store))} />
      <Card>
        <CardHeader title="How it works" />
        <ol className="grid gap-4 px-5 pb-5 pt-4 sm:grid-cols-3 sm:px-6">
          {connectSteps.map((step, index) => (
            <li key={step.title} className="space-y-1">
              <span className="grid size-7 place-items-center rounded-full bg-brand-50 text-sm font-bold text-brand-600">{index + 1}</span>
              <p className="font-semibold text-ink">{step.title}</p>
              <p className="text-sm text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </Card>
      {domains.buying.available ? (
        <p className="text-sm text-muted">
          No domain yet? <AppLink href={storeHref("/store/domains/buy", store)} className="font-semibold text-brand-600 hover:underline">Buy one here</AppLink>.
        </p>
      ) : null}
    </div>
  );
}

/** Store > Domains > a domain: its connection, DNS, email and renewal. */
export function DomainScreen({ store, domains, id }: { store: Store; domains: StoreDomains; id: string }) {
  const router = useRouter();
  const { membership } = useReseller();
  const domain = domains.data.find(item => item.id === id);
  if (!domain) {
    return (
      <EmptyState title="No such domain" icon={<Globe className="size-6" aria-hidden />}>
        It may have been disconnected. <AppLink href={storeHref("/store/domains", store)} className="font-semibold text-brand-600 hover:underline">Back to domains</AppLink>
      </EmptyState>
    );
  }
  return (
    <div className="space-y-6">
      <DomainTraffic store={store} name={domain.name} />
      <DomainCard store={store.id} domain={domain} owner={membership.role === "owner"} canManage={can(membership, "admin")} onRemoved={() => router.push(storeHref("/store/domains", store))} />
    </div>
  );
}

/** One domain's visits over the last 30 days. */
function DomainTraffic({ store, name }: { store: Store; name: string }) {
  const traffic = useStoreTrafficQuery({ id: store.id, days: 30 });
  const visits = traffic.data?.hosts.find(host => host.host === name);
  const share = traffic.data?.views ? Math.round(((visits?.views ?? 0) / traffic.data.views) * 100) : null;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard label="Visitors · 30 days" value={traffic.data ? count(visits?.visitors ?? 0) : "—"} icon={<Eye />} loading={traffic.isLoading} />
      <StatCard label="Page views · 30 days" value={traffic.data ? count(visits?.views ?? 0) : "—"} icon={<Globe />} tone="blue" loading={traffic.isLoading} />
      <StatCard label="Share of your store’s views" value={share === null ? "—" : `${share}%`} icon={<CheckCircle2 />} tone="green" loading={traffic.isLoading} footer={<span className="text-sm text-muted">Across all its addresses</span>} />
    </div>
  );
}
