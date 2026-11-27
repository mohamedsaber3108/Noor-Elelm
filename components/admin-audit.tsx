"use client";
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Link from '@/components/full-page-link';

type Row = { seq: number | null; time: string | null; actorId: string; actorRole: string | null; action: string; target: string; result: string | null; source: string | null; reason: string | null; detail: string; detailCut: boolean };
type Cursor = { before?: number; beforeOld?: number };
type Data = { rows: Row[]; pageSize: number; next: Cursor | null; chain?: { ok: boolean; brokenAt: number | null; checked: number; skipped: number } };
type Filters = { action: string; actor: string; target: string; result: string; from: string; to: string; verify: boolean };
const EMPTY: Filters = { action: '', actor: '', target: '', result: '', from: '', to: '', verify: false };

/** Arabic and English as two separate spans, each with its own lang and dir. */
const Bi = ({ ar, en }: { ar: string; en: string }) => <><span lang="ar" dir="rtl">{ar}</span>{' '}<span lang="en" dir="ltr">{en}</span></>;
const Line = ({ children }: { children: ReactNode }) => <div>{children}</div>;

// datetime-local gives a time in the viewer's zone; the API wants UTC.
const toUtc = (local: string) => { const d = new Date(local); return Number.isNaN(d.getTime()) ? '' : d.toISOString(); };

export function AdminAudit() {
  const [draft, setDraft] = useState<Filters>(EMPTY), [applied, setApplied] = useState<Filters>(EMPTY);
  const [stack, setStack] = useState<Cursor[]>([{}]); // cursors of the pages already shown; the last one is the page on screen
  const [data, setData] = useState<Data | null>(null), [state, setState] = useState<'loading' | 'denied' | 'ok' | 'error' | 'badinput'>('loading');

  const cursor = stack[stack.length - 1];
  const load = useCallback(async () => {
    setState('loading');
    const p = new URLSearchParams();
    for (const k of ['action', 'actor', 'target', 'result'] as const) if (applied[k]) p.set(k, applied[k]);
    if (applied.from) p.set('from', toUtc(applied.from));
    if (applied.to) p.set('to', toUtc(applied.to));
    if (applied.verify) p.set('verify', '1');
    if (cursor.before !== undefined) p.set('before', String(cursor.before));
    if (cursor.beforeOld !== undefined) p.set('beforeOld', String(cursor.beforeOld));
    try {
      const r = await fetch('/api/admin/audit?' + p, { cache: 'no-store' });
      if (r.status === 403 || r.status === 401) { setState('denied'); return; }
      if (r.status === 400) { setState('badinput'); return; }
      if (!r.ok) throw Error();
      setData(await r.json() as Data); setState('ok');
    } catch { setState('error'); }
  }, [applied, cursor]);
  useEffect(() => { load(); }, [load]);

  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setDraft(d => ({ ...d, [k]: e.target.value }));
  const apply = (e: React.FormEvent) => { e.preventDefault(); setApplied(draft); setStack([{}]); };

  const nav = <nav className="admin-nav"><Link href="/admin"><Bi ar="المراجعة" en="Review" /></Link> · <Link href="/admin/users"><Bi ar="المستخدمون" en="Users" /></Link> · <Link href="/admin/corrections"><Bi ar="البلاغات" en="Corrections" /></Link></nav>;
  if (state === 'denied') return <main className="page-main"><div className="page-hero"><h1><Bi ar="سجل التدقيق" en="Audit log" /></h1></div><div className="empty-state"><Bi ar="هذه الصفحة للمديرين فقط." en="This page is for admins only." /> <Link href="/login?return_to=%2Fadmin%2Faudit"><Bi ar="تسجيل الدخول" en="Sign in" /></Link></div></main>;

  const text = (ar: string, en: string, role: 'status' | 'alert' = 'status') => <p role={role}><Bi ar={ar} en={en} /></p>;
  return <main className="page-main">
    <div className="page-hero"><span className="eyebrow"><Bi ar="الإدارة" en="Administration" /></span><h1><Bi ar="سجل التدقيق" en="Audit log" /></h1>
      <p><span lang="ar" dir="rtl">قراءة فقط. الأحدث أولًا. لا يمكن تعديل أي صف أو حذفه.</span>{' '}<span lang="en" dir="ltr">Read only. Newest first. No row can be edited or deleted.</span></p>
      <p><span lang="ar" dir="rtl">التصدير غير متاح: يحتاج تأكيد كلمة المرور من جديد، وهذا لم يُبنَ بعد.</span>{' '}<span lang="en" dir="ltr">Export is not available: it needs a password re-check, which is not built yet.</span></p></div>
    {nav}
    <form onSubmit={apply} aria-label="Filters" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, margin: '16px 0' }}>
      <label className="admin-search"><Bi ar="الإجراء" en="Action" /><input name="action" value={draft.action} onChange={set('action')} maxLength={64} dir="ltr" placeholder="ROLE_CHANGED" /></label>
      <label className="admin-search"><Bi ar="معرّف المنفّذ" en="Actor id" /><input name="actor" value={draft.actor} onChange={set('actor')} maxLength={64} dir="ltr" /></label>
      <label className="admin-search"><Bi ar="الهدف" en="Target" /><input name="target" value={draft.target} onChange={set('target')} maxLength={128} dir="ltr" /></label>
      <label className="admin-search"><Bi ar="النتيجة" en="Result" />
        <select name="result" value={draft.result} onChange={set('result')}>
          <option value="">— (all)</option><option value="success">success</option><option value="denied">denied</option><option value="failed">failed</option>
        </select></label>
      <label className="admin-search"><Bi ar="من (وقتك المحلي)" en="From (your local time)" /><input type="datetime-local" name="from" value={draft.from} onChange={set('from')} /></label>
      <label className="admin-search"><Bi ar="إلى (وقتك المحلي)" en="To (your local time)" /><input type="datetime-local" name="to" value={draft.to} onChange={set('to')} /></label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={draft.verify} onChange={e => setDraft(d => ({ ...d, verify: e.target.checked }))} /><Bi ar="افحص سلسلة التجزئة" en="Check the hash chain" /></label>
      <div style={{ display: 'flex', gap: 10, alignItems: 'end' }}>
        <button type="submit" className="btn-primary"><Bi ar="تطبيق" en="Apply" /></button>
        <button type="button" className="btn-outline" onClick={() => { setDraft(EMPTY); setApplied(EMPTY); setStack([{}]); }}><Bi ar="مسح" en="Clear" /></button>
      </div>
    </form>

    {state === 'loading' && text('جارٍ التحميل…', 'Loading…')}
    {state === 'error' && text('تعذر تحميل السجل.', 'Could not load the log.', 'alert')}
    {state === 'badinput' && text('إحدى قيم التصفية غير صالحة.', 'One filter value is not valid.', 'alert')}
    {state === 'ok' && data?.chain && text(
      data.chain.ok ? `السلسلة سليمة. ${data.chain.checked} صفًا فُحص، و${data.chain.skipped} قديمًا بلا تسلسل.` : `السلسلة مكسورة عند الرقم ${data.chain.brokenAt}.`,
      data.chain.ok ? `The chain is intact. ${data.chain.checked} rows checked, ${data.chain.skipped} old rows without a sequence number.` : `The chain is broken at number ${data.chain.brokenAt}.`,
      data.chain.ok ? 'status' : 'alert')}

    {data && <div className="admin-table-wrap"><table className="admin-table" aria-busy={state === 'loading'}>
      <caption className="visually-hidden" style={{ position: 'absolute', left: -9999 }}>Audit log</caption>
      <thead><tr>
        <th scope="col">#</th><th scope="col"><Bi ar="الوقت" en="Time" /></th><th scope="col"><Bi ar="المنفّذ" en="Actor" /></th><th scope="col"><Bi ar="الإجراء" en="Action" /></th>
        <th scope="col"><Bi ar="الهدف" en="Target" /></th><th scope="col"><Bi ar="النتيجة" en="Result" /></th><th scope="col"><Bi ar="المصدر" en="Source" /></th><th scope="col"><Bi ar="السبب والتفاصيل" en="Reason and detail" /></th>
      </tr></thead>
      <tbody>
        {data.rows.map((r, i) => <tr key={(r.seq ?? 'old') + ':' + i}>
          <td dir="ltr">{r.seq ?? '—'}</td>
          <td dir="ltr">{r.time ? <><time dateTime={r.time} title={'UTC ' + r.time}>{new Date(r.time).toLocaleString()}</time><Line><small>UTC {r.time.replace('T', ' ').replace('Z', '')}</small></Line></> : '—'}</td>
          <td dir="ltr">{r.actorId}<Line><small>{r.actorRole ?? '—'}</small></Line></td>
          <td dir="ltr">{r.action}</td>
          <td dir="ltr">{r.target}</td>
          <td dir="ltr">{r.result ?? '—'}</td>
          <td dir="ltr">{r.source ?? '—'}</td>
          <td dir="ltr">{r.reason && <Line>{r.reason}</Line>}<code>{r.detail}</code>{r.detailCut && <small> (cut at 500)</small>}</td>
        </tr>)}
        {data.rows.length === 0 && <tr><td colSpan={8}><Bi ar="لا نتائج." en="No rows." /></td></tr>}
      </tbody></table></div>}

    <div className="admin-pager">
      <button type="button" className="btn-outline" disabled={stack.length <= 1 || state === 'loading'} onClick={() => setStack(s => s.slice(0, -1))}><Bi ar="الأحدث" en="Newer" /></button>
      <span role="status"><Bi ar="الصفحة" en="Page" /> {stack.length}</span>
      <button type="button" className="btn-outline" disabled={!data?.next || state === 'loading'} onClick={() => data?.next && setStack(s => [...s, data.next as Cursor])}><Bi ar="الأقدم" en="Older" /></button>
    </div>
  </main>;
}
