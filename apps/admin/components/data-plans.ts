/**
 * Africa's Talking's data bundles as rows. The setting is stored as one plan a line, `KE safaricom 1GB Month 299 250`
 * (country, network, size, validity, the price customers know it by, BitoCard's cost), the format the API's
 * `parseDataPlans` reads; these helpers turn it into rows for the editor and back, with the same rules.
 */

export const validities = [
  { value: "Day", label: "1 day" },
  { value: "Week", label: "7 days" },
  { value: "BiWeek", label: "14 days" },
  { value: "Month", label: "30 days" },
  { value: "Quarterly", label: "90 days" },
] as const;

/** Where Africa's Talking sells mobile data, with the networks it reaches (its airtime countries). */
export const planCountries = [
  { code: "KE", name: "Kenya", currency: "KES", networks: ["safaricom", "airtel", "telkom"] },
  { code: "UG", name: "Uganda", currency: "UGX", networks: ["mtn", "airtel"] },
  { code: "TZ", name: "Tanzania", currency: "TZS", networks: ["vodacom", "airtel", "tigo", "halotel"] },
  { code: "NG", name: "Nigeria", currency: "NGN", networks: ["mtn", "airtel", "glo", "9mobile"] },
  { code: "GH", name: "Ghana", currency: "GHS", networks: ["mtn", "telecel", "airteltigo"] },
  { code: "ZA", name: "South Africa", currency: "ZAR", networks: ["vodacom", "mtn", "cell-c", "telkom"] },
] as const;

export const networkLabel = (network: string) =>
  ({ safaricom: "Safaricom", airtel: "Airtel", telkom: "Telkom", mtn: "MTN", vodacom: "Vodacom", tigo: "Tigo", halotel: "Halotel", glo: "Glo", "9mobile": "9mobile", telecel: "Telecel", airteltigo: "AirtelTigo", "cell-c": "Cell C" })[network] ??
  network;

export type PlanRow = { id: string; country: string; network: string; size: string; unit: "MB" | "GB"; validity: string; price: string; cost: string };

let counter = 0;
const nextId = () => `plan-${++counter}`;

export const emptyPlan = (previous?: PlanRow): PlanRow => ({
  id: nextId(),
  country: previous?.country ?? "KE",
  network: previous?.network ?? planCountries.find(item => item.code === (previous?.country ?? "KE"))!.networks[0],
  size: "",
  unit: "GB",
  validity: "Month",
  price: "",
  cost: "",
});

const linePattern = /^([A-Za-z]{2})\s+([a-z0-9-]+)\s+(\d+(?:\.\d+)?)\s*(MB|GB)\s+(Day|Week|BiWeek|Month|Quarterly)\s+(\d+(?:\.\d{1,2})?)\s+(\d+(?:\.\d{1,4})?)$/i;

/** The setting's text as rows; lines that cannot be read are kept apart, word for word, to be removed or re-entered. */
export function parsePlans(text: string | null | undefined): { rows: PlanRow[]; unreadable: string[] } {
  const rows: PlanRow[] = [];
  const unreadable: string[] = [];
  for (const line of (text ?? "").split(/[;\n]/).map(item => item.trim()).filter(Boolean)) {
    const match = linePattern.exec(line);
    const validity = match && validities.find(item => item.value.toLowerCase() === match[5].toLowerCase());
    if (!match || !validity) {
      unreadable.push(line);
      continue;
    }
    rows.push({ id: nextId(), country: match[1].toUpperCase(), network: match[2].toLowerCase(), size: match[3], unit: match[4].toUpperCase() as "MB" | "GB", validity: validity.value, price: match[6], cost: match[7] });
  }
  return { rows, unreadable };
}

const positive = (value: string, places: number) => new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`).test(value.trim()) && Number(value) > 0;

/** What a row still needs, in words, or null when it is a plan Africa's Talking can be sent. */
export function rowProblem(row: PlanRow): string | null {
  if (!/^[A-Z]{2}$/.test(row.country)) return "Choose a country.";
  if (!/^[a-z0-9-]+$/.test(row.network)) return "Choose a network.";
  if (!positive(row.size, 6)) return "Enter the bundle size.";
  if (!validities.some(item => item.value === row.validity)) return "Choose how long it lasts.";
  if (!positive(row.price, 2)) return "Enter the price customers know it by (up to 2 decimals).";
  if (!positive(row.cost, 4)) return "Enter what Africa’s Talking charges (up to 4 decimals).";
  if (Number(row.cost) > Number(row.price)) return "It costs more than its price, so it would never be synced.";
  return null;
}

const duplicateKey = (row: PlanRow) => [row.country, row.network, `${Number(row.size)}${row.unit}`, row.validity].join(" ");

/** Rows that repeat another's country, network, size and validity (the second would replace the first). */
export function duplicateRows(rows: PlanRow[]) {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const row of rows) {
    const key = duplicateKey(row);
    if (seen.has(key)) repeated.add(row.id);
    seen.add(key);
  }
  return repeated;
}

export const formatPlan = (row: PlanRow) => `${row.country} ${row.network} ${row.size.trim()}${row.unit} ${row.validity} ${row.price.trim()} ${row.cost.trim()}`;

/** The rows (and any lines still not understood) back as the setting's text, one plan a line. */
export const formatPlans = (rows: PlanRow[], unreadable: string[] = []) => [...rows.map(formatPlan), ...unreadable].join("\n");

/** Why the rows cannot be saved yet, or null. */
export function rowsProblem(rows: PlanRow[], unreadable: string[] = []): string | null {
  if (unreadable.length) return `Remove or re-enter the plans not understood: ${unreadable.join(", ")}.`;
  const index = rows.findIndex(row => rowProblem(row));
  if (index >= 0) return `Data plan ${index + 1}: ${rowProblem(rows[index])}`;
  if (duplicateRows(rows).size) return "Two data plans have the same country, network, size and validity: remove one.";
  return null;
}
