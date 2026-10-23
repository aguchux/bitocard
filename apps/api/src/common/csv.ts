/**
 * RFC 4180 CSV. Every row must have the same keys as `columns` (in order); a missing key renders empty. Values are
 * quoted only when they contain a comma, quote or newline (a quote inside is doubled).
 */
export function toCsv(columns: Array<{ key: string; header: string }>, rows: Array<Record<string, string | number | null | undefined>>): string {
  const cell = (value: string | number | null | undefined) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map(column => cell(column.header)).join(',')];
  for (const row of rows) lines.push(columns.map(column => cell(row[column.key])).join(','));
  // CRLF, as RFC 4180 specifies (and what spreadsheet apps expect).
  return lines.join('\r\n') + '\r\n';
}
