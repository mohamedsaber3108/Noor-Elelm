"use client";
import Link from '@/components/full-page-link';
import {useEffect,useMemo,useState} from 'react';
import {ArrowLeft,Search,ShieldAlert} from 'lucide-react';
import {sourceCategories} from '@/lib/worlds';

type Row={id:string;priority:number;sequence:number;title:string;world:string;source:string;location:string;review:{decision:string;note:string;created_at:string}|null};
const labels:Record<string,string>={APPROVE:'موافقة مراجعة أولية',REJECT:'مرفوض',REQUEST_CHANGES:'مطلوب تعديل'};

export function VisualProductionQueue(){
 const [rows,setRows]=useState<Row[]>([]),[state,setState]=useState<'loading'|'ready'|'forbidden'|'error'>('loading');
 const [query,setQuery]=useState(''),[world,setWorld]=useState(''),[decision,setDecision]=useState(''),[page,setPage]=useState(1);
 useEffect(()=>{fetch('/api/admin/visual-queue').then(async r=>{
  if(r.status===403){setState('forbidden');return}
  if(!r.ok)throw Error('queue');
  const data=await r.json() as {rows:Row[]};setRows(data.rows);setState('ready')
 }).catch(()=>setState('error'))},[]);
 const filtered=useMemo(()=>rows.filter(r=>(!world||r.world===world)&&
  (!decision||(decision==='NONE'?!r.review:r.review?.decision===decision))&&
  (!query||(r.title+' '+r.source+' '+r.id).toLocaleLowerCase().includes(query.toLocaleLowerCase()))),[rows,query,world,decision]);
 const visible=filtered.slice((page-1)*20,page*20);
 const reset=()=>setPage(1);
 return <main className="page-main">
  <div className="admin-correction-link"><Link href="/admin">لوحة المحتوى</Link> · <Link href="/library">المكتبة</Link></div>
  <div className="page-hero"><span className="eyebrow">إدارة الإنتاج البصري</span><h1>خطة إنتاج أول ٢٠٠ إنفوجرافيك.</h1>
   <p>٢٠٠ مرشح للإنتاج، تُقدَّم فيها العناوين الموسومة بالإنفوجرافيك في ملفات المصدر. هذه قائمة عمل خاصة بالمراجعين، وليست ٢٠٠ مادة معتمدة أو تصميمًا جاهزًا للنشر.</p></div>
  <div className="review-warning"><ShieldAlert size={20}/><div><strong>قرار المراجع لا يعني الموافقة على الإنفوجرافيك أو إتاحته للجمهور.</strong>
   <p>يلزم لكل بطاقة نص مضبوط، ومصدر وموضع، وحقوق استخدام، ومراجعة علمية، وتدقيق تصميم وإصدار مستقل قبل النشر.</p></div></div>
  {state==='loading'?<div className="empty-state">جار فتح قائمة الإنتاج…</div>:
   state==='forbidden'?<div className="empty-state">تحتاج صلاحية مراجع للوصول إلى قائمة الإنتاج.</div>:
   state==='error'?<div className="empty-state">تعذر فتح القائمة الآن. أعد المحاولة لاحقًا.</div>:<>
   <div className="catalog-head"><div><span className="eyebrow">دفعة الإنتاج الأولى</span><h2>{filtered.length.toLocaleString('ar-EG')} من {rows.length.toLocaleString('ar-EG')} مرشح</h2>
    <p>يظهر آخر قرار نصي مسجل لكل نقطة؛ «بدون قرار» تعني أن المراجعة لم تُسجل بعد.</p></div></div>
   <div className="visual-queue-filters">
    <label className="search-box"><Search size={18}/><input aria-label="ابحث في قائمة الإنتاج" placeholder="عنوان أو ملف أو معرّف" value={query} onChange={e=>{setQuery(e.target.value);reset()}}/></label>
    <label>العالم<select value={world} onChange={e=>{setWorld(e.target.value);reset()}}><option value="">كل العوالم</option>{sourceCategories.map(w=><option key={w} value={w}>{w}</option>)}</select></label>
    <label>آخر قرار<select value={decision} onChange={e=>{setDecision(e.target.value);reset()}}><option value="">الكل</option><option value="NONE">بدون قرار</option><option value="REQUEST_CHANGES">مطلوب تعديل</option><option value="APPROVE">موافقة أولية</option><option value="REJECT">مرفوض</option></select></label>
   </div>
   <div className="visual-queue-list">{visible.map(r=><article key={r.id} className="visual-queue-row">
    <span className="number-dot">{String(r.priority).padStart(2,'0')}</span><div><small>{r.world} · {r.id}</small><h3>{r.title}</h3><p>{r.source} · {r.location}</p><span className="draft-badge">{r.review?labels[r.review.decision]||r.review.decision:'بدون قرار مراجعة'}</span>
     {r.review&&<small className="visual-queue-date">آخر قرار: {r.review.created_at}</small>}
    </div><div className="visual-queue-actions"><Link href={'/infographic/'+r.id}>معاينة البطاقة <ArrowLeft size={15}/></Link>
     <Link href={'/admin?contentId='+encodeURIComponent(r.id)}>افتحها للمراجعة <ArrowLeft size={15}/></Link></div>
   </article>)}</div>
   {!filtered.length&&<div className="empty-state">لا توجد مرشحات بهذه الفلاتر.</div>}
   {filtered.length>20&&<div className="catalog-pagination"><button disabled={page===1} onClick={()=>setPage(page-1)}>السابق</button><span>{page} / {Math.ceil(filtered.length/20)}</span><button disabled={page>=Math.ceil(filtered.length/20)} onClick={()=>setPage(page+1)}>التالي</button></div>}
  </>}
 </main>
}
