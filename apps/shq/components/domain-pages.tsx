"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, CheckCircle2, Globe, Link2, ShoppingCart } from "lucide-react";
import { Badge, Button, Card, CardHeader, type Column, DataTable, EmptyState, errorMessage, formatDate, formatRelative, Notice, QueryView, Skeleton, StatCard } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type Store, type StoreDomain, type StoreDomains, useStoreDomainsQuery, useStoresQuery } from "@bitocard/api-client/reseller";
import { BuyDomain, ConnectDomain, DomainCard, mailNames, statusLabels, statusTone } from "@/components/domains";
import { can, useReseller } from "@/components/reseller";

/** Domains that count towards the store's limit (not dismissed or never bought). */
const counted = (domains: StoreDomain[]) => domains.filter(domain => !["removed", "failed"].includes(domain.status));
/** Domains the reseller has something to do about. */
const needsAttention = (domain: StoreDomain) => ["pending", "expired", "suspended", "failed"].includes(domain.status) || Boolean(domain.renewal_error);

/** The reseller's store and its domains, or why they cannot be shown. */
export function WithDomains({ children }: { children: (store: Store, domains: StoreDomains) => ReactNode }) {
  const stores = useStoresQuery();
  return (
    <QueryView query={stores} loading={<Skeleton className="h-64 w-full" />} message={error => errorMessage(error, "Could not load your store.")}>
      {({ data: [store] }) =>
        store ? (
          <StoreDomainsView key={store.id} store={store}>
            {children}
          </StoreDomainsView>
        ) : (
          <Notice tone="blue">
            Create your store first: <AppLink href="/store" className="font-semibold text-brand-600 hover:underline">Store</AppLink>.
          </Notice>
        )
      }
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
    { key: "checked", header: "Checked", hideOnMobile: true, cell: domain => formatRelative(domain.last_checked_at) },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Domains" value={list.length} icon={<Globe />} footer={<span className="text-sm text-muted">of {domains.max_domains} for your store</span>} />
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
              <AppLink href={`/store/domains/${domain.id}`} className="font-semibold underline">{domain.name}</AppLink> ({domain.renewal_error === "insufficient_funds" ? "renewal waiting for funds" : statusLabels[domain.status].toLowerCase()})
            </span>
          ))}
          .
        </Notice>
      ) : null}

      <Card>
        <CardHeader
          title="Your domains"
          description={`Your store is always on ${store.url.replace(/^https:\/\//, "")}. Open a domain to see what to set, its DNS records, email and renewal.`}
          actions={
            manage ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={<Link2 className="size-4" aria-hidden />} disabled={!allowed} onClick={() => router.push("/store/domains/connect")}>Connect a domain</Button>
                <Button size="sm" icon={<ShoppingCart className="size-4" aria-hidden />} disabled={!allowed || !domains.buying.available} onClick={() => router.push("/store/domains/buy")}>Buy a domain</Button>
              </div>
            ) : null
          }
        />
        {list.length ? (
          <DataTable columns={columns} rows={list} rowKey={domain => domain.id} onRowClick={domain => router.push(`/store/domains/${domain.id}`)} caption="Your domains" />
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

function AddingClosed({ domains }: { domains: StoreDomains }) {
  const { manage, full } = useAdding(domains);
  return (
    <Notice tone="blue">
      {!manage ? "The owner or an admin manages the store’s domains." : full ? `Your store has ${domains.max_domains} domains, the most it can have. Disconnect one to add another.` : null}{" "}
      <AppLink href="/store/domains" className="font-semibold underline">Back to domains</AppLink>
    </Notice>
  );
}

/** Store > Domains > Buy: search, the price and renewal, the registrant, then the domain's own page. */
export function BuyDomainScreen({ store, domains }: { store: Store; domains: StoreDomains }) {
  const router = useRouter();
  const { user, membership, mode } = useReseller();
  const { allowed } = useAdding(domains);
  if (!allowed) return <AddingClosed domains={domains} />;
  const [first, ...rest] = user.name.trim().split(/\s+/);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BuyDomain
        store={store.id}
        available={domains.buying.available}
        tlds={domains.buying.tlds}
        live={mode === "live"}
        contactDefaults={{ first_name: first ?? "", last_name: rest.join(" "), email: user.email, phone: user.phone ?? "", country: membership.reseller.country ?? "", company_name: membership.reseller.name }}
        onBought={domain => router.push(`/store/domains/${domain.id}`)}
      />
      <p className="text-sm text-muted">
        Already own a domain? <AppLink href="/store/domains/connect" className="font-semibold text-brand-600 hover:underline">Connect it instead</AppLink>.
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
  if (!allowed) return <AddingClosed domains={domains} />;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <ConnectDomain store={store.id} onConnected={domain => router.push(`/store/domains/${domain.id}`)} />
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
          No domain yet? <AppLink href="/store/domains/buy" className="font-semibold text-brand-600 hover:underline">Buy one here</AppLink>.
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
        It may have been disconnected. <AppLink href="/store/domains" className="font-semibold text-brand-600 hover:underline">Back to domains</AppLink>
      </EmptyState>
    );
  }
  return <DomainCard store={store.id} domain={domain} owner={membership.role === "owner"} canManage={can(membership, "admin")} onRemoved={() => router.push("/store/domains")} />;
}
