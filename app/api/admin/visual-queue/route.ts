import {NextResponse} from 'next/server';
import {getCurrentUser,isReviewer} from '@/app/auth';
import {env} from 'cloudflare:workers';
import {auditAdminDenied} from '@/lib/audit-denied';
import records from '@/data/archive-records.json';

type ArchiveRow={id:string;world:string;title:string;source:string;location:string;type:string};
const all=records as ArchiveRow[];
const explicit=all.filter(r=>r.type==='claim_candidate'&&/^\s*(?:ال)?إنفو(?:غرافيك|غراف)/.test(r.title)&&r.title.length>22);
// Complete the first production batch with a specific visual topic from the sira archive.
const supplemental=all.find(r=>r.id==='NAI-1e1a6ac29175');
const chosen=[...explicit,...(supplemental&&!explicit.includes(supplemental)?[supplemental]:[])].slice(0,200);
const positions=new Map(all.map((r,i)=>[r.id,i+1]));

export async function GET(req?:Request){
 const user=await getCurrentUser();
 const allowed=isReviewer(user);
 if(!allowed){await auditAdminDenied(req,'/api/admin/visual-queue');return NextResponse.json({error:'REVIEWER_ACCESS_REQUIRED'},{status:403})}
 if(!env.DB)return NextResponse.json({error:'DATABASE_UNAVAILABLE'},{status:503});
 const placeholders=chosen.map(()=>'?').join(',');
 const recent=await env.DB.prepare(
  `SELECT content_id,decision,note,created_at FROM reviews WHERE content_id IN (${placeholders}) ORDER BY created_at DESC`
 ).bind(...chosen.map(r=>r.id)).all<{content_id:string;decision:string;note:string;created_at:string}>();
 const latest=new Map<string,{decision:string;note:string;created_at:string}>();
 for(const review of recent.results)if(!latest.has(review.content_id))latest.set(review.content_id,review);
 return NextResponse.json({
  total:chosen.length,
  rows:chosen.map((r,i)=>({id:r.id,sequence:positions.get(r.id),priority:i+1,world:r.world,
   title:r.title,source:r.source,location:r.location,review:latest.get(r.id)||null})),
  publication:'DISABLED_PENDING_SEPARATE_EDITORIAL_RELEASE'
 },{headers:{'Cache-Control':'private, no-store'}});
}
