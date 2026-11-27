"use client";
import { useCallback, useEffect, useState } from 'react';
import Link from '@/components/full-page-link';

type S = { key: string; value: boolean | string; default: boolean | string; updatedAt: number | null; updatedBy: string | null };
type M = { id: string; nameAr: string; nameEn: string; path: string; roles: string[]; healthy: boolean; state: 'on' | 'off' | 'preview' };
type Data = { settings: S[]; modules: M[] };

const L: Record<string, [string, string]> = {
  'feature.game_enabled': ['اللعبة مفعّلة', 'Game is on'],
  'feature.corrections_enabled': ['استقبال بلاغات التصحيح مفعّل', 'Correction reports are on'],
  'site.pricing_note_ar': ['نص صفحة الأسعار (عربي)', 'Pricing note (Arabic)'],
  'site.pricing_note_en': ['نص صفحة الأسعار (إنجليزي)', 'Pricing note (English)'],
  'site.registration_note_ar': ['إشعار إغلاق التسجيل (عربي)', 'Registration notice (Arabic)'],
  'site.registration_note_en': ['إشعار إغلاق التسجيل (إنجليزي)', 'Registration notice (English)'],
};
const STATE: Record<string, [string, string]> = { on: ['يعمل', 'On'], off: ['متوقف', 'Off'], preview: ['تجريبي', 'Preview'] };
const ROLE: Record<string, [string, string]> = { reviewer: ['مراجع', 'Reviewer'], admin: ['مدير', 'Admin'] };
const ERR: Record<string, [string, string]> = {
  INVALID_VALUE: ['القيمة غير صالحة. النص العادي فقط، حتى ٥٠٠ حرف، بلا وسوم.', 'The value is not valid. Plain text only, up to 500 characters, no tags.'],
  INVALID_INPUT: ['اكتب سببًا من ١٠ إلى ٣٠٠ حرف.', 'Write a reason of 10 to 300 characters.'],
  AUDIT_UNAVAILABLE: ['تعذر كتابة سجل التدقيق. لم يتغير شيء.', 'The audit log could not be written. Nothing changed.'],
  BAD_ORIGIN: ['تعذر التحقق من مصدر الطلب. أعد تحميل الصفحة.', 'The request origin could not be checked. Reload the page.'],
};

export function AdminSettings() {
  const [data, setData] = useState<Data | null>(null), [state, setState] = useState<'loading' | 'denied' | 'ok' | 'error'>('loading');
  const [draft, setDraft] = useState<Record<string, boolean | string>>({}), [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; ar: string; en: string } | null>(null), [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/settings', { cache: 'no-store' });
      if (r.status === 403 || r.status === 401) { setState('denied'); return; }
      if (!r.ok) throw Error();
      const d = await r.json() as Data;
      setData(d); setDraft(Object.fromEntries(d.settings.map(s => [s.key, s.value]))); setState('ok');
    } catch { setState('error'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    const changed = data.settings.filter(s => draft[s.key] !== s.value);
    if (!changed.length) { setMsg({ ok: false, ar: 'لا توجد تغييرات للحفظ.', en: 'There are no changes to save.' }); return; }
    setBusy(true); setMsg(null);
    try {
      for (const s of changed) {
        const r = await fetch('/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: s.key, value: draft[s.key], reason }) });
        if (!r.ok) {
          const d = await r.json().catch(() => ({})) as { error?: string };
          const e2 = ERR[d.error || ''] || ['تعذر الحفظ.', 'Could not save.'];
          setMsg({ ok: false, ar: e2[0], en: e2[1] }); await load(); return;
        }
      }
      setReason(''); setMsg({ ok: true, ar: 'تم الحفظ وسُجّل في سجل التدقيق.', en: 'Saved and recorded in the audit log.' }); await load();
    } catch { setMsg({ ok: false, ar: 'تعذر الاتصال بالخادم.', en: 'Could not reach the server.' }); } finally { setBusy(false); }
  }

  if (state === 'denied') return <main className="page-main"><div className="page-hero"><h1><span lang="ar" dir="rtl">الإعدادات</span> <span lang="en" dir="ltr">Settings</span></h1></div><div className="empty-state"><span lang="ar" dir="rtl">هذه الصفحة للمديرين فقط.</span> <span lang="en" dir="ltr">This page is for admins only.</span> <Link href="/login?return_to=%2Fadmin%2Fsettings">تسجيل الدخول / Sign in</Link></div></main>;
  return <main className="page-main"><div className="page-hero"><span className="eyebrow">الإدارة</span><h1><span lang="ar" dir="rtl">الإعدادات والوحدات</span> <span lang="en" dir="ltr">Settings and modules</span></h1>
    <p><span lang="ar" dir="rtl">كل تغيير يحتاج سببًا ويُسجَّل في سجل التدقيق. النصوص نص عادي فقط.</span> <span lang="en" dir="ltr">Every change needs a reason and is recorded in the audit log. Text is plain text only.</span></p></div>
    <nav className="admin-nav"><Link href="/admin">المراجعة</Link> · <Link href="/admin/users">المستخدمون</Link> · <Link href="/admin/corrections">البلاغات</Link> · <Link href="/admin/infographics">الإنفوجرافيك</Link></nav>
    {state === 'error' && <div role="alert" className="error-note"><span lang="ar" dir="rtl">تعذر تحميل البيانات.</span> <span lang="en" dir="ltr">Could not load the data.</span></div>}
    {data && <>
      <section aria-labelledby="mods"><h2 id="mods"><span lang="ar" dir="rtl">الوحدات</span> <span lang="en" dir="ltr">Modules</span></h2>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th><span lang="ar" dir="rtl">الوحدة</span> <span lang="en" dir="ltr">Module</span></th><th><span lang="ar" dir="rtl">من يراها</span> <span lang="en" dir="ltr">Who sees it</span></th><th><span lang="ar" dir="rtl">الحالة</span> <span lang="en" dir="ltr">State</span></th></tr></thead><tbody>
          {data.modules.map(m => <tr key={m.id}><td><Link href={m.path}><span lang="ar" dir="rtl">{m.nameAr}</span> <span lang="en" dir="ltr">{m.nameEn}</span></Link></td>
            <td>{m.roles.map(r => <span key={r}><span lang="ar" dir="rtl">{ROLE[r]?.[0] ?? r}</span> <span lang="en" dir="ltr">{ROLE[r]?.[1] ?? r}</span>{' '}</span>)}</td>
            <td><span lang="ar" dir="rtl">{STATE[m.state][0]}</span> <span lang="en" dir="ltr">{STATE[m.state][1]}</span></td></tr>)}
        </tbody></table></div></section>
      <section aria-labelledby="sets"><h2 id="sets"><span lang="ar" dir="rtl">الإعدادات</span> <span lang="en" dir="ltr">Settings</span></h2>
        <form onSubmit={save} className="correction-panel">
          {data.settings.map(s => {
            const [ar, en] = L[s.key] ?? [s.key, s.key];
            const id = 'set-' + s.key.replace(/\./g, '-');
            return typeof s.default === 'boolean'
              ? <div key={s.key}><label htmlFor={id}><input id={id} type="checkbox" checked={draft[s.key] === true} onChange={e => setDraft(d => ({ ...d, [s.key]: e.target.checked }))} /> <span lang="ar" dir="rtl">{ar}</span> <span lang="en" dir="ltr">{en}</span></label></div>
              : <div key={s.key}><label htmlFor={id}><span lang="ar" dir="rtl">{ar}</span> <span lang="en" dir="ltr">{en}</span></label>
                <textarea id={id} maxLength={500} rows={3} dir={s.key.endsWith('_ar') ? 'rtl' : 'ltr'} lang={s.key.endsWith('_ar') ? 'ar' : 'en'} value={String(draft[s.key] ?? '')} onChange={e => setDraft(d => ({ ...d, [s.key]: e.target.value }))} /></div>;
          })}
          <label htmlFor="set-reason"><span lang="ar" dir="rtl">سبب التغيير (١٠ إلى ٣٠٠ حرف)</span> <span lang="en" dir="ltr">Reason for the change (10 to 300 characters)</span></label>
          <textarea id="set-reason" required minLength={10} maxLength={300} rows={2} value={reason} onChange={e => setReason(e.target.value)} />
          <button className="btn-primary" disabled={busy || reason.trim().length < 10}><span lang="ar" dir="rtl">حفظ</span> <span lang="en" dir="ltr">Save</span></button>
        </form>
        {msg && <p role={msg.ok ? 'status' : 'alert'}><span lang="ar" dir="rtl">{msg.ar}</span> <span lang="en" dir="ltr">{msg.en}</span></p>}
      </section></>}
  </main>;
}
