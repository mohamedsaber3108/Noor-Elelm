import { useEffect, useState } from 'react';

/** Public site settings (N-17). Empty until the fetch answers, and empty if it fails: callers fall back to their built-in text. */
export function usePublicSettings(): Record<string, string | boolean> {
  const [s, setS] = useState<Record<string, string | boolean>>({});
  useEffect(() => {
    fetch('/api/settings').then(r => (r.ok ? r.json() : null)).then((d: { settings?: Record<string, string | boolean> } | null) => { if (d?.settings) setS(d.settings); }).catch(() => {});
  }, []);
  return s;
}

/** A text setting, or the fallback when it is missing or not a string. Always rendered as a text node, never as HTML. */
export const textOr = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback);
