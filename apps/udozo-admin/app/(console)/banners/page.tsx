"use client";

import { useId, useState } from "react";
import { Image as ImageIcon, Plus } from "lucide-react";
import { ActionDialog, Badge, Button, Card, CardHeader, DataTable, Dialog, errorMessage, Field, formatDateTime, ImageField, Input, Notice, PageHeader, QueryView, Select, Skeleton, Textarea, Toggle } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { type Banner, type BannerInput, type BannerPosition, type BannerState, useBannersQuery, useCreateBannerMutation, useDeleteBannerMutation, useHomePagesQuery, useUpdateBannerMutation } from "@bitocard/api-client/admin";
import { UdozoShell } from "@/components/shell";

/** The places on udozo.com a banner can show, with the size that fits. */
const bannerPlaces: Record<BannerPosition, { name: string; hint: string }> = {
  account_rail: { name: "Account pages, above the menu", hint: "On computers, above the menu on the left of every account page: 240 px wide. Upload 480 px wide (twice for sharp screens), at least 80 px tall; it is never cropped." },
  dashboard_top: { name: "Dashboard, top strip", hint: "On the account dashboard, between the title and Post an ad on computers (about 600 px wide, 80 to 100 px tall); under the title, full width, on phones. Upload a wide strip, 1200 × 160 px; it is never cropped." },
  dashboard_side: { name: "Dashboard, under the message board", hint: "On the account dashboard, in the right column under the message board: 350 px wide on computers, full width on phones. Upload 700 px wide, 300 to 500 px tall; it is never cropped." },
  dashboard_main: { name: "Dashboard, under the chart", hint: "On the account dashboard, across the main column under the chart (about 700 to 900 px wide on computers, full width on phones). Upload 1600 × 250 px; it is never cropped." },
};

const stateTones: Record<BannerState, "green" | "grey" | "blue" | "amber"> = { showing: "green", off: "grey", scheduled: "blue", ended: "amber" };
const stateLabels: Record<BannerState, string> = { showing: "Showing", off: "Off", scheduled: "Scheduled", ended: "Ended" };

/** A date and time as the browser's datetime-local field wants it, in the admin's own time. */
const local = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

type Market = { code: string; name: string };

function BannerForm({ markets, banner, onDone }: { markets: Market[]; banner: Banner | null; onDone: () => void }) {
  const id = useId();
  const [create, created] = useCreateBannerMutation();
  const [update, updated] = useUpdateBannerMutation();
  const [position, setPosition] = useState<BannerPosition>(banner?.position ?? "account_rail");
  const [market, setMarket] = useState(banner?.country ?? "");
  const [image, setImage] = useState(banner?.image_url ?? "");
  const [href, setHref] = useState(banner?.href ?? "");
  const [alt, setAlt] = useState(banner?.alt ?? "");
  const [enabled, setEnabled] = useState(banner?.enabled ?? true);
  const [startsAt, setStartsAt] = useState(local(banner?.starts_at ?? null));
  const [endsAt, setEndsAt] = useState(local(banner?.ends_at ?? null));
  const [note, setNote] = useState(banner?.note ?? "");
  const state = banner ? updated : created;
  const param = ((state.error ?? null) as { param?: string } | null)?.param;
  const errorFor = (name: string) => (param === name ? errorMessage(state.error) : undefined);
  const submit = async () => {
    const body: BannerInput = {
      position,
      country: market || null,
      image_url: image.trim(),
      href: href.trim(),
      alt: alt.trim(),
      enabled,
      starts_at: startsAt ? new Date(startsAt).toISOString() : null,
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      note: note.trim() || null,
    };
    const done = banner ? update({ id: banner.id, ...body }) : create(body);
    if (await done.unwrap().then(() => true).catch(() => false)) onDone();
  };
  return (
    <form
      className="grid gap-4"
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field label="Where it shows" htmlFor={`${id}-position`} hint={bannerPlaces[position].hint} error={errorFor("position")}>
        <Select id={`${id}-position`} value={position} onChange={event => setPosition(event.target.value as BannerPosition)}>
          {Object.entries(bannerPlaces).map(([key, place]) => (
            <option key={key} value={key}>
              {place.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Market" htmlFor={`${id}-market`} hint="A market’s own banners show there in place of those for every market." error={errorFor("country")}>
        <Select id={`${id}-market`} value={market} onChange={event => setMarket(event.target.value)}>
          <option value="">Every market</option>
          {markets.map(item => (
            <option key={item.code} value={item.code}>
              {item.name}
            </option>
          ))}
        </Select>
      </Field>
      <ImageField label="Banner image" realm="admin" purpose="banner_image" value={image} onChange={setImage} hint="JPEG, PNG or WebP." error={errorFor("image_url")} />
      <Field label="Link" htmlFor={`${id}-href`} hint="A page on udozo.com, such as /ng/c/mobile-phones, or an https address elsewhere (opens in a new tab)." error={errorFor("href")}>
        <Input id={`${id}-href`} value={href} onChange={event => setHref(event.target.value)} placeholder="/ng/c/mobile-phones" required />
      </Field>
      <Field label="What the banner says" htmlFor={`${id}-alt`} hint="Read out to people who cannot see the image. Up to 120 characters." error={errorFor("alt")}>
        <Input id={`${id}-alt`} value={alt} maxLength={120} onChange={event => setAlt(event.target.value)} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts" htmlFor={`${id}-starts`} hint="Optional: at once when empty." error={errorFor("starts_at")}>
          <Input id={`${id}-starts`} type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} />
        </Field>
        <Field label="Ends" htmlFor={`${id}-ends`} hint="Optional: until switched off when empty." error={errorFor("ends_at")}>
          <Input id={`${id}-ends`} type="datetime-local" value={endsAt} onChange={event => setEndsAt(event.target.value)} />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Toggle checked={enabled} onChange={setEnabled} label="Show this banner" />
        <span className="text-sm text-ink">{enabled ? "On: shows on udozo.com" : "Off: never shows"}</span>
      </div>
      <Field label="Note" htmlFor={`${id}-note`} hint="Optional, for the team only: who it is for, what was agreed.">
        <Textarea id={`${id}-note`} value={note} maxLength={300} onChange={event => setNote(event.target.value)} />
      </Field>
      {state.error && !param?.match(/^(position|country|image_url|href|alt|starts_at|ends_at)$/) ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={state.isLoading} icon={<ImageIcon className="size-4" aria-hidden />}>
          {banner ? "Save banner" : "Add banner"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Banners({ markets, editable }: { markets: Market[]; editable: boolean }) {
  const [market, setMarket] = useState("");
  const banners = useBannersQuery({ country: market || undefined });
  const [update] = useUpdateBannerMutation();
  const [remove] = useDeleteBannerMutation();
  const [form, setForm] = useState<Banner | "new" | null>(null);
  const [deleting, setDeleting] = useState<Banner | null>(null);
  const marketName = (code: string | null) => (code ? (markets.find(item => item.code === code)?.name ?? code) : "Every market");
  return (
    <Card>
      <CardHeader
        title="Banners"
        description="Each shows in its place while it is on (and between its dates, when set), labelled Ad. A market shows one of its own banners, else one for every market. udozo.com shows changes within a minute."
        actions={editable ? <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setForm("new")}>Add banner</Button> : undefined}
      />
      <div className="flex flex-wrap gap-3 px-5 pb-4 sm:px-6">
        <Select aria-label="Market" value={market} onChange={event => setMarket(event.target.value)} className="w-auto">
          <option value="">Any market</option>
          <option value="global">Every market (shared)</option>
          {markets.map(item => (
            <option key={item.code} value={item.code}>
              {item.name}
            </option>
          ))}
        </Select>
      </div>
      <QueryView query={banners} loading={<Skeleton className="m-5 h-32" />}>
        {data => (
          <DataTable
            rows={data.data}
            rowKey={row => row.id}
            empty="No banners yet."
            columns={[
              {
                key: "image",
                header: "Banner",
                cell: row => (
                  // eslint-disable-next-line @next/next/no-img-element -- uploaded banners on Udozo's storage
                  <img src={row.image_url} alt={row.alt} className="h-12 w-auto max-w-[12rem] rounded border border-line object-contain" />
                ),
              },
              { key: "place", header: "Where", cell: row => bannerPlaces[row.position]?.name ?? row.position },
              { key: "market", header: "Market", cell: row => marketName(row.country) },
              { key: "link", header: "Link", cell: row => <span className="break-all text-sm">{row.href}</span> },
              { key: "when", header: "When", cell: row => (row.starts_at || row.ends_at ? `${row.starts_at ? formatDateTime(row.starts_at) : "Now"} – ${row.ends_at ? formatDateTime(row.ends_at) : "No end"}` : "Always") },
              { key: "state", header: "State", cell: row => <Badge tone={stateTones[row.state]}>{stateLabels[row.state]}</Badge> },
              {
                key: "on",
                header: "On",
                cell: row => <Toggle checked={row.enabled} disabled={!editable} label={`Show the banner “${row.alt}”`} onChange={enabled => void update({ id: row.id, enabled })} />,
              },
              {
                key: "actions",
                header: "Actions",
                cell: row =>
                  editable ? (
                    <span className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setForm(row)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(row)}>
                        Delete
                      </Button>
                    </span>
                  ) : null,
              },
            ]}
          />
        )}
      </QueryView>
      <Dialog open={form !== null} onClose={() => setForm(null)} title={form === "new" ? "Add a banner" : "Change the banner"}>
        {form !== null ? <BannerForm markets={markets} banner={form === "new" ? null : form} onDone={() => setForm(null)} /> : null}
      </Dialog>
      <ActionDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this banner?"
        description="It leaves udozo.com within a minute. Switch it off instead to keep it for later."
        confirmLabel="Delete"
        tone="danger"
        requireReason={false}
        onConfirm={async () => void (await remove(deleting!.id).unwrap())}
      />
    </Card>
  );
}

/** Site › Banners: banner ads Udozo's team places on udozo.com, switched on and off here. */
export default function BannersPage() {
  const admin = useAdmin();
  const editable = can(admin, "operations");
  const pages = useHomePagesQuery();
  return (
    <UdozoShell section="theme" current="/banners" crumbs={[{ label: "Site", href: "/home-pages" }, { label: "Banners" }]}>
      <PageHeader title="Banners" description="Banner ads on udozo.com: an image linking to a page, for one market or every market. Visitors always see them labelled Ad." />
      {!editable ? <Notice tone="grey">Only operations admins add and change banners.</Notice> : null}
      <QueryView query={pages} loading={<Skeleton className="h-48 w-full" />}>
        {data => <Banners markets={data.data.filter(item => item.scope === "country").map(item => ({ code: item.page, name: item.name }))} editable={editable} />}
      </QueryView>
    </UdozoShell>
  );
}
