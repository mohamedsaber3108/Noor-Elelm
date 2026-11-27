"use client";
import { useEffect, useState } from 'react';
import Link from '@/components/full-page-link';

type Data = {
  content: { byStatus: { status: string; count: number }[]; imported: number; available: number };
  reviews: { byDecision: { decision: string; total: number; last7Days: number; last30Days: number }[]; reviewedItems: number };
  corrections: { total: number; last7Days: number; oldestAgeDays: number | null; statusField: boolean };
  infographics: { queue: number; withDecision: number };
  publication: { enabled: boolean; released: number };
};

const DEC: Record<string, [string, string]> = { APPROVE: ['موافقة', 'Approve'], REJECT: ['رفض', 'Reject'], REQUEST_CHANGES: ['طلب تعديل', 'Request changes'] };
const fmt = (n: number) => n.toLocaleString('ar-EG');

function Both({ ar, en }: { ar: string; en: string }) {
  return <><span lang="ar" dir="rtl">{ar}</span> <span lang="en" dir="ltr">{en}</span></>;
}

function Card({ href, ar, en, value }: { href?: string; ar: string; en: string; value: number | string }) {
  const body = <><span><Both ar={ar} en={en} /></span><strong>{typeof value === 'number' ? fmt(value) : value}</strong></>;
  return <div>{href ? <Link href={href}>{body}</Link> : body}</div>;
}

export function AdminEditorial() {
  const [data, setData] = useState<Data | null>(null), [state, setState] = useState<'loading' | 'denied' | 'ok' | 'error'>('loading');
  useEffect(() => {
    fetch('/api/admin/editorial', { cache: 'no-store' })
      .then(async r => {
        if (r.status === 403 || r.status === 401) { setState('denied'); return; }
        if (!r.ok) throw Error();
        setData(await r.json() as Data); setState('ok');
      })
      .catch(() => setState('error'));
  }, []);

  const nav = <nav className="admin-nav"><Link href="/admin">المراجعة</Link> · <Link href="/admin/corrections">البلاغات</Link> · <Link href="/admin/infographics">الإنفوجرافيك</Link> · <Link href="/admin/users">المستخدمون</Link></nav>;
  const head = <div className="page-hero"><span className="eyebrow">الإدارة</span><h1><Both ar="لوحة التحرير" en="Editorial dashboard" /></h1>
    <p><Both ar="أرقام حقيقية من قاعدة البيانات. لا يُنشر شيء تلقائيًا: النشر غير مفعّل." en="Real numbers from the database. Nothing publishes automatically: publication is off." /></p></div>;

  if (state === 'denied') return <main className="page-main">{head}<div className="empty-state"><Both ar="هذه الصفحة للمراجعين والمديرين فقط." en="This page is for reviewers and admins only." /> <Link href="/login?return_to=%2Fadmin%2Feditorial"><Both ar="تسجيل الدخول" en="Sign in" /></Link></div></main>;
  return <main className="page-main">{head}{nav}
    <div role="status" aria-live="polite">{state === 'loading' && <Both ar="جارٍ التحميل…" en="Loading…" />}</div>
    {state === 'error' && <div role="alert" className="error-note"><Both ar="تعذر تحميل البيانات." en="Could not load the data." /></div>}
    {data && <>
      <section aria-labelledby="ed-content"><h2 id="ed-content"><Both ar="المحتوى" en="Content" /></h2>
        <div className="admin-stats">
          <Card href="/admin" ar="مسودات مستوردة" en="Imported drafts" value={data.content.imported} />
          <Card ar="متاح في الأرشيف" en="Available in the archive" value={data.content.available} />
          {data.content.byStatus.map(s => <Card key={s.status} href="/admin" ar={'الحالة ' + s.status} en={'Status ' + s.status} value={s.count} />)}
          <Card ar="منشور" en="Released" value={data.publication.released} />
        </div></section>
      <section aria-labelledby="ed-reviews"><h2 id="ed-reviews"><Both ar="قرارات المراجعة" en="Review decisions" /></h2>
        <div className="admin-table-wrap"><table className="admin-table">
          <caption><Both ar="عدد القرارات حسب النوع" en="Decisions by type" /></caption>
          <thead><tr><th scope="col"><Both ar="القرار" en="Decision" /></th><th scope="col"><Both ar="٧ أيام" en="7 days" /></th><th scope="col"><Both ar="٣٠ يومًا" en="30 days" /></th><th scope="col"><Both ar="الكل" en="All" /></th></tr></thead>
          <tbody>{data.reviews.byDecision.map(d => <tr key={d.decision}><th scope="row"><Both ar={DEC[d.decision]?.[0] ?? d.decision} en={DEC[d.decision]?.[1] ?? d.decision} /></th><td>{fmt(d.last7Days)}</td><td>{fmt(d.last30Days)}</td><td>{fmt(d.total)}</td></tr>)}</tbody>
        </table></div>
        <div className="admin-stats"><Card href="/admin" ar="مواد لها قرار واحد على الأقل" en="Items with at least one decision" value={data.reviews.reviewedItems} /></div></section>
      <section aria-labelledby="ed-corr"><h2 id="ed-corr"><Both ar="بلاغات التصحيح" en="Correction reports" /></h2>
        <div className="admin-stats">
          <Card href="/admin/corrections" ar="الكل" en="All" value={data.corrections.total} />
          <Card href="/admin/corrections" ar="آخر ٧ أيام" en="Last 7 days" value={data.corrections.last7Days} />
          <Card href="/admin/corrections" ar="عمر أقدم بلاغ (أيام)" en="Age of the oldest report (days)" value={data.corrections.oldestAgeDays ?? '—'} />
        </div>
        {!data.corrections.statusField && <p><Both ar="لا يوجد حقل حالة للبلاغات بعد، فلا يمكن عدّ ما لم يُرد عليه." en="Reports have no status field yet, so unanswered reports cannot be counted." /></p>}</section>
      <section aria-labelledby="ed-info"><h2 id="ed-info"><Both ar="طابور الإنفوجرافيك" en="Infographics queue" /></h2>
        <div className="admin-stats">
          <Card href="/admin/infographics" ar="في الطابور" en="In the queue" value={data.infographics.queue} />
          <Card href="/admin/infographics" ar="لها قرار مراجعة" en="With a review decision" value={data.infographics.withDecision} />
        </div></section>
    </>}
  </main>;
}
