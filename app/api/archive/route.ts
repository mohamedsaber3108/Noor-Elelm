import {NextRequest,NextResponse} from 'next/server';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {env} from 'cloudflare:workers';
import records from '@/data/archive-records.json';
const all=records as {id:string;world:string;title:string;text:string;source:string;location:string;type:string;status:string}[];
const sequence=new Map(all.map((r,i)=>[r.id,i+1]));
const safe=(r:typeof all[number])=>({id:r.id,sequence:sequence.get(r.id),world:r.world,title:r.title,source:r.source,location:r.location,type:r.type,status:r.status});
export async function GET(req:NextRequest){
 const p=req.nextUrl.searchParams,id=p.get('id');
 if(id){
  const row=all.find(r=>r.id===id);if(!row)return NextResponse.json({error:'NOT_FOUND'},{status:404});
  const u=await getChatGPTUser();
  // Draft source prose is restricted to explicitly configured reviewers, even if the Site is later opened to readers.
  const e=env as unknown as Record<string,unknown>;
  const allowed=!!u&&(String(e.REVIEWER_IDS||'').split(',').map(s=>s.trim()).includes(u.userId)||String(e.REVIEWER_EMAILS||'').toLowerCase().split(',').map(s=>s.trim()).includes(u.email.toLowerCase()));
  if(!allowed)return NextResponse.json({...safe(row),text:null,restricted:true});
  const edited=env.DB?await env.DB.prepare('SELECT title,body,revision,status FROM content_items WHERE id=?').bind(id).first<{title:string;body:string;revision:number;status:string}>():null;
  return NextResponse.json({...row,sequence:sequence.get(row.id),title:edited?.title||row.title,text:edited?.body||row.text,revision:edited?.revision||0,restricted:false});
 }
 const world=p.get('world')||'',q=(p.get('q')||'').trim().toLocaleLowerCase(),type=p.get('type')||'';
 const page=Math.min(1000,Math.max(1,Number(p.get('page')||1)||1)),pageSize=24;
 const filtered=all.filter(r=>(!world||r.world===world)&&(!type||(type==='visualizable_candidate'?r.type==='claim_candidate':type==='infographic_candidate'?r.type==='claim_candidate'&&/^\s*(?:ال)?إنفو(?:غرافيك|غراف)/.test(r.title)&&r.title.length>22:r.type===type))&&(!q||(r.title+r.source).toLocaleLowerCase().includes(q)));
 const terms=(p.get('rank')||'').slice(0,110).toLocaleLowerCase().split('|').filter(Boolean).slice(0,4);
 if(terms.length)filtered.sort((a,b)=>terms.filter(t=>(b.title+' '+b.text).toLocaleLowerCase().includes(t)).length-terms.filter(t=>(a.title+' '+a.text).toLocaleLowerCase().includes(t)).length);
 const results=filtered.slice((page-1)*pageSize,page*pageSize).map(safe);
 return NextResponse.json({results,total:filtered.length,page,pageSize,pages:Math.ceil(filtered.length/pageSize),status:'DRAFT_INDEX'}, {headers:{'Cache-Control':'private, max-age=30'}});
}
