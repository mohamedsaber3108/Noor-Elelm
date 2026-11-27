"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from '@/components/full-page-link';
import { AdminRequests } from '@/components/admin-requests';

type U = { id: string; email: string; name: string; role: string; createdAt: string; lastLoginAt: string | null; coins: number; suspendedAt: number | null; staffNote: string | null };
type Data = { users: U[]; total: number; page: number; pageSize: number; stats: Record<string, number | Record<string, number>> };
type Pending = { kind: 'role' | 'suspend' | 'reactivate'; id: string; name: string; role?: string };
const labels: [string, string][] = [
  ['users', 'المستخدمون'], ['newUsers7d', 'جدد (٧ أيام)'], ['activeUsers7d', 'نشطون (٧ أيام)'], ['activeSessions', 'جلسات نشطة'],
  ['quizAttempts', 'إجابات'], ['quizCorrect', 'إجابات صحيحة'], ['coinsIssued', 'نقاط ممنوحة'], ['bookmarks', 'مفضلات'],
  ['correctionReports', 'بلاغات تصحيح'], ['importedDrafts', 'مسودات مستوردة'], ['reviews', 'قرارات مراجعة'],
];
const roleNames: Record<string, string> = { learner: 'متعلّم', researcher: 'باحث', fact_checker: 'مدقق حقائق', language_editor: 'محرر لغوي', scholar: 'عالِم', publisher: 'ناشر', reviewer: 'مراجع', admin: 'مدير' };
const errorText: Record<string, string> = {
  LAST_ADMIN: 'لا يمكن إزالة آخر مدير.',
  SELF_RESET_REFUSED: 'لا يمكنك إعادة ضبط حسابك بنفسك.',
  SELF_SUSPEND_REFUSED: 'لا يمكنك إيقاف حسابك بنفسك.',
  ALREADY_SUSPENDED: 'هذا الحساب موقوف بالفعل.',
  NOT_SUSPENDED: 'هذا الحساب غير موقوف.',
  INVALID_NOTE: 'الملاحظة نص عادي حتى ١٠٠٠ حرف، بلا وسوم أو رموز تحكم.',
  STEP_UP_REQUIRED: 'اكتب كلمة المرور الخاصة بك للتأكيد.',
  STEP_UP_FAILED: 'كلمة المرور غير صحيحة.',
  REASON_REQUIRED: 'اكتب سببًا من ١٠ إلى ٣٠٠ حرف.',
  RATE_LIMITED: 'محاولات كثيرة. انتظر ١٥ دقيقة ثم حاول مرة أخرى.',
  REQUEST_PENDING: 'يوجد طلب ترقية معلّق لهذا المستخدم.',
};
const formTitle: Record<Pending['kind'], string> = { role: 'تأكيد تغيير الدور', suspend: 'تأكيد إيقاف الحساب', reactivate: 'تأكيد إعادة تفعيل الحساب' };

export function AdminUsers() {
  const [data, setData] = useState<Data | null>(null), [state, setState] = useState<'loading' | 'denied' | 'ok' | 'error'>('loading');
  const [q, setQ] = useState(''), [page, setPage] = useState(1), [msg, setMsg] = useState(''), [msgErr, setMsgErr] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null), [pw, setPw] = useState(''), [why, setWhy] = useState(''), [formErr, setFormErr] = useState(''), [sending, setSending] = useState(false);
  const selects = useRef<Record<string, HTMLSelectElement | null>>({});
  const suspendButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const [reqTick, setReqTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/users?' + new URLSearchParams({ q, page: String(page) }));
      if (r.status === 403 || r.status === 401) { setState('denied'); return; }
      if (!r.ok) throw Error();
      setData(await r.json() as Data); setState('ok');
    } catch { setState('error'); }
  }, [q, page]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  async function act(method: 'PUT' | 'DELETE', body: object, ok: string) {
    const r = await fetch('/api/admin/users', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({})) as { error?: string };
    setMsg(r.ok ? ok : (d.error && errorText[d.error]) || 'تعذر تنفيذ العملية.'); setMsgErr(!r.ok);
    if (r.ok) load();
    return r.ok;
  }

  function open(p: Pending) { setPending(p); setPw(''); setWhy(''); setMsg(''); setFormErr(''); }
  function closeForm(p: Pending) {
    setPending(null); setPw(''); setWhy(''); setFormErr('');
    requestAnimationFrame(() => (p.kind === 'role' ? selects.current[p.id] : suspendButtons.current[p.id])?.focus());
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!pending || sending) return;
    setSending(true); setFormErr('');
    const body = pending.kind === 'role'
      ? { id: pending.id, role: pending.role, password: pw, reason: why }
      : { id: pending.id, suspend: pending.kind === 'suspend', password: pw, reason: why };
    try {
      const r = await fetch('/api/admin/users', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({})) as { error?: string };
      setPw('');
      if (r.ok) {
        const done = pending.kind === 'role'
          ? (r.status === 202 ? 'أُرسل طلب الترقية إلى مدير. يحتاج موافقة مدير آخر.' : 'تم تحديث الدور.')
          : pending.kind === 'suspend' ? 'تم إيقاف الحساب وإنهاء جلساته.' : 'تمت إعادة تفعيل الحساب.';
        setMsg(done); setMsgErr(false); closeForm(pending); load(); setReqTick(t => t + 1);
      } else setFormErr((d.error && errorText[d.error]) || 'تعذر تنفيذ العملية.');
    } catch { setFormErr('تعذر الاتصال. حاول مرة أخرى.'); }
    finally { setSending(false); }
  }

  async function saveNote(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const note = String(new FormData(e.currentTarget).get('note') ?? '');
    await act('PUT', { id, note }, 'تم حفظ الملاحظة.');
  }

  if (state === 'denied') return <main className="page-main"><div className="page-hero"><h1>إدارة المستخدمين</h1></div><div className="empty-state">هذه الصفحة للمديرين فقط. <Link href="/login?return_to=%2Fadmin%2Fusers">تسجيل الدخول</Link></div></main>;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return <main className="page-main"><div className="page-hero"><span className="eyebrow">الإدارة</span><h1>المستخدمون والإحصاءات</h1><p>بيانات حقيقية من قاعدة البيانات. تغيير الدور وإيقاف الحساب يحتاجان كلمة مرورك وسببًا، ويُسجَّلان في سجل التدقيق.</p></div>
    <nav className="admin-nav" aria-label="أقسام الإدارة"><Link href="/admin">المراجعة</Link> · <Link href="/admin/corrections">البلاغات</Link> · <Link href="/admin/infographics">الإنفوجرافيك</Link> · <Link href="/admin/settings">الإعدادات</Link> · <Link href="/admin/audit">سجل التدقيق</Link> · <Link href="/admin/editorial">لوحة التحرير</Link></nav>
    {state === 'error' && <div role="alert" className="error-note">تعذر تحميل البيانات.</div>}
    {data && <div className="admin-stats">{labels.map(([k, l]) => <div key={k}><span>{l}</span><strong>{String(data.stats[k] ?? 0)}</strong></div>)}</div>}
    {msg && <p role={msgErr ? 'alert' : 'status'} className={msgErr ? 'error-note' : undefined}>{msg}</p>}
    {pending && <form className="correction-panel" aria-labelledby="stepup-title" onSubmit={confirm} onKeyDown={e => { if (e.key === 'Escape') closeForm(pending); }}>
      <h2 id="stepup-title">{formTitle[pending.kind]}</h2>
      <p><bdi>{pending.name}</bdi>{pending.kind === 'role' && <>: <strong>{roleNames[pending.role ?? ''] || pending.role}</strong></>}</p>
      {pending.kind === 'suspend' && <p>سيُنهى كل دخول لهذا الحساب، ولن يستطيع تسجيل الدخول حتى يُعاد تفعيل الحساب.</p>}
      <label>كلمة المرور الخاصة بك<input type="password" autoComplete="current-password" required maxLength={200} value={pw} onChange={e => setPw(e.target.value)} aria-describedby="stepup-error" autoFocus /></label>
      <p id="stepup-error" role="alert" className={formErr ? 'error-note' : undefined}>{formErr}</p>
      <label>السبب (١٠ إلى ٣٠٠ حرف)<textarea required minLength={10} maxLength={300} rows={3} value={why} onChange={e => setWhy(e.target.value)} aria-describedby="stepup-count" /></label>
      <small id="stepup-count">{why.trim().length.toLocaleString('ar-EG')} / ٣٠٠</small>
      <button className="btn-primary" disabled={sending || !pw || why.trim().length < 10}>{sending ? 'جار الإرسال…' : 'تأكيد'}</button> <button type="button" className="btn-outline" onClick={() => closeForm(pending)}>إلغاء</button>
    </form>}
    <AdminRequests refresh={reqTick} onDecided={load} />
    <label className="admin-search">بحث<input type="search" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="الاسم أو البريد" /></label>
    {data && <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>الحالة</th><th>النقاط</th><th>آخر دخول</th><th>إجراءات</th></tr></thead><tbody>
      {data.users.map(u => <tr key={u.id}><td><bdi>{u.name}</bdi></td><td dir="ltr">{u.email}</td>
        <td><select ref={el => { selects.current[u.id] = el; }} aria-label={'دور ' + u.name} value={pending?.kind === 'role' && pending.id === u.id ? pending.role : u.role} onChange={e => { if (e.target.value === u.role) setPending(null); else open({ kind: 'role', id: u.id, name: u.name, role: e.target.value }); }}>{Object.entries(roleNames).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></td>
        <td>{u.suspendedAt ? <strong>موقوف</strong> : 'نشط'}</td>
        <td>{u.coins}</td><td dir="ltr">{u.lastLoginAt?.slice(0, 16) ?? '—'}</td>
        <td>
          <button className="btn-outline" onClick={() => act('DELETE', { id: u.id }, 'تم إنهاء جلسات المستخدم.')}>إنهاء الجلسات</button>
          <button ref={el => { suspendButtons.current[u.id] = el; }} className="btn-outline" aria-label={(u.suspendedAt ? 'إعادة تفعيل حساب ' : 'إيقاف حساب ') + u.name} onClick={() => open({ kind: u.suspendedAt ? 'reactivate' : 'suspend', id: u.id, name: u.name })}>{u.suspendedAt ? 'إعادة التفعيل' : 'إيقاف'}</button>
          {u.role !== 'learner' && <button className="btn-outline" aria-label={'إعادة ضبط التحقق بخطوتين لـ ' + u.name} onClick={() => { if (window.confirm('إعادة ضبط التحقق بخطوتين لهذا المستخدم؟ سيُنهى دخوله ويُسجَّل الإجراء.')) act('PUT', { id: u.id, resetMfa: true }, 'تمت إعادة ضبط التحقق بخطوتين.'); }}>إعادة ضبط التحقق</button>}
          <details><summary>{u.staffNote ? 'ملاحظة الفريق' : 'إضافة ملاحظة'}</summary>
            <form onSubmit={e => saveNote(e, u.id)}>
              <label>ملاحظة للفريق فقط (لا يراها المستخدم)<textarea name="note" rows={3} maxLength={1000} defaultValue={u.staffNote ?? ''} /></label>
              <button className="btn-outline">حفظ الملاحظة</button>
            </form>
          </details>
        </td></tr>)}
      {data.users.length === 0 && <tr><td colSpan={7}>لا نتائج.</td></tr>}
    </tbody></table></div>}
    <div className="admin-pager"><button className="btn-outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>السابق</button><span>{page} / {pages}</span><button className="btn-outline" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>التالي</button></div>
  </main>;
}
