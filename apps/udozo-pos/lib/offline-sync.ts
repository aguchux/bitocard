"use client";

import { afterUpload, expired, type OfflineCopy, uploadEntry, type UploadResult } from "./offline-rules";
import { dropSale, readMeta, readSales, saveSale, writeCopy, writeMeta } from "./offline-store";

const batch = 50;

/**
 * Uploads the sales waiting on this device, oldest first, a batch at a time: each answered by Udozo is marked with its
 * POS- number (or flagged, or refused); a failed request stops, to be sent again, never skipping ahead. Then the copy
 * is read again, so what is free counts what Udozo now has. Answers how many still wait, or null when offline.
 */
export async function syncNow(): Promise<{ waiting: number; uploaded: number } | null> {
  let uploaded = 0;
  for (;;) {
    const waiting = (await readSales()).filter(sale => sale.status === "waiting");
    if (!waiting.length) break;
    const chunk = waiting.slice(0, batch);
    let response: Response;
    try {
      response = await fetch("/api/offline/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entries: chunk.map(uploadEntry) }), cache: "no-store" });
    } catch {
      return null;
    }
    if (!response.ok) return { waiting: waiting.length, uploaded };
    const body = (await response.json()) as { results: UploadResult[] };
    const byId = new Map(body.results.map(result => [result.client_id, result]));
    for (const sale of chunk) {
      const result = byId.get(sale.client_sale_id);
      if (!result) continue;
      await saveSale(afterUpload(sale, result));
      uploaded += 1;
    }
    if (chunk.every(sale => !byId.has(sale.client_sale_id))) break;
  }
  // Uploaded sales are kept 30 days to reprint, then dropped.
  for (const sale of await readSales()) if (expired(sale)) await dropSale(sale.client_sale_id);
  await refreshCopy();
  const still = (await readSales()).filter(sale => sale.status === "waiting").length;
  return { waiting: still, uploaded };
}

/** Reads the till's copy from Udozo and keeps it; false when it could not (offline, or the device unlinked). */
export async function refreshCopy() {
  try {
    const response = await fetch("/api/offline/copy", { cache: "no-store" });
    if (!response.ok) return false;
    const copy = (await response.json()) as OfflineCopy;
    await writeCopy(copy);
    const meta = await readMeta();
    // Sales made offline count from the last sync: whatever is still waiting.
    const waiting = (await readSales()).filter(sale => sale.status === "waiting").length;
    await writeMeta({ ...meta, synced_at: copy.synced_at, offline_sales: waiting });
    return true;
  } catch {
    return false;
  }
}
