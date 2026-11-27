/**
 * CSV for spreadsheet export (N-18b), RFC 4180 style: every cell quoted, quotes doubled, rows end with CRLF.
 * A cell that starts with = + - @ tab or carriage return gets a leading apostrophe, so a spreadsheet shows it
 * as text and never runs it as a formula (CSV injection).
 */
export function csvCell(v: string | number | null | undefined): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export const csvRow = (cells: readonly (string | number | null | undefined)[]): string => cells.map(csvCell).join(",");

/** Whole file: UTF-8 byte order mark (so spreadsheets read Arabic right), then rows joined with CRLF. */
export const csvFile = (rows: readonly string[]): string => "\uFEFF" + rows.join("\r\n") + "\r\n";
