"use client";

import { afterEntryUpload, afterUpload, expired, type OfflineCopy, pendingUpload, type UploadResult } from "./offline-rules";
import { dropEntry, dropSale, keySentFor, markKeySent, publicKey, readEntries, readMeta, readSales, readShift, saveEntry, saveSale, writeCopy, writeMeta, writeShift } from "./offline-store";

const batch = 50;

/**
 * Uploads what waits on this device (sales, refunds, shift steps and stock changes), in the order it happened, a batch
 * at a time: each answered by Udozo is marked (a sale with its POS- number, flagged or refused); a failed request
 * stops, to be sent again, never skipping ahead. Then the copy is read again, so what is free counts what Udozo now
 * has. Answers how many still wait, or null when offline.
 */
export async function syncNow(): Promise<{ waiting: number; uploaded: number } | null> {
  let uploaded = 0;
  for (;;) {
    const [sales, entries] = await Promise.all([readSales(), readEntries()]);
    const waiting = pendingUpload(sales, entries);
    if (!waiting.length) break;
    const chunk = waiting.slice(0, batch);
    let response: Response;
    try {
      response = await fetch("/api/offline/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entries: chunk.map(row => row.body) }), cache: "no-store" });
    } catch {
      return null;
    }
    if (!response.ok) return { waiting: waiting.length, uploaded };
    const body = (await response.json()) as { results: UploadResult[] };
    const byId = new Map(body.results.map(result => [result.client_id, result]));
    const salesById = new Map(sales.map(sale => [sale.client_sale_id, sale]));
    const entriesById = new Map(entries.map(entry => [entry.client_id, entry]));
    for (const row of chunk) {
      const result = byId.get(row.id);
      if (!result) continue;
      const sale = salesById.get(row.id);
      if (sale) await saveSale(afterUpload(sale, result));
      const entry = entriesById.get(row.id);
      if (entry) await saveEntry(afterEntryUpload(entry, result));
      uploaded += 1;
    }
    if (chunk.every(row => !byId.has(row.id))) break;
  }
  // Uploaded sales and steps are kept 30 days (sales to reprint), then dropped.
  for (const sale of await readSales()) if (expired(sale)) await dropSale(sale.client_sale_id);
  for (const entry of await readEntries()) if (expired(entry)) await dropEntry(entry.client_id);
  await refreshCopy();
  const [sales, entries] = await Promise.all([readSales(), readEntries()]);
  return { waiting: pendingUpload(sales, entries).length, uploaded };
}

/** Reads the till's copy from Udozo and keeps it; false when it could not (offline, or the device unlinked). */
export async function refreshCopy() {
  try {
    const response = await fetch("/api/offline/copy", { cache: "no-store" });
    if (!response.ok) return false;
    const copy = (await response.json()) as OfflineCopy;
    await writeCopy(copy);
    const meta = await readMeta();
    const [sales, entries] = await Promise.all([readSales(), readEntries()]);
    // Sales made offline count from the last sync: whatever is still waiting.
    await writeMeta({ ...meta, synced_at: copy.synced_at, offline_sales: sales.filter(sale => sale.status === "waiting").length });
    // With nothing about shifts waiting, the till's shift is Udozo's.
    if (!entries.some(entry => entry.status === "waiting" && entry.kind.startsWith("shift_"))) {
      const local = await readShift();
      const shift = copy.shift ?? null;
      await writeShift(shift ? { id: shift.id, client_id: shift.client_id, opened_at: shift.opened_at, opened_by: shift.opened_by, opening_float: shift.opening_float, cash: local && (local.id === shift.id || (local.client_id && local.client_id === shift.client_id)) ? local.cash : [] } : null);
    }
    await sendKey(copy);
    return true;
  } catch {
    return false;
  }
}

/** Gives Udozo this device's public signing key once, so a file of its unsent sales can be checked. */
async function sendKey(copy: OfflineCopy) {
  if (!copy.device) return;
  if (copy.device.key && (await keySentFor()) === copy.device.id) return;
  try {
    const response = await fetch("/api/offline/key", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ public_key: await publicKey() }), cache: "no-store" });
    if (response.ok) await markKeySent(copy.device.id);
  } catch {
    // Next time.
  }
}
