"use client";

import { useId, useState, type FormEvent } from "react";
import { Stamp } from "lucide-react";
import { ActionDialog, Badge, Button, Card, CardHeader, DataTable, errorMessage, Field, formatDateTime, Input, KeyValue, Notice, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type StoreWatermark,
  type Switches,
  type WatermarkSettings,
  useClearStoreWatermarkMutation,
  useStoreWatermarksQuery,
  useSwitchesQuery,
  useUpdateWatermarkSettingsMutation,
  useWatermarkSettingsQuery,
  watermarkTextMax,
  watermarkTextProblem,
} from "@bitocard/api-client/admin";
import { UdozoShell } from "@/components/shell";
import { WatermarkPreview } from "@/components/watermark-preview";

/** A switch's global value: the global row, else its default, else off. */
const globalOn = (switches: Switches, key: string) => switches.data.find(row => row.key === key && row.scope === "global")?.enabled ?? switches.definitions[key]?.default ?? false;

const switchesLink = (
  <AppLink href="/settings" className="font-semibold text-brand-600 hover:underline">
    Settings &gt; Feature switches
  </AppLink>
);

/** Whether photos are marked at all (`photo_watermarks`) and whether resellers may use their own text (`store_watermarks`). */
function WatermarkStatus() {
  const switches = useSwitchesQuery();
  return (
    <Card>
      <CardHeader title="Is it on?" description={<>Both are switched in {switchesLink}.</>} />
      <QueryView query={switches} loading={<Skeleton className="m-5 h-24" />}>
        {data => {
          const photos = globalOn(data, "photo_watermarks");
          const stores = globalOn(data, "store_watermarks");
          const storesElsewhere = data.data.filter(row => row.key === "store_watermarks" && row.scope !== "global" && row.enabled).length;
          return (
            <div className="space-y-4 p-5 sm:p-6">
              <KeyValue
                items={[
                  {
                    label: "Watermarked photos",
                    value: (
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone={photos ? "green" : "grey"}>{photos ? "On" : "Off"}</Badge>
                        <span className="text-sm text-muted">{photos ? "People only see copies with the mark; originals are private." : "Photos are served as they were uploaded, without a mark."}</span>
                      </span>
                    ),
                  },
                  {
                    label: "Resellers’ own text",
                    value: (
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone={stores ? "green" : "grey"}>{stores ? "Allowed" : "Not allowed"}</Badge>
                        <span className="text-sm text-muted">
                          {stores ? "Resellers may set their own text for their stores in Seller HQ." : "Stores use Udozo’s text."}
                          {storesElsewhere ? ` Also switched on for ${storesElsewhere} ${storesElsewhere === 1 ? "market or reseller" : "markets or resellers"}.` : ""}
                        </span>
                      </span>
                    ),
                  },
                ]}
              />
              {photos ? (
                <Notice tone="amber" title="Once it is on: purge the CDN">
                  In DigitalOcean &gt; Spaces &gt; the CDN endpoint, purge the cache for <code>udozo/classifieds/*</code>, so copies the CDN still holds of the original photos stop being served. Browsers and search
                  engines may keep old copies.
                </Notice>
              ) : (
                <Notice tone="grey">
                  Switch on Watermarked photos once udozo.com serves marked photos. Then purge the Spaces CDN cache for <code>udozo/classifieds/*</code> (DigitalOcean &gt; Spaces &gt; the CDN endpoint).
                </Notice>
              )}
            </div>
          );
        }}
      </QueryView>
    </Card>
  );
}

/** Udozo's text: the field with its live preview, saved by operations. */
function UdozoText({ settings, editable }: { settings: WatermarkSettings; editable: boolean }) {
  const id = useId();
  const [text, setText] = useState(settings.text);
  const [saved, setSaved] = useState(false);
  const [update, state] = useUpdateWatermarkSettingsMutation();
  const problem = watermarkTextProblem(text);
  const dirty = text.trim() !== settings.text;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    if (await update({ text: text.trim() }).unwrap().then(() => true).catch(() => false)) setSaved(true);
  };
  return (
    <Card>
      <CardHeader title="Udozo’s watermark" description="Drawn on every photo on udozo.com, and on stores without their own text. Saving gives photos new addresses, so the new text shows at once." />
      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <form onSubmit={save} className="space-y-4">
          {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
          {saved && !dirty ? <Notice tone="green">Watermark saved.</Notice> : null}
          <Field label="Watermark text" htmlFor={`${id}-text`} hint="2 to 30 letters, digits, spaces and . - _ @" error={dirty && problem ? problem : undefined}>
            <Input id={`${id}-text`} value={text} maxLength={watermarkTextMax + 10} onChange={event => setText(event.target.value)} disabled={!editable} spellCheck={false} autoComplete="off" />
          </Field>
          <KeyValue
            items={[
              { label: "Version", value: String(settings.version) },
              { label: "Last changed", value: settings.updated_at ? `${formatDateTime(settings.updated_at)}${settings.updated_by ? ` by ${settings.updated_by.name}` : ""}` : "Never" },
            ]}
          />
          {editable ? (
            <Button type="submit" loading={state.isLoading} disabled={!dirty || Boolean(problem)} icon={<Stamp className="size-4" aria-hidden />}>
              Save watermark
            </Button>
          ) : null}
        </form>
        <WatermarkPreview text={problem ? settings.text : text} />
      </div>
    </Card>
  );
}

/** Stores whose resellers set their own text, each cleared by operations with a reason. */
function StoreTexts({ editable }: { editable: boolean }) {
  const stores = useStoreWatermarksQuery();
  const [clear] = useClearStoreWatermarkMutation();
  const [clearing, setClearing] = useState<StoreWatermark | null>(null);
  return (
    <Card>
      <CardHeader title="Stores with their own text" description="Where resellers may, a store’s own text is drawn on the photos on its pages. Clearing it puts Udozo’s back; the reseller is told." />
      <QueryView query={stores} loading={<Skeleton className="m-5 h-24" />}>
        {data => (
          <DataTable
            rows={data.data}
            rowKey={row => row.id}
            empty="No store has its own text."
            columns={[
              {
                key: "store",
                header: "Store",
                cell: row => (
                  <span className="grid">
                    <span className="font-semibold text-ink">{row.name}</span>
                    <span className="break-all text-sm text-muted">{row.address}</span>
                  </span>
                ),
              },
              {
                key: "reseller",
                header: "Reseller",
                cell: row => (
                  <AppLink href={`/resellers/${row.reseller.id}`} className="font-semibold text-brand-600 hover:underline">
                    {row.reseller.name}
                  </AppLink>
                ),
              },
              { key: "text", header: "Their text", cell: row => <span className="font-mono text-sm">{row.watermark_text}</span> },
              { key: "updated", header: "Set", cell: row => formatDateTime(row.updated_at) },
              {
                key: "actions",
                header: "Actions",
                cell: row =>
                  editable ? (
                    <Button size="sm" variant="secondary" onClick={() => setClearing(row)}>
                      Clear
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </QueryView>
      <ActionDialog
        open={clearing !== null}
        onClose={() => setClearing(null)}
        title={`Clear ${clearing?.name ?? "this store"}’s watermark?`}
        description={`Its photos go back to Udozo’s text, and the reseller is told why. They can set “${clearing?.watermark_text ?? ""}” or another text again while they are allowed to.`}
        confirmLabel="Clear"
        tone="danger"
        onConfirm={reason => clear({ id: clearing!.id, reason }).unwrap()}
      />
    </Card>
  );
}

/** Site › Watermarks: the text drawn on listing photos, whether it is on, and stores with their own. */
export default function WatermarksPage() {
  const admin = useAdmin();
  const editable = can(admin, "operations");
  const settings = useWatermarkSettingsQuery();
  return (
    <UdozoShell section="theme" current="/watermarks" crumbs={[{ label: "Site", href: "/home-pages" }, { label: "Watermarks" }]}>
      <PageHeader title="Watermarks" description="The text drawn on listing photos, so copies taken for fake listings elsewhere still say where they came from." />
      {!editable ? <Notice tone="grey">Only operations admins change the watermark and clear stores’ text.</Notice> : null}
      <div className="space-y-6">
        <WatermarkStatus />
        <QueryView query={settings} loading={<Skeleton className="h-64 w-full" />}>
          {data => <UdozoText settings={data} editable={editable} />}
        </QueryView>
        <StoreTexts editable={editable} />
      </div>
    </UdozoShell>
  );
}
