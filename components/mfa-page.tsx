"use client";
import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Link from '@/components/full-page-link';
import { normalizeDigits } from '@/lib/digits';

type Step = 'loading' | 'signin' | 'notneeded' | 'enroll' | 'verify' | 'recover' | 'codes' | 'unconfigured' | 'failed';

// Arabic first, English under it. No religious text appears on this page.
const messages: Record<string, [string, string]> = {
  MFA_INVALID_CODE: ['الرمز غير صحيح. جرّب الرمز الحالي من التطبيق.', 'The code is not correct. Try the current code from the app.'],
  RATE_LIMITED: ['محاولات كثيرة. انتظر ١٥ دقيقة ثم حاول مرة أخرى.', 'Too many tries. Wait 15 minutes and try again.'],
  MFA_NOT_CONFIGURED: ['التحقق بخطوتين غير مُفعّل على الخادم. تواصل مع مالك الموقع.', 'Two-step sign-in is not set up on the server. Contact the site owner.'],
  BAD_ORIGIN: ['تعذر التحقق من مصدر الطلب. أعد تحميل الصفحة.', 'Could not check where the request came from. Reload the page.'],
  MFA_NOT_ENROLLED: ['لم يتم إعداد التحقق بخطوتين لحسابك بعد. أعد تحميل الصفحة وابدأ الإعداد.', 'Two-step sign-in is not set up for your account yet. Reload the page and start setup.'],
  MFA_SECRET_UNREADABLE: ['تعذر قراءة مفتاح التحقق المحفوظ لحسابك. تواصل مع مالك الموقع.', 'The saved key for your account cannot be read. Contact the site owner.'],
  SIGN_IN_REQUIRED: ['انتهت الجلسة. سجّل الدخول من جديد.', 'Your session ended. Sign in again.'],
};
const generic: [string, string] = ['تعذر إكمال الطلب. حاول مرة أخرى.', 'Could not finish the request. Try again.'];

function returnTarget() {
  const v = new URLSearchParams(window.location.search).get('return_to') || '/admin';
  return v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') && !/^\/(login|register|mfa)/.test(v) ? v : '/admin';
}

const Bi = ({ ar, en }: { ar: string; en: string }) => <><span lang="ar" dir="rtl">{ar}</span><br /><span lang="en" dir="ltr">{en}</span></>;

export function MfaPage() {
  const [step, setStep] = useState<Step>('loading');
  const [secret, setSecret] = useState(''), [uri, setUri] = useState('');
  const [code, setCode] = useState(''), [error, setError] = useState<string>(''), [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[]>([]), [saved, setSaved] = useState(false), [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null), heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await (await fetch('/api/auth/session', { cache: 'no-store' })).json() as { user: { mfa?: string } | null };
        if (!s.user) return setStep('signin');
        if (s.user.mfa !== 'required') return setStep('notneeded');
        const r = await fetch('/api/auth/mfa/enroll', { method: 'POST' });
        const d = await r.json().catch(() => ({})) as { secret?: string; otpauth?: string; error?: string };
        if (r.ok && d.secret && d.otpauth) { setSecret(d.secret); setUri(d.otpauth); return setStep('enroll'); }
        if (d.error === 'MFA_ALREADY_ENROLLED') return setStep('verify');
        if (d.error === 'MFA_NOT_CONFIGURED') return setStep('unconfigured');
        if (d.error === 'MFA_SECRET_UNREADABLE') { setError(d.error); return setStep('failed'); }
        setStep('failed');
      } catch { setStep('failed'); }
    })();
  }, []);

  // Move focus to the code field (or the heading on the recovery-codes step) whenever the step changes.
  useEffect(() => {
    if (step === 'codes') heading.current?.focus(); else if (step === 'enroll' || step === 'verify' || step === 'recover') input.current?.focus();
  }, [step]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await fetch(step === 'recover' ? '/api/auth/mfa/recover' : '/api/auth/mfa/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const d = await r.json().catch(() => ({})) as { error?: string; recoveryCodes?: string[] };
      if (!r.ok) { setError(d.error || 'X'); setCode(''); input.current?.focus(); return; }
      if (d.recoveryCodes) { setCodes(d.recoveryCodes); setStep('codes'); return; }
      window.location.assign(returnTarget());
    } catch { setError('X'); } finally { setBusy(false); }
  }

  const shown = error ? messages[error] || generic : null;
  const status = shown && <p role="alert" className="error-note"><Bi ar={shown[0]} en={shown[1]} /></p>;
  const title = <div className="page-hero"><span className="eyebrow">حسابك · Your account</span><h1 ref={heading} tabIndex={-1}>التحقق بخطوتين</h1><p lang="en" dir="ltr">Two-step sign-in for reviewers and admins.</p></div>;

  if (step === 'loading') return <main className="page-main">{title}<p role="status"><Bi ar="جارٍ التحميل…" en="Loading…" /></p></main>;
  if (step === 'signin') return <main className="page-main">{title}<p><Link href="/login?return_to=%2Fmfa">سجّل الدخول · Sign in</Link></p></main>;
  if (step === 'notneeded') return <main className="page-main">{title}<p><Bi ar="حسابك لا يحتاج هذه الخطوة." en="Your account does not need this step." /></p><Link href="/">الرئيسية · Home</Link></main>;
  if (step === 'unconfigured' || step === 'failed') {
    const m = step === 'unconfigured' ? messages.MFA_NOT_CONFIGURED : messages[error] || generic;
    return <main className="page-main">{title}<p role="alert" className="error-note"><Bi ar={m[0]} en={m[1]} /></p></main>;
  }

  if (step === 'codes') return <main className="page-main">{title}<div className="correction-panel">
    <h2>رموز الاسترداد · Recovery codes</h2>
    <p><Bi ar="احفظ هذه الرموز الآن. لن تظهر مرة أخرى. كل رمز يُستعمل مرة واحدة إذا فقدت جهازك." en="Save these codes now. They are not shown again. Each works once if you lose your device." /></p>
    <ul dir="ltr" style={{ columns: 2, fontFamily: 'monospace', fontSize: 18, listStyle: 'none', padding: 0 }}>{codes.map(c => <li key={c}>{c}</li>)}</ul>
    <button type="button" className="btn-outline" onClick={async () => { try { await navigator.clipboard.writeText(codes.join('\n')); setCopied(true); } catch { setCopied(false); } }}>نسخ الرموز · Copy codes</button>
    <p role="status">{copied ? 'تم النسخ · Copied' : ''}</p>
    <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={saved} onChange={e => setSaved(e.target.checked)} /><span><Bi ar="حفظت الرموز" en="I saved them" /></span></label>
    <button type="button" className="btn-primary" disabled={!saved} onClick={() => window.location.assign(returnTarget())}>متابعة · Continue</button>
  </div></main>;

  const recover = step === 'recover';
  return <main className="page-main">{title}<div className="correction-panel">
    {step === 'enroll' && <>
      <p id="mfa-step1"><Bi ar="١. افتح تطبيق المصادقة وامسح الرمز، أو اكتب المفتاح يدويًا." en="1. Open your authenticator app and scan the code, or type the key by hand." /></p>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <QRCodeSVG value={uri} size={176} marginSize={2} role="img" aria-label="رمز QR لتطبيق المصادقة · QR code for the authenticator app" />
        <div><span>المفتاح · Key</span><br /><code dir="ltr" style={{ fontSize: 18, letterSpacing: 2, userSelect: 'all', overflowWrap: 'anywhere' }}>{secret}</code></div>
      </div>
      <p><Bi ar="٢. اكتب الرمز المكوّن من ٦ أرقام." en="2. Type the 6-digit code." /></p>
    </>}
    <form onSubmit={submit}>
      <label>{recover ? <Bi ar="رمز الاسترداد" en="Recovery code" /> : <Bi ar="الرمز المكوّن من ٦ أرقام" en="6-digit code" />}
        <input ref={input} required dir="ltr" value={code} {...(recover ? {} : { autoComplete: 'one-time-code' })} aria-invalid={!!error} aria-describedby={[step === 'enroll' ? 'mfa-step1' : '', error ? 'mfa-err' : ''].filter(Boolean).join(' ') || undefined}
          {...(recover ? { maxLength: 24 } : { inputMode: 'numeric' as const, pattern: '[0-9]{6}', maxLength: 12 })}
          onChange={e => setCode(recover ? e.target.value : normalizeDigits(e.target.value).replace(/\D/g, '').slice(0, 6))} /></label>
      <div id="mfa-err">{status}</div>
      <button className="btn-primary" disabled={busy}>{busy ? 'جارٍ التحميل · Loading…' : 'تأكيد · Confirm'}</button>
    </form>
    {step !== 'enroll' && <button type="button" className="btn-outline" onClick={() => { setError(''); setCode(''); setStep(recover ? 'verify' : 'recover'); }}>{recover ? 'استخدم رمز التطبيق · Use the app code' : 'فقدت جهازي · I lost my device'}</button>}
  </div></main>;
}
