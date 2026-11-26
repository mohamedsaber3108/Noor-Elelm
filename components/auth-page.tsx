"use client";
import { useEffect, useState } from 'react';
import Link from '@/components/full-page-link';

// One source for the closed notice (page state and the refused-request path).
const CLOSED_AR = 'التسجيل مغلق مؤقتًا. يمكن لأصحاب الحسابات الحالية تسجيل الدخول.';
const CLOSED_EN = 'Registration is temporarily closed. Existing account holders can still sign in.';

const messages: Record<string, string> = {
  INVALID_CREDENTIALS: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  EMAIL_TAKEN: 'هذا البريد مسجّل من قبل. جرّب تسجيل الدخول.',
  RATE_LIMITED: 'محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.',
  INVALID_INPUT: 'راجع المدخلات: كلمة المرور 10 أحرف على الأقل والاسم حرفان على الأقل.',
  DATABASE_UNAVAILABLE: 'الخدمة غير متاحة مؤقتًا. حاول لاحقًا.',
  REGISTRATION_CLOSED: CLOSED_AR,
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
      if (!r.ok) { const d = await r.json().catch(() => ({})) as { error?: string }; if (d.error === 'REGISTRATION_CLOSED') { setRegOpen(false); return; } setError(messages[d.error || ''] || 'تعذر إكمال الطلب. حاول مرة أخرى.'); return; }
      const d = await r.json().catch(() => ({})) as { mfa?: string };
      // Staff finish MFA first; nothing else works for them until then.
      window.location.assign(d.mfa === 'required' ? '/mfa?return_to=' + encodeURIComponent(returnTarget()) : returnTarget());
    } catch { setError('تعذر الاتصال بالخادم. تحقق من الشبكة وحاول مرة أخرى.'); } finally { setBusy(false); }
  }
  const [search, setSearch] = useState('');
  useEffect(() => { setSearch(window.location.search); }, []);
  // null while unknown: the register form stays hidden. A failed fetch counts as closed. The server refuses sign-up anyway when closed.
  const [regOpen, setRegOpen] = useState<boolean | null>(null);
  useEffect(() => {
    if (!register) return;
    fetch('/api/auth/session', { cache: 'no-store' }).then(r => r.json()).then((d: { registrationOpen?: boolean }) => setRegOpen(d.registrationOpen !== false)).catch(() => setRegOpen(false));
  }, [register]);
  const closed = register && regOpen === false;
  const pending = register && regOpen === null;
  const invite = register && regOpen === true;
  return <main className="page-main"><div className="page-hero"><span className="eyebrow">حسابك</span><h1>{invite ? 'أنشئ حسابًا.' : register ? 'حسابك.' : 'سجّل الدخول.'}</h1><p>{invite ? 'احفظ تقدمك ومفضلتك ونقاط التجربة.' : register ? 'يمكن لأصحاب الحسابات الحالية تسجيل الدخول.' : 'تابع من حيث توقفت.'}</p></div>
    <div className="correction-panel">{closed ? <div role="status" className="error-note"><p lang="ar" dir="rtl">{CLOSED_AR}</p><p lang="en" dir="ltr">{CLOSED_EN}</p></div> : pending ? null : <form onSubmit={submit}>
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
