"use client";
import { useCallback, useEffect, useState } from 'react';
import Link from '@/components/full-page-link';

type U = { id: string; email: string; name: string; role: string; createdAt: string; lastLoginAt: string | null; coins: number };
type Data = { users: U[]; total: number; page: number; pageSize: number; stats: Record<string, number | Record<string, number>> };
const labels: [string, string][] = [
  ['users', 'المستخدمون'], ['newUsers7d', 'جدد (٧ أيام)'], ['activeUsers7d', 'نشطون (٧ أيام)'], ['activeSessions', 'جلسات نشطة'],
  ['quizAttempts', 'إجابات'], ['quizCorrect', 'إجابات صحيحة'], ['coinsIssued', 'نقاط ممنوحة'], ['bookmarks', 'مفضلات'],
  ['correctionReports', 'بلاغات تصحيح'], ['importedDrafts', 'مسودات مستوردة'], ['reviews', 'قرارات مراجعة'],
];
const roleNames: Record<string, string> = { learner: 'متعلّم', reviewer: 'مراجع', admin: 'مدير' };

export function AdminUsers() {
  const [data, setData] = useState<Data | null>(null), [state, setState] = useState<'loading' | 'denied' | 'ok' | 'error'>('loading');
  const [q, setQ] = useState(''), [page, setPage] = useState(1), [msg, setMsg] = useState('');

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
    setMsg(r.ok ? ok : d.error === 'LAST_ADMIN' ? 'لا يمكن إزالة آخر مدير.' : d.error === 'SELF_RESET_REFUSED' ? 'لا يمكنك إعادة ضبط حسابك بنفسك.' : 'تعذر تنفيذ العملية.');
    if (r.ok) load();
  }

  if (state === 'denied') return <main className="page-main"><div className="page-hero"><h1>إدارة المستخدمين</h1></div><div className="empty-state">هذه الصفحة للمديرين فقط. <Link href="/login?return_to=%2Fadmin%2Fusers">تسجيل الدخول</Link></div></main>;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return <main className="page-main"><div className="page-hero"><span className="eyebrow">الإدارة</span><h1>المستخدمون والإحصاءات</h1><p>بيانات حقيقية من قاعدة البيانات. تغيير الدور يُسجَّل في سجل التدقيق.</p></div>
    <nav className="admin-nav"><Link href="/admin">المراجعة</Link> · <Link href="/admin/corrections">البلاغات</Link> · <Link href="/admin/infographics">الإنفوجرافيك</Link> · <Link href="/admin/settings">الإعدادات</Link></nav>
    {state === 'error' && <div role="alert" className="error-note">تعذر تحميل البيانات.</div>}
    {data && <div className="admin-stats">{labels.map(([k, l]) => <div key={k}><span>{l}</span><strong>{String(data.stats[k] ?? 0)}</strong></div>)}</div>}
    {msg && <p role="status">{msg}</p>}
    <label className="admin-search">بحث<input type="search" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="الاسم أو البريد" /></label>
    {data && <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>النقاط</th><th>آخر دخول</th><th>إجراءات</th></tr></thead><tbody>
      {data.users.map(u => <tr key={u.id}><td>{u.name}</td><td dir="ltr">{u.email}</td>
        <td><select aria-label={'دور ' + u.name} value={u.role} onChange={e => act('PUT', { id: u.id, role: e.target.value }, 'تم تحديث الدور.')}>{Object.entries(roleNames).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></td>
        <td>{u.coins}</td><td dir="ltr">{u.lastLoginAt?.slice(0, 16) ?? '—'}</td>
        <td><button className="btn-outline" onClick={() => act('DELETE', { id: u.id }, 'تم إنهاء جلسات المستخدم.')}>إنهاء الجلسات</button>{u.role !== 'learner' && <button className="btn-outline" aria-label={'إعادة ضبط التحقق بخطوتين لـ ' + u.name} onClick={() => { if (window.confirm('إعادة ضبط التحقق بخطوتين لهذا المستخدم؟ سيُنهى دخوله ويُسجَّل الإجراء.')) act('PUT', { id: u.id, resetMfa: true }, 'تمت إعادة ضبط التحقق بخطوتين.'); }}>إعادة ضبط التحقق</button>}</td></tr>)}
      {data.users.length === 0 && <tr><td colSpan={6}>لا نتائج.</td></tr>}
    </tbody></table></div>}
    <div className="admin-pager"><button className="btn-outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>السابق</button><span>{page} / {pages}</span><button className="btn-outline" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>التالي</button></div>
  </main>;
}
