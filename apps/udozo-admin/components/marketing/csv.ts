import type { MarketingImportRow } from "@bitocard/api-client/admin";

/**
 * Reading a sellers list (a Jiji export or any CSV) in the browser: the file is parsed here, its columns matched to
 * Marketing's fields, and sent in batches; the API groups rows by phone into one seller each.
 */

/** RFC 4180 CSV: quoted fields with commas, line breaks and doubled quotes, CRLF or LF, a BOM at the start. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === "") quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(cells => cells.some(cell => cell.trim() !== ""));
}

export type ImportField = keyof MarketingImportRow;

/** Marketing's fields, each with the column names a list may use for it. */
export const importFields: Array<{ key: ImportField; label: string; names: string[] }> = [
  { key: "name", label: "Seller name", names: ["seller_display_name", "seller_name", "seller", "name", "contact_name"] },
  { key: "store_name", label: "Store name", names: ["store_name", "storename", "store", "shop", "shop_name", "business", "business_name"] },
  { key: "phone", label: "Phone numbers", names: ["phone", "phones", "number", "phone_number", "mobile", "whatsapp", "telephone"] },
  { key: "email", label: "Email", names: ["email", "email_address", "e-mail"] },
  { key: "category", label: "Product category", names: ["category", "product_category", "categories"] },
  { key: "location", label: "Location", names: ["location", "area", "city", "region", "state"] },
  { key: "advert_url", label: "Advert link", names: ["advert_url", "url", "link", "ad_url", "listing_url"] },
  { key: "title", label: "Advert title", names: ["title", "advert_title", "product", "item"] },
  { key: "price", label: "Price", names: ["price", "amount"] },
  { key: "notes", label: "Notes", names: ["notes", "note", "badges", "description"] },
];

const normal = (header: string) => header.trim().toLowerCase().replace(/[\s-]+/g, "_");

/** Which column holds each field, guessed from the header names (null where none fits). */
export function guessMapping(headers: string[]): Record<ImportField, number | null> {
  const normals = headers.map(normal);
  const used = new Set<number>();
  const mapping = {} as Record<ImportField, number | null>;
  for (const field of importFields) {
    const index = field.names.map(name => normals.indexOf(name)).find(found => found >= 0 && !used.has(found));
    mapping[field.key] = index ?? null;
    if (index !== undefined) used.add(index);
  }
  return mapping;
}

/** The rows as the import takes them, by the mapping; rows with neither a phone nor an email are left to the API to report. */
export function rowsFor(table: string[][], mapping: Record<ImportField, number | null>): MarketingImportRow[] {
  return table.slice(1).map(cells => {
    const row: MarketingImportRow = {};
    for (const field of importFields) {
      const index = mapping[field.key];
      const value = index === null ? "" : (cells[index] ?? "").trim();
      if (value) row[field.key] = value;
    }
    return row;
  });
}

/** How many sellers the rows come to: distinct first phone numbers (or emails). */
export function sellersIn(rows: MarketingImportRow[]) {
  const keys = new Set<string>();
  for (const row of rows) {
    const first = (row.phone ?? "").split(/[;,/|]/)[0]!.replace(/\D/g, "").replace(/^234/, "0");
    const key = first || row.email?.toLowerCase();
    if (key) keys.add(key);
  }
  return keys.size;
}

/** In batches the API accepts (it reads at most 200 rows a request). */
export function batches<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
