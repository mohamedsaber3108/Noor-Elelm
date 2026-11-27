"use client";
import { useCallback, useEffect, useRef, useState } from 'react';

type R = {
  id: string; target_id: string; target_name: string | null; target_email: string | null;
  requested_by: string; requested_by_name: string | null; reason: string; created_at: number; expires_at: number;
};
const errorText: Record<string, string> = {
  STEP_UP_REQUIRED: 'اكتب كلمة المرور الخاصة بك للتأكيد.',
  STEP_UP_FAILED: 'كلمة المرور غير صحيحة.',
  REASON_REQUIRED: 'اكتب سببًا من ١٠ إلى ٣٠٠ حرف.',
  RATE_LIMITED: 'محاولات كثيرة. انتظر ١٥ دقيقة ثم حاول مرة أخرى.',
  SELF_APPROVAL_REFUSED: 'لا يمكنك الموافقة على طلب قدّمته بنفسك. يحتاج مديرًا آخر.',
  REQUEST_CLOSED: 'هذا الطلب أُغلق أو انتهت مدته.',
  NOT_FOUND: 'الطلب غير موجود.',
};
const time = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

/** Open admin promotion requests (N-15c). A different admin approves or rejects with password and reason. */
export function AdminRequests({ refresh, onDecided }: { refresh: number; onDecided: () => void }) {
  const [rows, setRows] = useState<R[] | null>(null), [me, setMe] = useState('');
  const [open, setOpen] = useState<{ id: string; decision: 'APPROVE' | 'REJECT'; name: string } | null>(null);
  const [pw, setPw] = useState(''), [why, setWhy] = useState(''), [err, setErr] = useState(''), [msg, setMsg] = useState(''), [sending, setSending] = useState(false);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/admin-requests').catch(() => null);
    if (!r?.ok) { setRows(null); return; }
    const d = await r.json() as { requests: R[]; me: string };
    setRows(d.requests); setMe(d.me);
  }, []);
  useEffect(() => { load(); }, [load, refresh]);

  function close(id: string) {
    setOpen(null); setPw(''); setWhy(''); setErr('');
    requestAnimationFrame(() => buttons.current[id]?.focus());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!open || sending) return;
    setSending(true); setErr('');
    try {
      const r = await fetch('/api/admin/admin-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: open.id, decision: open.decision, password: pw, reason: why }) });
      const d = await r.json().catch(() => ({})) as { error?: string };
      setPw('');
      if (r.ok) { setMsg(open.decision === 'APPROVE' ? 'تمت الموافقة. أصبح المستخدم مديرًا.' : 'تم رفض الطلب.'); setOpen(null); setWhy(''); load(); onDecided(); }
      else setErr((d.error && errorText[d.error]) || 'تعذر تنفيذ العملية.');
    } catch { setErr('تعذر الاتصال. حاول مرة أخرى.'); }
    finally { setSending(false); }
  }

  if (!rows || (rows.length === 0 && !msg)) return null;
  return <section className="correction-panel" aria-labelledby="req-title">
    <h2 id="req-title">طلبات الترقية إلى مدير</h2>
    {msg && <p role="status">{msg}</p>}
    {rows.length === 0 ? <p>لا طلبات معلّقة.</p> : <ul>{rows.map(r => <li key={r.id}>
      <p><bdi>{r.target_name || r.target_email || r.target_id}</bdi> · طلبه: <bdi>{r.requested_by_name || r.requested_by}</bdi> · ينتهي: <bdi dir="ltr">{time(r.expires_at)} UTC</bdi></p>
      <p>السبب: <bdi>{r.reason}</bdi></p>
      {r.requested_by === me ? <p>بانتظار موافقة مدير آخر.</p> : <p>
        <button ref={el => { buttons.current[r.id] = el; }} className="btn-primary" onClick={() => { setOpen({ id: r.id, decision: 'APPROVE', name: r.target_name || r.target_id }); setMsg(''); }}>موافقة</button>{' '}
        <button className="btn-outline" onClick={() => { setOpen({ id: r.id, decision: 'REJECT', name: r.target_name || r.target_id }); setMsg(''); }}>رفض</button>
      </p>}
    </li>)}</ul>}
    {open && <form aria-labelledby="req-form-title" onSubmit={submit} onKeyDown={e => { if (e.key === 'Escape') close(open.id); }}>
      <h3 id="req-form-title">{open.decision === 'APPROVE' ? 'تأكيد الموافقة على ترقية' : 'تأكيد رفض ترقية'} <bdi>{open.name}</bdi></h3>
      <label>كلمة المرور الخاصة بك<input type="password" autoComplete="current-password" required maxLength={200} value={pw} onChange={e => setPw(e.target.value)} aria-describedby="req-error" autoFocus /></label>
      <p id="req-error" role="alert" className={err ? 'error-note' : undefined}>{err}</p>
      <label>السبب (١٠ إلى ٣٠٠ حرف)<textarea required minLength={10} maxLength={300} rows={3} value={why} onChange={e => setWhy(e.target.value)} /></label>
      <small>{why.trim().length.toLocaleString('ar-EG')} / ٣٠٠</small>
      <button className="btn-primary" disabled={sending || !pw || why.trim().length < 10}>{sending ? 'جار الإرسال…' : 'تأكيد'}</button>{' '}
      <button type="button" className="btn-outline" onClick={() => close(open.id)}>إلغاء</button>
    </form>}
  </section>;
}
