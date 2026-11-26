"use client";
import { useEffect, useState } from 'react';
import Link from '@/components/full-page-link';

const messages: Record<string, string> = {
  INVALID_CREDENTIALS: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  EMAIL_TAKEN: 'هذا البريد مسجّل من قبل. جرّب تسجيل الدخول.',
  RATE_LIMITED: 'محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.',
  INVALID_INPUT: 'راجع المدخلات: كلمة المرور 10 أحرف على الأقل والاسم حرفان على الأقل.',
  DATABASE_UNAVAILABLE: 'الخدمة غير متاحة مؤقتًا. حاول لاحقًا.',
  REGISTRATION_CLOSED: 'التسجيل مغلق مؤقتًا. يمكن لأصحاب الحسابات الحالية تسجيل الدخول.',
  BAD_ORIGIN: 'تعذر التحقق من مصدر الطلب. أعد تحميل الصفحة.',
};

function returnTarget() {
  const v = new URLSearchParams(window.location.search).get('return_to') || '/dashboard';
  return v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') && !/^\/(login|register)/.test(v) ? v : '/dashboard';
}

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const register = mode === 'register';
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await fetch('/api/auth/' + mode, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(register ? { name, email, password } : { email, password }) });
      if (!r.ok) { const d = await r.json().catch(() => ({})) as { error?: string }; setError(messages[d.error || ''] || 'تعذر إكمال الطلب. حاول مرة أخرى.'); return; }
      const d = await r.json().catch(() => ({})) as { mfa?: string };
      // Staff finish MFA first; nothing else works for them until then.
      window.location.assign(d.mfa === 'required' ? '/mfa?return_to=' + encodeURIComponent(returnTarget()) : returnTarget());
    } catch { setError('تعذر الاتصال بالخادم. تحقق من الشبكة وحاول مرة أخرى.'); } finally { setBusy(false); }
  }
  const [search, setSearch] = useState('');
  useEffect(() => { setSearch(window.location.search); }, []);
  // null while unknown: the form stays visible. The server refuses sign-up anyway when closed.
  const [regOpen, setRegOpen] = useState<boolean | null>(null);
  useEffect(() => {
    if (!register) return;
    fetch('/api/auth/session', { cache: 'no-store' }).then(r => r.json()).then((d: { registrationOpen?: boolean }) => setRegOpen(d.registrationOpen !== false)).catch(() => {});
  }, [register]);
  const closed = register && regOpen === false;
  return <main className="page-main"><div className="page-hero"><span className="eyebrow">حسابك</span><h1>{register ? 'أنشئ حسابًا.' : 'سجّل الدخول.'}</h1><p>{register ? 'احفظ تقدمك ومفضلتك ونقاط التجربة.' : 'تابع من حيث توقفت.'}</p></div>
    <div className="correction-panel">{closed ? <div role="status" className="error-note"><p lang="ar" dir="rtl">التسجيل مغلق مؤقتًا. يمكن لأصحاب الحسابات الحالية تسجيل الدخول.</p><p lang="en" dir="ltr">Registration is temporarily closed. Existing account holders can still sign in.</p></div> : <form onSubmit={submit}>
      {register && <label>الاسم<input required minLength={2} maxLength={60} autoComplete="name" value={name} onChange={e => setName(e.target.value)} /></label>}
      <label>البريد الإلكتروني<input required type="email" dir="ltr" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>كلمة المرور<input required type="password" dir="ltr" minLength={register ? 10 : 1} maxLength={200} autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} /></label>
      {register && <small>10 أحرف على الأقل.</small>}
      {error && <p role="alert" className="error-note">{error}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? 'لحظة…' : register ? 'إنشاء الحساب' : 'دخول'}</button>
    </form>}
    {register ? <Link href={'/login' + search}>لدي حساب. تسجيل الدخول</Link> : <Link href={'/register' + search}>ليس لدي حساب. إنشاء حساب</Link>}
    </div></main>;
}
