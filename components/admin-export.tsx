"use client";
import { useRef, useState } from 'react';

const errorText: Record<string, string> = {
  STEP_UP_REQUIRED: 'اكتب كلمة المرور الخاصة بك للتأكيد.',
  STEP_UP_FAILED: 'كلمة المرور غير صحيحة.',
  REASON_REQUIRED: 'اكتب سببًا من ١٠ إلى ٣٠٠ حرف.',
  RATE_LIMITED: 'محاولات كثيرة. انتظر ١٥ دقيقة ثم حاول مرة أخرى.',
  AUDIT_UNAVAILABLE: 'تعذر تسجيل العملية في سجل التدقيق، فلم يُصدَّر شيء.',
};

/** Export the user list as CSV (N-18b): own password and a reason, then the file downloads. */
export function AdminExport() {
  const [open, setOpen] = useState(false), [pw, setPw] = useState(''), [why, setWhy] = useState('');
  const [err, setErr] = useState(''), [msg, setMsg] = useState(''), [sending, setSending] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false); setPw(''); setWhy(''); setErr('');
    requestAnimationFrame(() => btn.current?.focus());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    setSending(true); setErr('');
    try {
      const r = await fetch('/api/admin/users/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw, reason: why }) });
      setPw('');
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { error?: string };
        setErr((d.error && errorText[d.error]) || 'تعذر التصدير.');
        return;
      }
      const blob = await r.blob();
      const name = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '')?.[1] || 'noor-users.csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg(r.headers.get('X-Export-Truncated')
        ? 'تم تنزيل أول ٥٠٬٠٠٠ مستخدم فقط.'
        : 'تم تنزيل الملف. فيه بيانات شخصية: احفظه في مكان آمن واحذفه بعد الاستخدام.');
      close();
    } catch { setErr('تعذر الاتصال. حاول مرة أخرى.'); }
    finally { setSending(false); }
  }

  return <section className="correction-panel" aria-labelledby="export-title">
    <h2 id="export-title">تصدير قائمة المستخدمين</h2>
    <p>ملف CSV بالبريد والاسم والدور والحالة والنقاط، بلا كلمات مرور ولا ملاحظات الفريق. يحتاج كلمة مرورك وسببًا، ويُسجَّل في سجل التدقيق.</p>
    {msg && <p role="status">{msg}</p>}
    {!open
      ? <button ref={btn} className="btn-outline" onClick={() => { setOpen(true); setMsg(''); }}>تصدير CSV</button>
      : <form aria-labelledby="export-form-title" onSubmit={submit} onKeyDown={e => { if (e.key === 'Escape') close(); }}>
        <h3 id="export-form-title">تأكيد التصدير</h3>
        <label>كلمة المرور الخاصة بك<input type="password" autoComplete="current-password" required maxLength={200} value={pw} onChange={e => setPw(e.target.value)} aria-describedby="export-error" autoFocus /></label>
        <p id="export-error" role="alert" className={err ? 'error-note' : undefined}>{err}</p>
        <label>السبب (١٠ إلى ٣٠٠ حرف)<textarea required minLength={10} maxLength={300} rows={3} value={why} onChange={e => setWhy(e.target.value)} aria-describedby="export-count" /></label>
        <small id="export-count">{why.trim().length.toLocaleString('ar-EG')} / ٣٠٠</small>
        <button className="btn-primary" disabled={sending || !pw || why.trim().length < 10}>{sending ? 'جار التصدير…' : 'تصدير'}</button>{' '}
        <button type="button" className="btn-outline" onClick={close}>إلغاء</button>
      </form>}
  </section>;
}
