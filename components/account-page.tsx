"use client";
import { useEffect, useState } from 'react';
import Link from '@/components/full-page-link';
import { VerifyBanner } from '@/components/reset-pages';

type Account = { name: string; email: string; role: string; createdAt: string | null; activeSessions: number };
const errors: Record<string, string> = {
  INVALID_CREDENTIALS: 'كلمة المرور الحالية غير صحيحة.',
  INVALID_INPUT: 'راجع المدخلات: كلمة المرور الجديدة 10 أحرف على الأقل.',
  RATE_LIMITED: 'محاولات كثيرة. انتظر قليلًا.',
  LAST_ADMIN: 'لا يمكن حذف آخر مدير للنظام.',
};
const roleNames: Record<string, string> = { learner: 'متعلّم', reviewer: 'مراجع', admin: 'مدير' };

async function call(method: string, body: unknown) {
  const r = await fetch('/api/account', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({})) as { error?: string };
  return { ok: r.ok, error: d.error };
}

export function AccountPage() {
  const [acc, setAcc] = useState<Account | null>(null), [loading, setLoading] = useState(true);
  const [name, setName] = useState(''), [cur, setCur] = useState(''), [next, setNext] = useState(''), [del, setDel] = useState('');
  const [msg, setMsg] = useState<{ k: string; ok: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    fetch('/api/account').then(r => r.ok ? r.json() as Promise<Account> : null).then(d => { setAcc(d); if (d) setName(d.name); }).finally(() => setLoading(false));
  }, []);

  const say = (text: string, ok: boolean) => setMsg({ k: text, ok });
  async function rename(e: React.FormEvent) {
    e.preventDefault();
    const r = await call('PATCH', { name });
    say(r.ok ? 'تم حفظ الاسم.' : errors[r.error || ''] || 'تعذر حفظ الاسم.', r.ok);
    if (r.ok) setAcc(a => a && { ...a, name: name.trim() });
  }
  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    const r = await call('POST', { current: cur, next });
    say(r.ok ? 'تم تغيير كلمة المرور وإنهاء الجلسات الأخرى.' : errors[r.error || ''] || 'تعذر تغيير كلمة المرور.', r.ok);
    if (r.ok) { setCur(''); setNext(''); }
  }
  async function remove(e: React.FormEvent) {
    e.preventDefault();
    const r = await call('DELETE', { password: del });
    if (r.ok) { window.location.assign('/'); return; }
    say(errors[r.error || ''] || 'تعذر حذف الحساب.', false);
  }

  if (loading) return <main className="page-main"><div className="page-hero"><h1>حسابي</h1><p>جار التحميل…</p></div></main>;
  if (!acc) return <main className="page-main"><div className="page-hero"><h1>حسابي</h1></div><div className="empty-state">سجّل الدخول لإدارة حسابك. <Link href="/login?return_to=%2Faccount">تسجيل الدخول</Link></div></main>;
  const admin = acc.role === 'admin';
  return <main className="page-main"><div className="page-hero"><span className="eyebrow">حسابك</span><h1>{acc.name}</h1><p dir="ltr" style={{ textAlign: 'right' }}>{acc.email}</p></div>
    <VerifyBanner />
    <div className="correction-panel">
      <p>الدور: <strong>{roleNames[acc.role] || acc.role}</strong> · الجلسات النشطة: <strong>{acc.activeSessions}</strong></p>
      {acc.role !== 'learner' && <p><Link href="/admin">لوحة المراجعة</Link>{admin && <> · <Link href="/admin/users">إدارة المستخدمين والإحصاءات</Link></>}</p>}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? '' : 'error-note'}>{msg.k}</p>}
      <h2>الاسم</h2>
      <form onSubmit={rename}><label>الاسم المعروض<input required minLength={2} maxLength={60} value={name} onChange={e => setName(e.target.value)} /></label><button className="btn-primary">حفظ</button></form>
      <h2>تغيير كلمة المرور</h2>
      <form onSubmit={changePassword}>
        <label>كلمة المرور الحالية<input required type="password" dir="ltr" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} /></label>
        <label>كلمة المرور الجديدة<input required minLength={10} maxLength={200} type="password" dir="ltr" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} /></label>
        <button className="btn-primary">تغيير</button>
      </form>
      <h2>حذف الحساب</h2>
      <p>يحذف الحساب نهائيًا مع المفضلة والتقدم والنقاط وسجل الإجابات. لا يمكن التراجع.</p>
      {!confirmDelete ? <button className="btn-outline" onClick={() => setConfirmDelete(true)}>حذف حسابي…</button> :
        <form onSubmit={remove}><label>أدخل كلمة المرور للتأكيد<input required type="password" dir="ltr" autoComplete="current-password" value={del} onChange={e => setDel(e.target.value)} /></label><button className="btn-primary">حذف نهائيًا</button></form>}
    </div></main>;
}
