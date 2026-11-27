import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser,isReviewer} from '@/app/auth';
import {env} from 'cloudflare:workers';
import records from '@/data/archive-records.json';
import {normalizeArabic} from '@/lib/arabic';
const all=records as {id:string;world:string;title:string;text:string;source:string;location:string;type:string;status:string}[];
const sequence=new Map(all.map((r,i)=>[r.id,i+1]));
const safe=(r:typeof all[number])=>({id:r.id,sequence:sequence.get(r.id),world:r.world,title:r.title,source:r.source,location:r.location,type:r.type,status:r.status});
// Search text, normalised once (N-23a): diacritics, alef forms, taa marbuta, alef maqsura and digits match either way.
const hay=new Map(all.map(r=>[r.id,normalizeArabic(r.title+' '+r.source)]));
// Title plus full text for ranking, normalised once on first use and then kept.
let rankHay:Map<string,string>|null=null;
export async function GET(req:NextRequest){
 const p=req.nextUrl.searchParams,id=p.get('id');
 if(id){
  const row=all.find(r=>r.id===id);if(!row)return NextResponse.json({error:'NOT_FOUND'},{status:404});
  const u=await getCurrentUser();
  // Draft source prose is restricted to explicitly configured reviewers, even if the Site is later opened to readers.
  const allowed=isReviewer(u);
  if(!allowed)return NextResponse.json({...safe(row),text:null,restricted:true});
  const edited=env.DB?await env.DB.prepare('SELECT title,body,revision,status FROM content_items WHERE id=?').bind(id).first<{title:string;body:string;revision:number;status:string}>():null;
  return NextResponse.json({...row,sequence:sequence.get(row.id),title:edited?.title||row.title,text:edited?.body||row.text,revision:edited?.revision||0,restricted:false});
 }
 const world=p.get('world')||'',q=normalizeArabic((p.get('q')||'').slice(0,200)),type=p.get('type')||'';
 const page=Math.min(1000,Math.max(1,Number(p.get('page')||1)||1)),pageSize=24;
 const filtered=all.filter(r=>(!world||r.world===world)&&(!type||(type==='visualizable_candidate'?r.type==='claim_candidate':type==='infographic_candidate'?r.type==='claim_candidate'&&/^\s*(?:ال)?إنفو(?:غرافيك|غراف)/.test(r.title)&&r.title.length>22:r.type===type))&&(!q||hay.get(r.id)!.includes(q)));
 const terms=(p.get('rank')||'').slice(0,110).split('|').map(normalizeArabic).filter(Boolean).slice(0,4);
 if(terms.length){rankHay??=new Map(all.map(r=>[r.id,normalizeArabic(r.title+' '+r.text)]));const rankText=rankHay;const score=(r:typeof all[number])=>terms.filter(t=>rankText.get(r.id)!.includes(t)).length;filtered.sort((a,b)=>score(b)-score(a));}
 const results=filtered.slice((page-1)*pageSize,page*pageSize).map(safe);
 return NextResponse.json({results,total:filtered.length,page,pageSize,pages:Math.ceil(filtered.length/pageSize),status:'DRAFT_INDEX'}, {headers:{'Cache-Control':'private, max-age=30'}});
}
