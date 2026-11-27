/** Arabic-Indic (U+0660-0669) and Persian (U+06F0-06F9) digits to 0-9. Other characters are left as they are. */
export function normalizeDigits(s: string): string {
  return s.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, c => String(c.charCodeAt(0) >= 0x06F0 ? c.charCodeAt(0) - 0x06F0 : c.charCodeAt(0) - 0x0660));
}
