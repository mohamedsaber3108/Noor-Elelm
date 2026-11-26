"use client";
import { useEffect, useState } from 'react';
import Link from '@/components/full-page-link';

// Each text has an Arabic and an English line. The page stays right-to-left; the English line is left-to-right.
function T({ ar, en }: { ar: string; en: string }) {
  return <><span lang="ar" dir="rtl">{ar}</span><br /><small lang="en" dir="ltr" style={{ display: 'block' }}>{en}</small></>;
}

const ERRORS: Record<string, [string, string]> = {
  INVALID_INPUT: ['راجع المدخلات. كلمة المرور 10 أحرف على الأقل.', 'Check your input. The password needs at least 10 characters.'],
  INVALID_OR_EXPIRED_TOKEN: ['الرابط غير صالح أو انتهت مدته أو استُخدم من قبل. اطلب رابطًا جديدًا.', 'This link is not valid, has expired or was already used. Ask for a new one.'],
  RATE_LIMITED: ['محاولات كثيرة. انتظر ساعة ثم حاول مرة أخرى.', 'Too many tries. Wait an hour and try again.'],
  BAD_ORIGIN: ['تعذر التحقق من مصدر الطلب. أعد تحميل الصفحة.', 'The request origin could not be checked. Reload the page.'],
  DATABASE_UNAVAILABLE: ['الخدمة غير متاحة مؤقتًا. حاول لاحقًا.', 'The service is unavailable. Try again later.'],
};
const FALLBACK: [string, string] = ['تعذر إكمال الطلب. حاول مرة أخرى.', 'The request could not be completed. Try again.'];
const NETWORK: [string, string] = ['تعذر الاتصال بالخادم. تحقق من الشبكة.', 'Could not reach the server. Check your network.'];

async function post(path: string, body: unknown): Promise<{ ok: boolean; error?: string; network?: boolean }> {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return { ok: true };
    const d = await r.json().catch(() => ({})) as { error?: string };
    return { ok: false, error: d.error };
  } catch { return { ok: false, network: true }; }
}
const errText = (r: { error?: string; network?: boolean }) => r.network ? NETWORK : ERRORS[r.error || ''] || FALLBACK;

/** The token travels in the URL fragment: it is not sent to the server, to referrers or into logs. */
function readFragmentToken(): string {
  const m = /(?:^#|&)t=([A-Za-z0-9_-]{1,128})/.exec(window.location.hash);
  if (m) window.history.replaceState(null, '', window.location.pathname);
  return m ? m[1] : '';
}

export function ForgotPage() {
  const [email, setEmail] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState(false), [error, setError] = useState<[string, string] | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const r = await post('/api/auth/password-reset/request', { email });
    setBusy(false);
    if (r.ok) setDone(true); else setError(errText(r));
  }
  return <main className="page-main"><div className="page-hero"><span className="eyebrow">حسابك</span><h1>نسيت كلمة المرور؟</h1><p lang="en" dir="ltr">Forgot your password?</p></div>
    <div className="correction-panel">{done
      ? <div role="status"><p><T ar="إن كان لهذا البريد حساب، فسنرسل إليه رابطًا لإعادة التعيين. الرابط صالح 30 دقيقة ويعمل مرة واحدة." en="If an account exists for this email, we will send it a reset link. The link is valid for 30 minutes and works once." /></p></div>
      : <form onSubmit={submit}>
        <label>البريد الإلكتروني <small lang="en" dir="ltr">Email</small><input required type="email" dir="ltr" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>
        {error && <p role="alert" className="error-note"><T ar={error[0]} en={error[1]} /></p>}
        <button className="btn-primary" disabled={busy}>{busy ? 'لحظة… / Wait…' : 'أرسل الرابط / Send link'}</button>
      </form>}
    <Link href="/login">العودة لتسجيل الدخول / Back to sign in</Link>
    </div></main>;
}

export function ResetPage() {
  const [token, setToken] = useState(''), [ready, setReady] = useState(false);
  const [password, setPassword] = useState(''), [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false), [done, setDone] = useState(false), [error, setError] = useState<[string, string] | null>(null);
  useEffect(() => { setToken(readFragmentToken()); setReady(true); }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const r = await post('/api/auth/password-reset/confirm', { token, password });
    setBusy(false);
    if (r.ok) { setDone(true); setPassword(''); } else setError(errText(r));
  }
  return <main className="page-main"><div className="page-hero"><span className="eyebrow">حسابك</span><h1>كلمة مرور جديدة.</h1><p lang="en" dir="ltr">Choose a new password.</p></div>
    <div className="correction-panel">{done
      ? <div role="status"><p><T ar="تم تغيير كلمة المرور وإنهاء كل الجلسات. سجّل الدخول بكلمة المرور الجديدة." en="Your password was changed and all sessions were ended. Sign in with the new password." /></p><Link href="/login">تسجيل الدخول / Sign in</Link></div>
      : ready && !token ? <div role="alert" className="error-note"><p><T ar="الرابط ناقص. افتح الرابط من الرسالة كاملًا، أو اطلب رابطًا جديدًا." en="The link is incomplete. Open the whole link from the email, or ask for a new one." /></p><Link href="/forgot">طلب رابط جديد / Ask for a new link</Link></div>
      : <form onSubmit={submit}>
        <label>كلمة المرور الجديدة <small lang="en" dir="ltr">New password</small><input required type={show ? 'text' : 'password'} dir="ltr" minLength={10} maxLength={200} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        <small>10 أحرف على الأقل / At least 10 characters.</small>
        <button type="button" className="btn-outline" aria-pressed={show} onClick={() => setShow(s => !s)}>{show ? 'إخفاء كلمة المرور / Hide password' : 'إظهار كلمة المرور / Show password'}</button>
        {error && <p role="alert" className="error-note"><T ar={error[0]} en={error[1]} /></p>}
        <button className="btn-primary" disabled={busy || !token}>{busy ? 'لحظة… / Wait…' : 'تغيير كلمة المرور / Change password'}</button>
      </form>}
    </div></main>;
}

export function VerifyEmailPage() {
  const [state, setState] = useState<'wait' | 'ok' | 'missing' | 'fail'>('wait'), [error, setError] = useState<[string, string]>(FALLBACK);
  const [token, setToken] = useState('');
  useEffect(() => { const t = readFragmentToken(); setToken(t); if (!t) setState('missing'); }, []);
  async function confirm() {
    const r = await post('/api/auth/verify-email/confirm', { token });
    if (r.ok) setState('ok'); else { setError(errText(r)); setState('fail'); }
  }
  return <main className="page-main"><div className="page-hero"><span className="eyebrow">حسابك</span><h1>تأكيد البريد الإلكتروني.</h1><p lang="en" dir="ltr">Confirm your email.</p></div>
    <div className="correction-panel">
      {state === 'ok' && <p role="status"><T ar="تم تأكيد بريدك الإلكتروني." en="Your email is confirmed." /></p>}
      {state === 'missing' && <p role="alert" className="error-note"><T ar="الرابط ناقص. افتح الرابط من الرسالة كاملًا." en="The link is incomplete. Open the whole link from the email." /></p>}
      {state === 'fail' && <p role="alert" className="error-note"><T ar={error[0]} en={error[1]} /></p>}
      {state === 'wait' && <button className="btn-primary" onClick={confirm} disabled={!token}>تأكيد البريد / Confirm email</button>}
      <Link href="/account">حسابي / My account</Link>
    </div></main>;
}

/** Small notice for signed-in users whose email is not confirmed yet. Nothing is blocked (OD-04b policy note). */
export function VerifyBanner() {
  const [show, setShow] = useState(false), [msg, setMsg] = useState<{ t: [string, string]; ok: boolean } | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch('/api/auth/session', { cache: 'no-store' }).then(r => r.json() as Promise<{ user: { emailVerified?: boolean; mfa?: string } | null }>)
      .then(d => setShow(!!d.user && d.user.emailVerified === false && !d.user.mfa)).catch(() => {});
  }, []);
  if (!show) return null;
  async function again() {
    setBusy(true);
    const r = await post('/api/auth/verify-email/request', {});
    setBusy(false);
    setMsg(r.ok ? { t: ['أرسلنا رسالة التأكيد إن كان البريد صالحًا.', 'We sent the confirmation email if the address is valid.'], ok: true } : { t: errText(r), ok: false });
  }
  return <div className="correction-panel" role="region" aria-label="تأكيد البريد / Email confirmation">
    <p><T ar="بريدك الإلكتروني غير مؤكَّد بعد. يمكنك متابعة استخدام الموقع." en="Your email is not confirmed yet. You can keep using the site." /></p>
    <button type="button" className="btn-outline" onClick={again} disabled={busy}>إرسال مرة أخرى / Send again</button>
    {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? '' : 'error-note'}><T ar={msg.t[0]} en={msg.t[1]} /></p>}
  </div>;
}
