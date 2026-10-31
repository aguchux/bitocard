"use client";

import { useId, useMemo, useState, type ChangeEvent } from "react";
import { FileUp } from "lucide-react";
import { Button, Card, CardHeader, errorMessage, Field, formatNumber, Input, Notice, PageHeader, Select, Textarea } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { useImportMarketingProspectsMutation, useMarketingSummaryQuery } from "@bitocard/api-client/admin";
import { UdozoShell } from "@/components/shell";
import { batches, guessMapping, type ImportField, importFields, parseCsv, rowsFor, sellersIn } from "@/components/marketing/csv";

const skipReasons: Record<string, string> = { no_contact: "no phone or email", phone_invalid: "no Nigerian mobile number we could read", email_invalid: "an email we could not read" };

/**
 * Marketing > Import a list: a CSV of sellers (a Jiji export: advert link, title, price, category, location, seller
 * name, notes, phone), its columns matched to Marketing's fields, sent in batches. Rows with the same phone become one
 * seller with all their adverts; sellers already here get the new adverts.
 */
export default function MarketingImportPage() {
  const id = useId();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<ImportField, number | null> | null>(null);
  const [source, setSource] = useState("Jiji");
  const [owner, setOwner] = useState("");
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const [result, setResult] = useState<{ created: number; merged: number; skipped: Array<{ row: number; reason: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const summary = useMarketingSummaryQuery();
  const [importRows] = useImportMarketingProspectsMutation();

  const table = useMemo(() => (text.trim() ? parseCsv(text) : []), [text]);
  const headers = table[0] ?? [];
  const map = mapping ?? guessMapping(headers);
  const rows = useMemo(() => (table.length > 1 ? rowsFor(table, map) : []), [table, map]);
  const sellers = useMemo(() => sellersIn(rows), [rows]);
  const missingPhone = map.phone === null && map.email === null;

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setMapping(null);
    setResult(null);
    setText(await file.text());
  };

  const run = async () => {
    setError(null);
    setResult(null);
    const parts = batches(rows);
    const total = { created: 0, merged: 0, skipped: [] as Array<{ row: number; reason: string }> };
    try {
      for (const [index, part] of parts.entries()) {
        setProgress({ done: index, of: parts.length });
        const reply = await importRows({ rows: part, source: source.trim() || "Jiji", owner_id: owner || undefined }).unwrap();
        total.created += reply.created;
        total.merged += reply.merged;
        total.skipped.push(...reply.skipped.map(item => ({ row: index * 100 + item.row + 2, reason: item.reason })));
      }
      setResult(total);
    } catch (problem) {
      setError(`${errorMessage(problem)} ${total.created || total.merged ? `${formatNumber(total.created)} added and ${formatNumber(total.merged)} updated before it stopped; importing again only adds what is missing.` : ""}`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <UdozoShell section="marketplace" current="/classifieds/marketing" crumbs={[{ label: "Marketplace", href: "/classifieds" }, { label: "Marketing", href: "/classifieds/marketing" }, { label: "Import a list" }]}>
      <PageHeader title="Import a list of sellers" description="A CSV from Jiji or any spreadsheet. Rows with the same phone number become one seller with all their adverts, and sellers already in Marketing get the new adverts instead of a second entry." />
      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-6">
          <Card>
            <CardHeader title="1. The list" description="Choose the CSV file, or paste its contents." />
            <div className="grid gap-4 p-5 sm:px-6">
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line p-4 hover:border-brand-400">
                <FileUp className="size-5 text-brand-600" aria-hidden />
                <span className="text-sm">
                  <span className="font-semibold text-ink">{fileName ?? "Choose a CSV file"}</span>
                  <span className="block text-muted">The first row names the columns.</span>
                </span>
                <input type="file" accept=".csv,text/csv" className="sr-only" onChange={choose} aria-label="CSV file" />
              </label>
              <Field label="Or paste it" htmlFor={`${id}-paste`}>
                <Textarea id={`${id}-paste`} rows={5} value={text} onChange={event => (setText(event.target.value), setFileName(null), setMapping(null), setResult(null))} placeholder="advert_url,title,price,category,location,seller_display_name,notes,phone" />
              </Field>
            </div>
          </Card>

          {headers.length ? (
            <Card>
              <CardHeader title="2. Match the columns" description={`${formatNumber(rows.length)} rows, about ${formatNumber(sellers)} sellers.`} />
              <div className="grid gap-3 p-5 sm:grid-cols-2 sm:px-6">
                {importFields.map(field => (
                  <Field key={field.key} label={field.label} htmlFor={`${id}-${field.key}`}>
                    <Select id={`${id}-${field.key}`} value={map[field.key] === null ? "" : String(map[field.key])} onChange={event => setMapping({ ...map, [field.key]: event.target.value === "" ? null : Number(event.target.value) })}>
                      <option value="">Not in this list</option>
                      {headers.map((header, index) => (
                        <option key={`${header}-${index}`} value={index}>
                          {header || `Column ${index + 1}`}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>
              {missingPhone ? (
                <div className="px-5 pb-5 sm:px-6">
                  <Notice tone="amber">Choose the column with phone numbers (or emails): sellers are reached and grouped by them.</Notice>
                </div>
              ) : null}
              {rows.length ? (
                <div className="overflow-x-auto px-5 pb-5 sm:px-6">
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <thead className="text-muted">
                      <tr>
                        <th className="py-1 pr-3">Seller</th>
                        <th className="py-1 pr-3">Phone</th>
                        <th className="py-1 pr-3">Category</th>
                        <th className="py-1 pr-3">Location</th>
                        <th className="py-1">Advert</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 8).map((row, index) => (
                        <tr key={index} className="border-t border-line">
                          <td className="py-1.5 pr-3">{row.name ?? row.store_name ?? <span className="text-muted">—</span>}</td>
                          <td className="py-1.5 pr-3">{row.phone ?? <span className="text-muted">—</span>}</td>
                          <td className="py-1.5 pr-3">{row.category ?? "—"}</td>
                          <td className="py-1.5 pr-3">{row.location ?? "—"}</td>
                          <td className="max-w-56 truncate py-1.5">{row.title ?? row.advert_url ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-muted">The first {Math.min(8, rows.length)} rows.</p>
                </div>
              ) : null}
            </Card>
          ) : null}
        </div>

        <Card>
          <CardHeader title="3. Import" />
          <div className="grid gap-4 p-5 sm:px-6">
            <Field label="Where the list is from" htmlFor={`${id}-source`}>
              <Input id={`${id}-source`} value={source} maxLength={60} onChange={event => setSource(event.target.value)} />
            </Field>
            <Field label="Give them to" htmlFor={`${id}-owner`} hint="Someone to reach out to them; you can share them out later.">
              <Select id={`${id}-owner`} value={owner} onChange={event => setOwner(event.target.value)}>
                <option value="">No one yet</option>
                {(summary.data?.owners ?? []).map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            {error ? <Notice tone="red">{error}</Notice> : null}
            {result ? (
              <Notice tone="green" title="Imported">
                {formatNumber(result.created)} sellers added, {formatNumber(result.merged)} already here updated
                {result.skipped.length ? `, ${formatNumber(result.skipped.length)} rows skipped` : ""}.{" "}
                <AppLink href="/classifieds/marketing" className="font-semibold text-brand-600 hover:underline">
                  Open the pipeline
                </AppLink>
              </Notice>
            ) : null}
            {result?.skipped.length ? (
              <ul className="max-h-40 overflow-y-auto text-xs text-muted">
                {result.skipped.slice(0, 50).map(item => (
                  <li key={item.row}>
                    Row {item.row}: {skipReasons[item.reason] ?? item.reason}
                  </li>
                ))}
              </ul>
            ) : null}
            <Button onClick={run} loading={Boolean(progress)} disabled={!rows.length || missingPhone || Boolean(progress)}>
              {progress ? `Importing ${progress.done + 1} of ${progress.of}…` : `Import ${formatNumber(rows.length)} rows`}
            </Button>
          </div>
        </Card>
      </div>
    </UdozoShell>
  );
}
